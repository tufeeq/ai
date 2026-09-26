"""Quote-anchored executable-entry diagnostic on frozen development cases."""
import argparse
from collections import Counter
from dataclasses import asdict
from datetime import timedelta
from decimal import Decimal
import gzip
import json
from math import sqrt

from .events import time
from .execution import Policy, valid_quote
from .phase2 import dump, sha
from .quote_units import VERSION
from .signal_clock import ROOT, prefix_end, prepare


def midpoint_spread_pct(q):
    return 200 * (q['ask']-q['bid']) / (q['ask']+q['bid'])


def decision_quote(rows, signal_at, maximum_spread_pct):
    start=time(signal_at)
    for q in rows:
        if time(q['available_at'])>=start and valid_quote(q) and midpoint_spread_pct(q)<=maximum_spread_pct:
            return q
    return None


def anchored_setup(case, anchor, protocol):
    at=time(anchor['available_at']);price=Decimal(str(anchor['ask']))
    ep=protocol['entry'];bp=protocol['barriers']
    return dict(id=case['id'],symbol=case['symbol'],decision_at=at.isoformat(),decision_ask=float(price),
                expires_at=(at+timedelta(seconds=ep['window_seconds_after_decision'])).isoformat(),
                quantity=ep['quantity_shares'],entry=float(price*Decimal(str(ep['minimum_impact_adjusted_ask_multiplier']))),
                max_entry=float(price*Decimal(str(ep['maximum_impact_adjusted_ask_multiplier']))),
                stop=float(price*Decimal(str(bp['stop_bid_multiplier_of_decision_ask']))),
                target=float(price*Decimal(str(bp['target_bid_multiplier_of_decision_ask']))))


def potential_unknown_entry(q, setup, policy, maximum_spread_pct):
    if not valid_quote(q) or midpoint_spread_pct(q)>maximum_spread_pct or q['ask_size']<setup['quantity']:
        return False
    if q['lagged_volume'] is not None:return False
    maximum_impact=policy.impact_bps_at_full_participation*sqrt(policy.max_participation)/10000
    return q['ask']<=setup['max_entry'] and q['ask']*(1+maximum_impact)>=setup['entry']


def simulate_anchored(setup, quotes, policy, coverage_end, maximum_spread_pct):
    """Conservative single-fill scenario; spread gate applies at entry only."""
    start=time(setup['decision_at']);expiry=time(setup['expires_at']);end=time(coverage_end)
    qty=setup['quantity'];rows=sorted(quotes,key=lambda q:(time(q['available_at']),q['sequence']))
    base=dict(id=setup['id'],symbol=setup['symbol'],status='UNKNOWN_COVERAGE',net_pct=None,
              entry_at=None,exit_at=None,mae_pct=None,mfe_pct=None,verified_fill=False,
              approved_for_live=False,evidence='HISTORICAL_QUOTE_SCENARIO')
    filled=None;deadline=None;trigger=None;trigger_at=None;excursions=[]
    def finish(status,**extra):
        return {**base,'status':status,**extra,
                'mae_pct':min(0,min(excursions)) if excursions else None,
                'mfe_pct':max(0,max(excursions)) if excursions else None}
    def complete(until):return end>=until
    def executable(q,at,side):
        volume=q.get('lagged_volume')
        if volume is None or volume<=0:return None
        if not q.get('volume_available_at') or time(q['volume_available_at'])>at:return None
        if qty>q[side+'_size'] or qty/volume>policy.max_participation:return None
        impact=policy.impact_bps_at_full_participation*sqrt(qty/volume)/10000
        return q[side]*(1+impact if side=='ask' else 1-impact)
    for q in rows:
        at=time(q['available_at'])
        if at<start:continue
        if filled is None and at>expiry:break
        if filled is not None and at>deadline+timedelta(seconds=policy.exit_wait_seconds):break
        if not valid_quote(q) or (at-time(q['event_at'])).total_seconds()>policy.quote_age_seconds:continue
        if filled is None:
            if q['bid']<=setup['stop']:return finish('INVALIDATED_BEFORE_ENTRY',invalidated_at=at.isoformat())
            if at<start+timedelta(seconds=policy.latency_seconds):continue
            if potential_unknown_entry(q,setup,policy,maximum_spread_pct):
                return finish('UNKNOWN_ENTRY_LIQUIDITY',unknown_liquidity_at=at.isoformat())
            if midpoint_spread_pct(q)>maximum_spread_pct:continue
            price=executable(q,at,'ask')
            if price is None or not setup['entry']<=price<=setup['max_entry']:continue
            filled=price;deadline=at+timedelta(seconds=policy.horizon_seconds)
            base.update(entry_at=at.isoformat(),entry_ask=q['ask'],entry_price=price,deadline=deadline.isoformat())
            excursions.append((q['bid']/filled-1)*100)
            continue
        excursions.append((q['bid']/filled-1)*100)
        if trigger is None:
            trigger='TIMEOUT' if at>=deadline else 'STOP' if q['bid']<=setup['stop'] else 'TARGET' if q['bid']>=setup['target'] else None
            if trigger is not None:trigger_at=at
        if trigger is None:continue
        if not complete(at):return finish('UNKNOWN_EXIT_COVERAGE',trigger=trigger,trigger_at=trigger_at.isoformat())
        price=executable(q,at,'bid')
        if price is None:continue
        fee=policy.fee_bps_per_side/10000
        net=(price*(1-fee)/(filled*(1+fee))-1)*100
        return finish(trigger,net_pct=net,exit_at=at.isoformat(),exit_bid=q['bid'],exit_price=price,
                      trigger_at=trigger_at.isoformat(),exit_delay_seconds=max(0,(at-deadline).total_seconds()))
    if filled is not None:return finish('UNKNOWN_EXIT_COVERAGE',trigger=trigger,trigger_at=trigger_at.isoformat() if trigger_at else None)
    return finish('NO_ENTRY' if complete(expiry) else 'UNKNOWN_ENTRY_COVERAGE')


def inverse_path(rows, setup, coverage_end, allowance):
    start=time(setup['decision_at']);deadline=start+timedelta(minutes=45);end=time(coverage_end)
    for q in rows:
        at=time(q['available_at'])
        if at<=start or at>deadline:continue
        if not valid_quote(q):continue
        if q['bid']<=setup['stop']:return dict(status='STOP_FIRST_INDICATION',at=at.isoformat(),bid=q['bid'])
        if q['bid']>=setup['target']:return dict(status='TARGET_FIRST_INDICATION',at=at.isoformat(),bid=q['bid'])
    fresh=[q for q in rows if deadline<=time(q['available_at'])<=deadline+timedelta(seconds=allowance) and valid_quote(q)]
    if end>=deadline+timedelta(seconds=allowance) and fresh:
        q=fresh[0];return dict(status='NO_BARRIER_FRESH_TIMEOUT',at=q['available_at'],bid=q['bid'])
    return dict(status='UNKNOWN_PATH_OR_TIMEOUT',at=None,bid=None)


def load_inputs():
    inputs=json.loads((ROOT/'research/quote-anchored-inputs.json').read_text())
    protocol_path=ROOT/'research/quote-anchored-protocol.json'
    if sha(protocol_path)!=inputs['protocol_sha256']:raise ValueError('Frozen protocol changed')
    p=json.loads(protocol_path.read_text())
    if p['holdout_opens'] or p['deployment_allowed'] or p['live_rule_changes_allowed']:
        raise ValueError('Development-only protocol')
    for path,digest in p['source_sha256'].items():
        if sha(ROOT/path)!=digest:raise ValueError(f'Frozen input changed: {path}')
    entries=json.loads(gzip.decompress((ROOT/'data/quote-windows.json.gz').read_bytes()))
    exits=json.loads(gzip.decompress((ROOT/'data/exit-windows.json.gz').read_bytes()))
    if [w['setup']['id'] for w in entries['windows']]!=p['cases']:raise ValueError('Case sample changed')
    exit_by_id={w['entry']['id']:w for w in exits['windows']}
    if not set(exit_by_id)<=set(p['cases']) or len(exit_by_id)!=len(exits['windows']):raise ValueError('Exit sample mismatch')
    bars={}
    manifest=json.loads((ROOT/'data/study-manifest.json').read_text())
    for item in manifest['files']:
        path=ROOT/item['path']
        if sha(path)!=item['sha256']:raise ValueError('Bar hash mismatch')
        if path.name.startswith('2026-08-24'):
            bars=json.loads(gzip.decompress(path.read_bytes()))['bars']
    if not bars:raise ValueError('Missing development bars')
    return inputs,p,entries['windows'],exit_by_id,bars


def case_path(entry_window, exit_window, bars, p):
    setup=entry_window['setup'];start=time(setup['at']);intervals=[];quotes=list(entry_window['quotes'])
    if entry_window.get('error') is None and entry_window['feed']=='sip' and len(quotes)<entry_window['limit']:
        intervals.append((setup['at'],setup['expires_at']))
    if exit_window is not None and not exit_window.get('error') and exit_window['feed']=='sip':
        extra=exit_window.get('quotes',[]);quotes+=extra
        a=exit_window['entry']['first_eligible']['at'];deadline=time(a)+timedelta(minutes=45)
        b=extra[-1]['timestamp'] if exit_window.get('truncated',len(extra)>=exit_window['limit']) else (deadline+timedelta(seconds=3)).isoformat()
        intervals.append((a,b))
    end=prefix_end(intervals,start)
    rows,end,quality=prepare(quotes,bars.get(setup['symbol'],[]),start,end,p['entry']['maximum_completed_bar_age_seconds'])
    return rows,end,quality


def build():
    inputs,p,windows,exit_by_id,bars=load_inputs();cases=[]
    for w in windows:
        case=dict(id=w['setup']['id'],symbol=w['setup']['symbol'])
        rows,end,quality=case_path(w,exit_by_id.get(case['id']),bars,p)
        anchor=decision_quote(rows,w['setup']['at'],p['entry']['maximum_midpoint_spread_pct'])
        if anchor is None:
            cases.append({**case,'decision':None,'quality':quality,'coverage_prefix_end':end.isoformat(),
                          'inverse':dict(status='UNKNOWN_NO_DECISION_QUOTE',at=None,bid=None),'scenarios':[]})
            continue
        setup=anchored_setup(case,anchor,p);scenarios=[]
        for delay in p['entry']['latency_seconds']:
            for cost in p['cost_scenarios']:
                policy=Policy(latency_seconds=delay,quote_age_seconds=3,horizon_seconds=p['barriers']['horizon_minutes_after_entry']*60,
                              exit_wait_seconds=p['barriers']['fresh_timeout_allowance_seconds'],max_participation=p['entry']['maximum_participation_of_lagged_minute_volume'],
                              fee_bps_per_side=cost['fee_bps_per_side'],impact_bps_at_full_participation=cost['impact_bps_at_full_participation'])
                result=simulate_anchored(setup,rows,policy,end,p['entry']['maximum_midpoint_spread_pct'])
                scenarios.append(dict(id=f"DELAY_{delay}_{cost['id']}",policy=asdict(policy),result=result))
        cases.append({**case,'decision':dict(at=anchor['available_at'],bid=anchor['bid'],ask=anchor['ask'],
                      spread_pct=midpoint_spread_pct(anchor),bid_size=anchor['bid_size'],ask_size=anchor['ask_size']),
                      'setup':setup,'quality':quality,'coverage_prefix_end':end.isoformat(),
                      'inverse':inverse_path(rows,setup,end,p['barriers']['fresh_timeout_allowance_seconds']),
                      'scenarios':scenarios})
    summary=[]
    ids=[f"DELAY_{d}_{c['id']}" for d in p['entry']['latency_seconds'] for c in p['cost_scenarios']]
    for ident in ids:
        results=[next((s['result'] for s in c['scenarios'] if s['id']==ident),dict(status='UNKNOWN_NO_DECISION_QUOTE',entry_at=None,net_pct=None)) for c in cases]
        status=Counter(r['status'] for r in results)
        summary.append(dict(id=ident,cases=len(results),status_counts=dict(sorted(status.items())),
                            simulated_entries=sum(r.get('entry_at') is not None for r in results),
                            resolved_returns=sum(r.get('net_pct') is not None for r in results),
                            full_sample_expectancy_pct=None,resolved_only_mean_not_strategy_expectancy=True,
                            inverse_no_entry_target_first=sum(r['status']=='NO_ENTRY' and c['inverse']['status']=='TARGET_FIRST_INDICATION' for r,c in zip(results,cases))))
    return dict(as_of='2026-09-26',protocol=p['id'],protocol_commit=inputs['protocol_commit'],status=p['status'],
                sample_cases=len(cases),new_market_requests=0,quote_unit_version=VERSION,summary=summary,cases=cases,
                holdout_opens=0,verified_fills=0,live_rules_changed=False,profitability_claim_allowed=False,
                limits=[p['selection'],p['decision_quote'],p['coverage'],p['missingness'],p['inverse_diagnostic'],p['comparison'],
                        'One exposed development session is not evidence of temporal stability or market-wide recall.',
                        'Event timestamps are used as an explicit receipt-time scenario; actual historical delivery and queue position are unknown.'])


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    report=build();path=ROOT/'data/quote-anchored-report.json';content=dump(report)
    if args.check:
        if not path.exists() or path.read_text()!=content:raise SystemExit('Quote-anchored reproduction mismatch')
    else:path.write_text(content)
    print(dump({k:v for k,v in report.items() if k!='cases'}))
    for c in report['cases']:print(c['id'],c['inverse']['status'],[(s['id'],s['result']['status'],s['result']['net_pct']) for s in c['scenarios']])


if __name__=='__main__':main()
