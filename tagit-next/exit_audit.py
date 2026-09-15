"""Ask-entry / bid-exit quote-path diagnostic, never an actual-fill claim."""
import gzip
import json
import math
from pathlib import Path
from datetime import timedelta
from collections import Counter
from engine import timestamp, Config


def valid_quote(q):
    fields=('bid_price','ask_price','bid_size','ask_size')
    if any(not isinstance(q.get(k),(int,float)) or not math.isfinite(q[k]) for k in fields):
        return False
    return 0<q['bid_price']<=q['ask_price'] and q['bid_size']>0 and q['ask_size']>0


def evaluate(window, setup, cost=.0025):
    entry=window['entry']['first_eligible']
    at=timestamp(entry['at']); deadline=at+timedelta(minutes=45)
    result=dict(id=setup['id'],symbol=setup['symbol'],entry_at=entry['at'],entry_ask=entry['ask'],
                stop=setup['stop'],target=setup['target'],net_pct=None,
                outcome='UNKNOWN',approved_for_live=False)
    if window.get('error'): return dict(result,outcome='PROVIDER_ERROR')
    quotes=sorted(window.get('quotes',[]),key=lambda q:timestamp(q['timestamp']))
    result['quotes']=len(quotes)
    result['limit_reached']=window.get('truncated',len(quotes)>=window['limit'])
    previous=None
    def exit_at(label, q, when):
        price=q['bid_price']
        return dict(result,outcome=label,exit_at=when.isoformat(),exit_bid=price,
                    net_pct=round((price*(1-cost)/(entry['ask']*(1+cost))-1)*100,4))
    for q in quotes:
        t=timestamp(q['timestamp'])
        if t<at: continue
        valid=valid_quote(q)
        if t>deadline:
            # Exit at the first fresh valid quote at/after the deadline, <=3s delay.
            if (t-deadline).total_seconds()>3:
                break
            if valid:
                return exit_at('TIMEOUT',q,t)
            # Invalid updates do not end the search for a later valid quote
            # inside the SAME frozen allowance, and invalidate stale fallback.
            previous=None
            continue
        if not valid:
            previous=None
            continue
        previous=q
        if q['bid_price']<=setup['stop']: return exit_at('STOP',q,t)
        if q['bid_price']>=setup['target']: return exit_at('TARGET',q,t)
        if t==deadline: return exit_at('TIMEOUT',q,t)
    if result['limit_reached'] and quotes and timestamp(quotes[-1]['timestamp'])<deadline:
        return dict(result,outcome='UNKNOWN_TRUNCATED')
    # Carrying an unchanged last quote is explicitly bounded by freshness.
    if previous and 0 <= (deadline-timestamp(previous['timestamp'])).total_seconds()<=3:
        return exit_at('TIMEOUT_LAST_FRESH_QUOTE',previous,deadline)
    return dict(result,outcome='UNKNOWN_TIMEOUT_QUOTE')


def load_data(path):
    path=Path(path)
    return json.loads(gzip.decompress(path.with_suffix('.json.gz').read_bytes())) if not path.exists() else json.loads(path.read_text())


def run(entries, exits):
    setups={w['setup']['id']:w['setup'] for w in entries['windows']}
    results=[evaluate(w,setups[w['entry']['id']]) for w in exits['windows']]
    known=[r['net_pct'] for r in results if r['net_pct'] is not None]
    return dict(scope='Development-only quote-path diagnostic; not actual fills or held-out performance',
                signals_considered=len(entries['windows']),entries=len(results),resolved=len(known),
                positive_net=sum(x>0 for x in known),mean_net_pct=round(sum(known)/len(known),4) if known else None,
                outcomes=dict(Counter(r['outcome'] for r in results)),
                quotes=sum(len(w.get('quotes',[])) for w in exits['windows']),
                assumptions=['Entry at previously observed eligible ask; exit at observed bid, plus 0.25% cost each side.',
                             'Frozen original stop/target; 45-minute maximum holding time from quote entry.',
                             'No orders, queue model, position sizing, halt verification or actual delivery-time reconstruction.',
                             'A capped quote prefix can resolve an earlier exit but cannot establish a later timeout.',
                             'This August 24 development sample must not be used to claim validation or accuracy improvement.'],
                approved_for_live=False,results=results)


if __name__=='__main__':
    root=Path(__file__).resolve().parent
    report=run(load_data(root/'data/quote-windows.json'),load_data(root/'data/exit-windows.json'))
    (root/'data/exit-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
