"""Offline size/lagged-volume qualification, NOT an execution or strategy test."""
import argparse
from collections import Counter
from datetime import timedelta
import gzip
import json

from .continuation_paths import ROOT, EPS, covered, load_paths
from .events import time
from .execution import valid_quote
from .phase2 import dump, sha
from .quote_units import normalize, VERSION, SOURCE


def lagged_volume(bars, at, max_age_seconds=90):
    """End-of-minute availability scenario only, never actual receipt evidence."""
    at=time(at)
    prior=[b for b in bars if time(b['timestamp'])+timedelta(minutes=1)<=at]
    if not prior:return dict(status='UNKNOWN_LAGGED_VOLUME', volume=None)
    latest=max(time(b['timestamp']) for b in prior)
    matches=[b for b in prior if time(b['timestamp'])==latest]
    end=latest+timedelta(minutes=1)
    result=dict(status='UNKNOWN_LAGGED_VOLUME',volume=None,bar_end_at=end.isoformat(),
                availability='END_OF_MINUTE_ASSUMPTION_ONLY')
    if len(matches)!=1 or (at-end).total_seconds()>max_age_seconds:return result
    v=matches[0].get('volume')
    if isinstance(v,bool) or not isinstance(v,(int,float)) or not 0<v<float('inf'):return result
    return {**result,'status':'SCENARIO_VOLUME_AVAILABLE','volume':v}


def snapshot(quotes, bars, at, intervals, path_start, max_age_seconds=90):
    if at is None:return dict(status='UNKNOWN_EXIT_PRICE')
    at=time(at)
    if not covered(intervals,path_start,at+EPS):return dict(status='UNKNOWN_RETRIEVAL_GAP')
    rows=[q for q in quotes if time(q['timestamp'])==at]
    if not rows:return dict(status='UNKNOWN_QUOTE_OBSERVATION')
    sizes=[normalize(q.get('bid_size'),q.get('ask_size'),q['timestamp'],provider='alpaca',feed='sip') for q in rows]
    if any(q['status']!='SHARES' for q in sizes):return dict(status='UNKNOWN_OR_INVALID_QUOTE_SIZE')
    normalized=[dict(bid=q.get('bid_price'),ask=q.get('ask_price'),bid_size=s['bid_size'],ask_size=s['ask_size'])
                for q,s in zip(rows,sizes)]
    if not all(valid_quote(q) for q in normalized):return dict(status='UNKNOWN_QUOTE_PRICE_OR_SIZE')
    # Never sum sizes across repeated updates or assume same-timestamp order.
    return dict(status='SNAPSHOT_OBSERVED',at=at.isoformat(),unit='shares',unit_version=VERSION,
                bid_shares_range=[min(q['bid_size'] for q in normalized),max(q['bid_size'] for q in normalized)],
                ask_shares_range=[min(q['ask_size'] for q in normalized),max(q['ask_size'] for q in normalized)],
                bid_range=[min(q['bid'] for q in normalized),max(q['bid'] for q in normalized)],
                ask_range=[min(q['ask'] for q in normalized),max(q['ask'] for q in normalized)],
                lagged=lagged_volume(bars,at,max_age_seconds))


def capacity(snap, quantity, side, participation=.01):
    if isinstance(quantity,bool) or not isinstance(quantity,int) or quantity<=0 or side not in ('bid','ask'):
        raise ValueError('Positive integer quantity and bid/ask side required')
    if snap['status']!='SNAPSHOT_OBSERVED':return dict(status='UNKNOWN',reasons=[snap['status']])
    size=snap[side+'_shares_range'][0];volume=snap['lagged']['volume']
    reasons=[]
    if quantity>size:reasons.append('INSUFFICIENT_DISPLAYED_SHARES')
    if volume is None:reasons.append('UNKNOWN_LAGGED_VOLUME')
    elif quantity>volume*participation:reasons.append('ABOVE_LAGGED_VOLUME_CAP')
    known_fail=any(r in ('INSUFFICIENT_DISPLAYED_SHARES','ABOVE_LAGGED_VOLUME_CAP') for r in reasons)
    return dict(status='FAIL' if known_fail else 'UNKNOWN' if reasons else 'PASS_SNAPSHOT_ONLY',
                reasons=reasons,displayed_shares_lower_bound=size,
                quantity_over_lagged_volume=quantity/volume if volume else None)


def build():
    inputs=json.loads((ROOT/'research/share-capacity-inputs.json').read_text())
    protocol_path=ROOT/'research/share-capacity-protocol.json'
    if sha(protocol_path)!=inputs['protocol_sha256']:raise ValueError('Capacity protocol changed')
    protocol=json.loads(protocol_path.read_text())
    if protocol['holdout_opens'] or protocol['deployment_allowed']:raise ValueError('Measurement audit only')
    for p,d in protocol['source_sha256'].items():
        if sha(ROOT/p)!=d:raise ValueError(f'Capacity source changed: {p}')
    _,_,_,paths=load_paths()
    prior=json.loads((ROOT/'data/continuation-path-report.json').read_text())
    selected=json.loads((ROOT/'research/continuation-quote-sample.json').read_text())['cases']
    if [c['id'] for c in paths]!=[c['id'] for c in selected]:raise ValueError('Sample changed')
    if [c['id'] for c in paths]!=[c['id'] for c in prior['cases']]:raise ValueError('Checkpoint sample changed')
    bars={}
    for item in json.loads((ROOT/'data/study-manifest.json').read_text())['files']:
        p=ROOT/item['path']
        if sha(p)!=item['sha256']:raise ValueError(f'Bar hash mismatch: {p}')
        bars[p.name[:10]]=json.loads(gzip.decompress(p.read_bytes()))['bars']
    cases=[]
    for path,old in zip(paths,prior['cases']):
        indication=old['indication']; symbol=path['symbol']
        raw=bars[path['start'].date().isoformat()].get(symbol,[])
        kwargs=dict(quotes=path['quotes'],bars=raw,intervals=path['intervals'],path_start=path['start'],
                    max_age_seconds=protocol['max_completed_bar_age_seconds'])
        entry=snapshot(at=indication['entry_at'],**kwargs)
        exit_at=indication.get('observed_at') if indication['status'].startswith('OBSERVED_') else None
        exit=snapshot(at=exit_at,**kwargs)
        quantities=[]
        for q in protocol['quantities_shares']:
            e=capacity(entry,q,'ask',protocol['max_participation'])
            x=capacity(exit,q,'bid',protocol['max_participation'])
            status=('FAIL_KNOWN_CAPACITY' if 'FAIL' in (e['status'],x['status']) else
                    'CAPACITY_AT_BOTH_SNAPSHOTS_ONLY' if e['status']==x['status']=='PASS_SNAPSHOT_ONLY' else 'UNKNOWN')
            quantities.append(dict(quantity=q,status=status,entry=e,exit=x))
        cases.append(dict(id=path['id'],symbol=symbol,prior_price_status=indication['status'],
                          entry_snapshot=entry,exit_snapshot=exit,quantities=quantities,
                          executable_net_pct=None,verified_fill=False))
    totals=[]
    for q in protocol['quantities_shares']:
        items=[next(x for x in c['quantities'] if x['quantity']==q) for c in cases]
        totals.append(dict(quantity=q,cases=len(items),status_counts=dict(sorted(Counter(x['status'] for x in items).items())),
                           entry_status_counts=dict(sorted(Counter(x['entry']['status'] for x in items).items())),
                           exit_status_counts=dict(sorted(Counter(x['exit']['status'] for x in items).items()))))
    return dict(as_of='2026-09-24',protocol_commit=inputs['protocol_commit'],status=protocol['status'],
                quote_unit_version=VERSION,unit_source=SOURCE,summary=totals,cases=cases,
                new_market_requests=0,holdout_opens=0,verified_execution_outcomes=0,net_expectancy_pct=None,
                live_rules_changed=False,profitability_claim_allowed=False,
                limits=[protocol['sample'],protocol['availability'],protocol['scope'],
                        'A size-qualified quote snapshot is not an order fill, a standing quote or a complete executable path.',
                        'No live signal thresholds, original price labels or prior frozen study results changed.'])


def main():
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
    report=build();path=ROOT/'data/share-capacity-report.json';content=dump(report)
    if args.check:
        if not path.exists() or path.read_text()!=content:raise SystemExit('Share-capacity reproduction mismatch')
    else:path.write_text(content)
    print(dump({k:v for k,v in report.items() if k!='cases'}))
    for c in report['cases']:print(c['symbol'],c['id'],[(q['quantity'],q['status']) for q in c['quantities']])


if __name__=='__main__':main()
