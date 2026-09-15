"""Entry-quote audit. Does not simulate orders, queue priority or exit profitability."""
import gzip
import json
from pathlib import Path
from datetime import timedelta
from collections import Counter
from engine import timestamp, quote_check


def audit(window, latency_seconds=1):
    s=window['setup']
    rows=sorted(window['quotes'],key=lambda q:timestamp(q['timestamp']))
    earliest=timestamp(s['at'])+timedelta(seconds=latency_seconds)
    truncated=len(rows)>=window['limit']
    result=dict(id=s['id'],symbol=s['symbol'],at=s['at'],bar_outcome=s['outcome'],
                quotes=len(rows),truncated=truncated,latency_seconds=latency_seconds,
                first_eligible=None,sustained_eligible=None,invalidated_at=None,
                approved_for_live=False)
    if window.get('error'):
        return dict(result,status='PROVIDER_ERROR')
    reasons=Counter(); eligible_start=None; previous=None
    for row in rows:
        t=timestamp(row['timestamp'])
        if t<earliest: continue
        if t>timestamp(s['expires_at']): break
        q=dict(timestamp=row['timestamp'],feed=window['feed'],bid=row['bid_price'],ask=row['ask_price'],
               bid_size=row['bid_size'],ask_size=row['ask_size'])
        # Once a valid positive-sized quote breaks the stop, never resurrect setup.
        if 0<q['bid']<=q['ask'] and q['bid_size']>0 and q['ask_size']>0 and q['bid']<=s['stop']:
            result['invalidated_at']=row['timestamp']; break
        status=quote_check(s,q,row['timestamp']); reasons[status]+=1
        if status=='PAPER_EXECUTABLE':
            observation=dict(at=row['timestamp'],bid=q['bid'],ask=q['ask'],
                             spread_pct=round((q['ask']-q['bid'])/((q['ask']+q['bid'])/2)*100,4))
            if result['first_eligible'] is None: result['first_eligible']=observation
            if eligible_start is None or previous is None or (t-previous).total_seconds()>3:
                eligible_start=t
            if (t-eligible_start).total_seconds()>=.5 and result['sustained_eligible'] is None:
                result['sustained_eligible']=observation
        else:
            eligible_start=None
        previous=t
    result['quote_decisions']=dict(reasons)
    result['status']='ELIGIBLE_QUOTES_OBSERVED' if result['first_eligible'] else 'UNKNOWN_TRUNCATED' if truncated else 'NO_ELIGIBLE_QUOTE_OBSERVED'
    return result


def run(data):
    results=[audit(w) for w in data['windows']]
    return dict(scope='Entry feasibility diagnostic, not strategy performance or actual fills',
                selection=data['selection'],news_coverage='UNKNOWN_NOT_CONNECTED',
                assumptions=['One-second processing delay after nominal bar completion; actual historical delivery time unknown.',
                             'SIP L1 displayed quotes do not guarantee an order fill or displayed size persistence.',
                             'A 500ms run is an observed quote sequence with gaps <=3s, not a guaranteed continuous executable window.',
                             'No exit quote replay, no revised P&L, no improvement in trading accuracy claimed.'],
                windows=len(results),quotes=sum(r['quotes'] for r in results),
                eligible_windows=sum(bool(r['first_eligible']) for r in results),
                sustained_windows=sum(bool(r['sustained_eligible']) for r in results),
                bar_rejected_but_quote_seen=sum(r['bar_outcome'] in ['ENTRY_NOT_AVAILABLE','NO_NEXT_MINUTE'] and bool(r['first_eligible']) for r in results),
                results=results,approved_for_live=False)


if __name__=='__main__':
    root=Path(__file__).resolve().parent
    p=root/'data/quote-windows.json.gz'
    data=json.loads(gzip.decompress(p.read_bytes())) if p.exists() else json.loads(p.with_suffix('').read_text())
    report=run(data)
    (root/'data/quote-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
