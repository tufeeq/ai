"""Chronological selection and one-shot held-out diagnostic on a frozen sample."""
import argparse
import gzip
import hashlib
import json
from collections import Counter
from datetime import timedelta
from pathlib import Path
from engine import Config, Detector, simulate, timestamp, ET

ROOT=Path(__file__).resolve().parent


def read_day(day):
    path=ROOT/'data/study'/f'{day}.json.gz'
    data=json.loads(gzip.decompress(path.read_bytes())) if path.exists() else json.loads(path.with_suffix('').read_text())
    if data.get('errors'):
        raise ValueError(f'Incomplete retrieval: {day}')
    return data


def remaining_move(setup, bars, pct, cfg):
    """Counterfactual holding to net +15/+20%, respecting the original stop.

    Not the actual 2R exit policy. No intervening missing minutes are filled.
    """
    at=timestamp(setup['at'])
    later=[b for b in bars if timestamp(b['timestamp'])>=at]
    if not later or timestamp(later[0]['timestamp'])!=at:
        return 'NO_ENTRY_BAR'
    fill=later[0]['open']
    if not setup['entry']<=fill<=setup['max_entry']:
        return 'ENTRY_NOT_AVAILABLE'
    target=fill*(1+cfg.cost_per_side)*(1+pct)/(1-cfg.cost_per_side)
    previous=at-timedelta(minutes=1)
    for b in later:
        t=timestamp(b['timestamp'])
        if t!=previous+timedelta(minutes=1):
            return 'UNKNOWN_GAP'
        previous=t
        stop,hit=b['low']<=setup['stop'],b['high']>=target
        if stop and hit: return 'AMBIGUOUS'
        if stop: return 'STOP_FIRST'
        if hit: return 'TARGET_FIRST'
        end=(t+timedelta(minutes=1)).astimezone(ET)
        if end.hour==16 and end.minute==0: return 'NOT_REACHED'
    return 'INCOMPLETE_SESSION'


def summarize(rows):
    values=[s['net_pct'] for s in rows if s['net_pct'] is not None]
    losses=[x for x in values if x<0]
    gains=[x for x in values if x>0]
    return dict(setups=len(rows), unique_symbols=len({s['symbol'] for s in rows}),
                resolved=len(values), positive_net=len(gains), non_positive_net=len(values)-len(gains),
                positive_rate_pct=round(len(gains)/len(values)*100,2) if values else None,
                mean_net_pct=round(sum(values)/len(values),4) if values else None,
                worst_net_pct=min(values) if values else None,
                profit_factor=round(sum(gains)/abs(sum(losses)),4) if losses else None,
                outcomes=dict(Counter(s['outcome'] for s in rows)),
                remaining_net_15=dict(Counter(s['remaining_net_15'] for s in rows)),
                remaining_net_20=dict(Counter(s['remaining_net_20'] for s in rows)))


def evaluate(protocol, days, overrides):
    cfg=Config(**overrides)
    rows, coverage, daily=[],[],[]
    for day in days:
        data=read_day(day)
        engine=Detector(protocol['metadata'],cfg,retrospective_metadata=True)
        events=[]
        missing=[]
        for meta in protocol['metadata']:
            symbol=meta['symbol']; bars=data['bars'].get(symbol,[])
            if not bars: missing.append(symbol)
            seen=set()
            for b in bars:
                t=timestamp(b['timestamp'])
                if t in seen or t.astimezone(ET).date().isoformat()!=day:
                    raise ValueError('Duplicate bar or wrong session')
                seen.add(t)
                events.append((t,symbol,b))
        day_rows=[]
        for t,symbol,b in sorted(events):
            signal=engine.on_bar(symbol,b,(t+timedelta(minutes=1)).isoformat())
            if signal:
                result=simulate(signal,data['bars'][symbol],cfg)
                result['remaining_net_15']=remaining_move(signal,data['bars'][symbol],.15,cfg)
                result['remaining_net_20']=remaining_move(signal,data['bars'][symbol],.20,cfg)
                day_rows.append(result)
        rows.extend(day_rows)
        coverage.append(dict(date=day,bars=len(events),missing_symbols=missing))
        daily.append(dict(date=day,**summarize(day_rows)))
    return dict(summary=summarize(rows),daily=daily,coverage=coverage,signals=rows)


def protocol_hash(p):
    return hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest()


def choose(results):
    eligible=[]
    for name,r in results.items():
        train,val=r['training']['summary'],r['validation']['summary']
        if (train['resolved']>=20 and train['mean_net_pct']>0 and
            val['resolved']>=10 and val['mean_net_pct']>0):
            eligible.append(name)
    return max(eligible,key=lambda name:results[name]['validation']['summary']['mean_net_pct']) if eligible else None


def freeze(protocol, path):
    if path.exists() or path.with_suffix(path.suffix+'.gz').exists():
        raise ValueError('Selection already frozen; do not overwrite after test access')
    results={h['name']:{phase:evaluate(protocol,protocol[phase],h['overrides'])
                        for phase in ('training','validation')} for h in protocol['hypotheses']}
    choice=choose(results)
    frozen=dict(protocol_sha256=protocol_hash(protocol), selected=choice,
                status='CANDIDATE_SELECTED_FOR_TEST' if choice else 'NO_CANDIDATE_PASSED',
                approved_for_live=False, results=results)
    path.write_text(json.dumps(frozen,indent=2)+'\n')
    return frozen


def heldout(protocol, frozen):
    if frozen['protocol_sha256']!=protocol_hash(protocol):
        raise ValueError('Protocol changed after selection')
    # Always measure the original baseline; never choose a replacement based on test outcomes.
    names=['BASE']
    if frozen['selected'] and frozen['selected'] not in names:
        names.append(frozen['selected'])
    hypotheses={h['name']:h['overrides'] for h in protocol['hypotheses']}
    results={name:evaluate(protocol,protocol['test'],hypotheses[name]) for name in names}
    return dict(protocol_sha256=protocol_hash(protocol), selected=frozen['selected'],
                selection_status=frozen['status'], approved_for_live=False,
                reason='Historical current-membership sample and OHLC fill approximations cannot establish live executability.',
                limitations=protocol['limits'], test=results)


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('phase',choices=['freeze','test'])
    a=p.parse_args(); protocol=json.loads((ROOT/'data/study-protocol.json').read_text())
    frozen_path=ROOT/'data/study-selection.json'
    if a.phase=='freeze':
        result=freeze(protocol,frozen_path)
        print(json.dumps(dict(selected=result['selected'],results={name:{phase:x['summary'] for phase,x in r.items()} for name,r in result['results'].items()}),indent=2))
    else:
        raw=gzip.decompress(frozen_path.with_suffix('.json.gz').read_bytes()) if not frozen_path.exists() else frozen_path.read_text()
        result=heldout(protocol,json.loads(raw))
        (ROOT/'data/study-test.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({name:r['summary'] for name,r in result['test'].items()},indent=2))
