"""Frozen original-signal execution scenarios. Offline; no actual fill claims."""
import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal
import gzip
import json
from math import sqrt

from .continuation_paths import ROOT, load_paths
from .events import time
from .execution import Policy, simulate, valid_quote
from .phase2 import dump, sha
from .quote_units import normalize


def prefix_end(intervals, start):
    cursor=time(start)
    for a,b in sorted((time(a),time(b)) for a,b in intervals):
        if b<a:raise ValueError('Reversed coverage')
        if a>cursor:break
        cursor=max(cursor,b)
    return cursor


def volume_index(bars):
    groups=defaultdict(list)
    for b in bars:groups[time(b['timestamp'])+timedelta(minutes=1)].append(b)
    return sorted(groups),groups


def volume_at(index, at, max_age=90):
    ends,groups=index;at=time(at);i=bisect_right(ends,at)-1
    if i<0:return None,None
    end=ends[i];rows=groups[end];v=rows[0].get('volume')
    if (len(rows)!=1 or (at-end).total_seconds()>max_age or isinstance(v,bool)
            or not isinstance(v,(int,float)) or not 0<v<float('inf')):return None,None
    return v,end.isoformat()


def prepare(raw, bars, start, end, max_age=90):
    """Conflicting same-microsecond books have no assumed first event."""
    start,end=time(start),time(end);groups=defaultdict(list);index=volume_index(bars)
    for r in raw:
        at=time(r['timestamp'])
        if start<=at<end:groups[at].append(r)
    rows=[];duplicates=0;ambiguous=None
    for at,group in sorted(groups.items()):
        states={tuple(repr(r.get(k)) for k in ('bid_price','ask_price','bid_size','ask_size')) for r in group}
        if len(states)>1:ambiguous=at;end=at;break
        duplicates+=len(group)-1;r=group[0]
        sizes=normalize(r.get('bid_size'),r.get('ask_size'),r['timestamp'],provider='alpaca',feed='sip')
        volume,available=volume_at(index,at,max_age)
        rows.append(dict(sequence=len(rows),event_at=at.isoformat(),available_at=at.isoformat(),
                         bid=r.get('bid_price'),ask=r.get('ask_price'),bid_size=sizes['bid_size'],ask_size=sizes['ask_size'],
                         lagged_volume=volume,volume_available_at=available,volume_end_at=available))
    return rows,end,dict(same_time_equivalent_updates_removed=duplicates,
                         ambiguous_order_at=ambiguous.isoformat() if ambiguous else None)


def setup_for(case, protocol):
    ref=Decimal(str(case['reference_price']));start=time(case['signal_at'])
    return dict(id=case['id'],symbol=case['symbol'],at=case['signal_at'],
                expires_at=(start+timedelta(seconds=protocol['entry_window_seconds'])).isoformat(),
                quantity=protocol['quantity'],entry=float(ref),
                max_entry=float(ref*Decimal(str(protocol['entry_cap_multiplier']))),
                stop=float(ref*Decimal(str(protocol['stop_multiplier']))),
                target=float(ref*Decimal(str(protocol['target_multiplier']))))


def run_scenario(setup, rows, policy, end):
    start=time(setup['at']);expiry=time(setup['expires_at'])
    coverage=dict(complete=True,start=start.isoformat(),end=end.isoformat())
    result=simulate(setup,rows,policy,coverage)
    # Unknown volume is not proof that no qualified entry could have existed.
    bound=min(expiry,time(result['entry_at'])) if result['entry_at'] else expiry
    unknown=None
    for q in rows:
        at=time(q['available_at'])
        if at>bound:break
        if not valid_quote(q):continue
        if q['bid']<=setup['stop']:break
        if at<start+timedelta(seconds=policy.latency_seconds):continue
        if q['lagged_volume'] is not None or q['ask_size']<setup['quantity']:continue
        upper=q['ask']*(1+policy.impact_bps_at_full_participation*policy.max_participation**.5/10000)
        if q['ask']<=setup['max_entry'] and upper>=setup['entry']:
            unknown=at;break
    if unknown is not None:
        cut=[q for q in rows if time(q['available_at'])<unknown]
        result=simulate(setup,cut,policy,{**coverage,'end':unknown.isoformat()})
        if result['status'] in ('NO_ENTRY','UNKNOWN_COVERAGE'):
            result['status']='UNKNOWN_ENTRY_LIQUIDITY'
        result['unknown_liquidity_at']=unknown.isoformat()
    window=[q for q in rows if start<=time(q['available_at'])<=expiry]
    reasons=Counter()
    for q in window:
        at=time(q['available_at']);v=q['lagged_volume']
        if not valid_quote(q):reason='INVALID_QUOTE'
        elif q['bid']<=setup['stop']:reason='STOP_BREACH'
        elif at<start+timedelta(seconds=policy.latency_seconds):reason='ENTRY_DELAY'
        elif v is None:reason='UNKNOWN_VOLUME'
        elif setup['quantity']>q['ask_size']:reason='INSUFFICIENT_ASK_SHARES'
        elif setup['quantity']/v>policy.max_participation:reason='VOLUME_CAP'
        else:
            price=q['ask']*(1+policy.impact_bps_at_full_participation*sqrt(setup['quantity']/v)/10000)
            reason='BELOW_ENTRY_FLOOR' if price<setup['entry'] else 'ABOVE_ENTRY_CAP' if price>setup['max_entry'] else 'QUOTE_CHECKS_MET'
        reasons[reason]+=1
    result.update(entry_window_quotes=len(window),valid_entry_window_quotes=sum(valid_quote(q) for q in window),
                  per_quote_entry_diagnostics=dict(sorted(reasons.items())),
                  coverage_prefix_end=end.isoformat(),quantity=setup['quantity'],
                  verified_fill=False,profitability_claim_allowed=False)
    return result


def load():
    inputs=json.loads((ROOT/'research/signal-clock-inputs.json').read_text())
    for p,d in inputs['sha256'].items():
        if sha(ROOT/p)!=d:raise ValueError(f'Frozen signal-clock input changed: {p}')
    protocol=json.loads((ROOT/'research/signal-clock-protocol.json').read_text())
    if protocol['holdout_opens'] or protocol['deployment_allowed']:raise ValueError('Research only')
    for p,d in protocol['source_sha256'].items():
        if sha(ROOT/p)!=d:raise ValueError(f'Frozen source changed: {p}')
    _,_,_,paths=load_paths()
    if [c['id'] for c in protocol['cases']]!=[p['id'] for p in paths]:raise ValueError('Case reselection')
    ledger=json.loads((ROOT/'data/signal-clock/retrieval.json').read_text())
    if ledger['requests_used']!=len(ledger['requests']) or ledger['requests_used']>protocol['request_budget']:
        raise ValueError('Request budget/count')
    old=json.loads(gzip.decompress((ROOT/'data/quote-windows.json.gz').read_bytes()))['windows']
    validation=json.loads((ROOT/'data/presignal-liquidity-validation-quotes.json').read_text())['windows']
    for c,path in zip(protocol['cases'],paths):
        if c['cached_entry_source']=='data/quote-windows.json.gz':
            w=next(w for w in old if w['setup']['symbol']==c['symbol'] and time(w['setup']['at'])<=time(c['signal_at'])<time(w['setup']['expires_at']))
            if w.get('error') or w['feed']!='sip' or len(w['quotes'])>=w['limit']:raise ValueError('Unqualified entry cache')
            path['quotes']+=w['quotes'];path['intervals'].append((w['setup']['at'],w['setup']['expires_at']))
        elif c['cached_entry_source']=='data/presignal-liquidity-validation-quotes.json':
            w=next(w for w in validation if w['symbol']==c['symbol'] and time(w['request']['start'])<=time(c['signal_at'])<time(w['request']['end']))
            if w['truncated'] or w['request']['feed']!='sip':raise ValueError('Unqualified validation cache')
            path['quotes']+=w['quotes'];path['intervals'].append((w['request']['start'],w['request']['end']))
    for record in ledger['requests']:
        page=json.loads((ROOT/record['filename']).read_text());query=page['query'];i=page['case_index'];c=protocol['cases'][i]
        if record['query']!=query or record['case_index']!=i:raise ValueError('Retrieval ledger mismatch')
        if query['feed']!='sip' or query['symbol']!=c['symbol'] or not time(c['signal_at'])<=time(query['start'])<time(query['end'])<=time(c['entry_at']):
            raise ValueError('Unregistered retrieval interval')
        data=page['response']
        if page['isError'] or 'quotes' not in data:continue
        rows=data['quotes'][c['symbol']]
        if len(rows)!=record['count'] or any(r['symbol']!=c['symbol'] for r in rows):raise ValueError('Record mismatch')
        end=rows[-1]['timestamp'] if len(rows)>=query['limit'] else query['end']
        paths[i]['quotes']+=rows;paths[i]['intervals'].append((query['start'],end))
    bars={}
    for item in json.loads((ROOT/'data/study-manifest.json').read_text())['files']:
        p=ROOT/item['path']
        if sha(p)!=item['sha256']:raise ValueError('Bar hash mismatch')
        bars[p.name[:10]]=json.loads(gzip.decompress(p.read_bytes()))['bars']
    return inputs,protocol,ledger,paths,bars


def build():
    inputs,p,ledger,paths,bars=load();cases=[]
    for c,path in zip(p['cases'],paths):
        start=time(c['signal_at']);raw=bars[start.date().isoformat()].get(c['symbol'],[])
        reference=[b for b in raw if time(b['timestamp'])+timedelta(minutes=1)==start]
        if len(reference)!=1 or reference[0]['close']!=c['reference_price']:raise ValueError('Reference not the last completed close')
        end=prefix_end(path['intervals'],start)
        rows,end,quality=prepare(path['quotes'],raw,start,end,p['max_completed_bar_age_seconds'])
        setup=setup_for(c,p);scenarios=[]
        for latency in p['latency_seconds']:
            for cost in p['cost_scenarios']:
                policy=Policy(latency_seconds=latency,quote_age_seconds=p['quote_age_seconds'],horizon_seconds=p['horizon_seconds'],
                              exit_wait_seconds=p['exit_wait_seconds'],max_participation=p['max_participation'],
                              **{k:v for k,v in cost.items() if k!='id'})
                result=run_scenario(setup,rows,policy,end)
                scenarios.append(dict(id=f"DELAY_{latency}_{cost['id']}",policy=vars(policy),result=result))
        cases.append(dict(id=c['id'],symbol=c['symbol'],setup=setup,quality=quality,scenarios=scenarios))
    summary=[]
    for s in cases[0]['scenarios']:
        results=[next(v['result'] for v in c['scenarios'] if v['id']==s['id']) for c in cases]
        summary.append(dict(id=s['id'],cases=len(results),status_counts=dict(sorted(Counter(r['status'] for r in results).items())),
                            simulated_entries=sum(r['entry_at'] is not None for r in results),
                            resolved_scenario_returns=sum(r['net_pct'] is not None for r in results),
                            unknown=sum(r['status'].startswith('UNKNOWN') for r in results),
                            mean_net_pct=None,profitability_claim_allowed=False))
    return dict(as_of='2026-09-25',protocol_commit=inputs['protocol_commit'],status=p['status'],
                requests_used=ledger['requests_used'],new_quote_records=sum(r['count'] for r in ledger['requests']),
                cached_entry_cases=sum(c['cached_entry_source'] is not None for c in p['cases']),resume=ledger['resume'],
                summary=summary,cases=cases,live_rules_changed=False,holdout_opens=0,verified_fills=0,
                profitability_claim_allowed=False,limits=[p['selection'],p['reference'],p['availability'],p['performance'],
                  'Entry range is evaluated on impact-adjusted ask by the unchanged shared engine; scenario fees/impact are uncalibrated.',
                  'Historical SIP API coverage does not prove firm executable quotes, order queue, halts, receipt completeness or PIT universe eligibility.'])


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');a=parser.parse_args()
    r=build();path=ROOT/'data/signal-clock-report.json';content=dump(r)
    if a.check:
        if not path.exists() or path.read_text()!=content:raise SystemExit('Signal-clock reproduction mismatch')
    else:path.write_text(content)
    print(dump({k:v for k,v in r.items() if k!='cases'}))
    for c in r['cases']:print(c['id'],[(s['id'],s['result']['status'],s['result']['net_pct']) for s in c['scenarios']])


if __name__=='__main__':main()
