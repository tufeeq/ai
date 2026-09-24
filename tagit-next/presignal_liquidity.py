"""Frozen pre-signal quote-liquidity study; development evidence only."""
import json
import math
from collections import Counter
from datetime import timedelta
from pathlib import Path
from statistics import median

from engine import timestamp
from quote_audit import audit


def valid_quote(q):
    fields=('bid_price','ask_price','bid_size','ask_size')
    return (all(isinstance(q.get(k),(int,float)) and math.isfinite(q[k]) for k in fields)
            and 0 < q['bid_price'] <= q['ask_price']
            and q['bid_size'] > 0 and q['ask_size'] > 0)


def nearest_rank(values, fraction):
    if not values:
        return None
    values=sorted(values)
    return values[max(0,math.ceil(fraction*len(values))-1)]


def features(rows, event_at, seconds=60):
    end=timestamp(event_at); start=end-timedelta(seconds=seconds)
    valid=[]
    for q in sorted(rows,key=lambda x:timestamp(x['timestamp'])):
        t=timestamp(q['timestamp'])
        if start <= t < end and valid_quote(q):
            mid=(q['ask_price']+q['bid_price'])/2
            valid.append((t,(q['ask_price']-q['bid_price'])/mid*10000,
                          q['bid_price']*q['bid_size']+q['ask_price']*q['ask_size']))
    spreads=[q[1] for q in valid]; notionals=[q[2] for q in valid]
    age=(end-valid[-1][0]).total_seconds() if valid else None
    p90=nearest_rank(spreads,.9)
    ready=(len(valid)>=5 and p90 is not None and p90<=80
           and age is not None and 0<=age<=3)
    return dict(valid_quotes=len(valid),update_rate_per_second=round(len(valid)/seconds,6),
                median_spread_bps=round(median(spreads),6) if spreads else None,
                p90_spread_bps=round(p90,6) if p90 is not None else None,
                median_displayed_notional=round(median(notionals),4) if notionals else None,
                terminal_age_seconds=round(age,6) if age is not None else None,
                liquidity_ready=ready)


def run(protocol,raw):
    cases=protocol['selection']['cases']; windows={w['id']:w for w in raw['windows']}
    if len(windows)!=len(raw['windows']) or set(windows)!={c['id'] for c in cases}:
        raise ValueError('Raw windows must exactly match frozen cases')
    results=[]
    for c in cases:
        w=windows[c['id']]; rows=w.get('quotes',[])
        base=dict(id=c['id'],symbol=c['symbol'],known_candle_outcome=c['known_candle_outcome'],
                  known_candle_net_pct=c['known_candle_net_pct'],provider_error=w.get('error'),
                  truncated=bool(w.get('truncated')),approved_for_live=False)
        if w.get('error') or w.get('truncated'):
            results.append(dict(base,signal_features=None,control_features=None,
                                paper_entry_status='UNKNOWN_PROVIDER_OR_TRUNCATION',pair_result='UNKNOWN'))
            continue
        signal=features(rows,c['signal_at']); control=features(rows,c['control_at'])
        setup=dict(id=c['id'],symbol=c['symbol'],at=c['signal_at'],expires_at=c['expires_at'],
                   outcome=c['known_candle_outcome'],entry=c['entry'],max_entry=c['max_entry'],
                   stop=c['stop'],target=c['target'])
        entry_rows=[q for q in rows if timestamp(c['signal_at'])<=timestamp(q['timestamp'])<=timestamp(c['expires_at'])]
        entry=audit(dict(setup=setup,quotes=entry_rows,feed='sip',limit=len(entry_rows)+1),latency_seconds=1)
        complete=signal['median_spread_bps'] is not None and control['median_spread_bps'] is not None
        pair_win=(complete and signal['update_rate_per_second']>control['update_rate_per_second']
                  and signal['median_spread_bps']<=control['median_spread_bps'])
        results.append(dict(base,signal_features=signal,control_features=control,
                            paper_entry_status=entry['status'],paper_entry_observed=bool(entry['first_eligible']),
                            pair_result='WIN' if pair_win else 'LOSS' if complete else 'UNKNOWN'))
    rules=protocol.get('decision_rules',{})
    primary_min_wins=rules.get('primary_min_wins',6)
    secondary_min_group=rules.get('secondary_min_group_size',3)
    secondary_min_difference=rules.get('secondary_min_rate_difference',.25)
    wins=sum(r['pair_result']=='WIN' for r in results)
    primary=dict(wins=wins,total_frozen=len(results),unknown=sum(r['pair_result']=='UNKNOWN' for r in results),
                 passed=wins>=primary_min_wins,
                 decision='PASS' if wins>=primary_min_wins else 'REJECT')
    ready=[r for r in results if r.get('signal_features') and r['signal_features']['liquidity_ready']]
    not_ready=[r for r in results if r.get('signal_features') and not r['signal_features']['liquidity_ready']]
    def rate(group):
        return sum(r.get('paper_entry_observed',False) for r in group)/len(group) if group else None
    rr,nr=rate(ready),rate(not_ready)
    sufficient=len(ready)>=secondary_min_group and len(not_ready)>=secondary_min_group
    diff=(rr-nr) if sufficient else None
    secondary=dict(ready_cases=len(ready),not_ready_cases=len(not_ready),
                   ready_entry_observed=sum(r.get('paper_entry_observed',False) for r in ready),
                   not_ready_entry_observed=sum(r.get('paper_entry_observed',False) for r in not_ready),
                   ready_entry_rate=round(rr,4) if rr is not None else None,
                   not_ready_entry_rate=round(nr,4) if nr is not None else None,
                   rate_difference=round(diff,4) if diff is not None else None,
                   decision='PASS' if sufficient and diff>=secondary_min_difference else 'REJECT' if sufficient else 'INSUFFICIENT_GROUP_SIZE')
    if protocol['scope'].startswith('Development-only'):
        limitations=['Historical quote event times are not receipt times or fills.',
                     'Eight development pairs are insufficient for a performance claim.',
                     'Candle outcomes were known before this feature study but were excluded from selection.',
                     'No validation/test period, news archive, halt verification or portfolio simulation used.']
    else:
        limitations=['Historical quote event times are not receipt times or fills.',
                     f'{len(results)} validation pairs are insufficient for a performance claim.',
                     'Candle outcomes predated this replication but were excluded from deterministic selection and all thresholds.',
                     'No held-out test period, news archive, halt verification or portfolio simulation used.']
    return dict(scope=protocol['scope'],protocol_commit=raw['protocol_commit'],market_requests=raw['market_requests'],
                quotes=raw['quotes'],news_coverage='UNKNOWN_NOT_CONNECTED',primary=primary,secondary=secondary,
                outcomes=dict(Counter(r['known_candle_outcome'] for r in results)),results=results,
                limitations=limitations,
                approved_for_live=False)


if __name__=='__main__':
    root=Path(__file__).resolve().parent/'data'
    report=run(json.loads((root/'presignal-liquidity-protocol.json').read_text()),
               json.loads((root/'presignal-liquidity-quotes.json').read_text()))
    (root/'presignal-liquidity-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
