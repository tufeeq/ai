"""Evaluate server observations using the SAME Phase 1 execution function.

Research-only: no broker calls, no inferred fills during gaps, no IEX-as-SIP.
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime,timedelta,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from research.events import time
from research.execution import simulate,Policy


def evaluate(db,lots=None,now=None):
    now=now or datetime.now(timezone.utc);lots=lots or []
    signals=db.execute('SELECT id,symbol,at,feed,payload FROM signals ORDER BY at').fetchall()
    count=0
    for ident,symbol,at,feed,raw in signals:
        # Frozen terminal outcomes are not retrospectively revised by later data.
        previous=db.execute('SELECT status FROM outcomes WHERE id=?',(ident,)).fetchone()
        if previous and previous[0] in ('TARGET','STOP','TIMEOUT','INVALIDATED_BEFORE_ENTRY','NO_PLAN','NO_ENTRY'):continue
        signal=json.loads(raw);plan=signal.get('plan');start=time(at);end=min(now,start+timedelta(minutes=35))
        result={'id':ident,'status':'WAITING','net_pct':None,'approved_for_live':False}
        if not plan:result['status']='NO_PLAN'
        elif feed!='sip':result['status']='SINGLE_EXCHANGE_OR_DELAYED'
        else:
            candidates=[l for l in lots if l.get('symbol')==symbol and l.get('source')
                        and time(l['available_at'])<=start and time(l['valid_from'])<=start<time(l['valid_until'])
                        and isinstance(l.get('shares'),int) and not isinstance(l['shares'],bool) and l['shares']>0]
            lot=max(candidates,key=lambda l:time(l['available_at'])) if candidates else None
            if lot is None:result['status']='UNKNOWN_ROUND_LOT_SIZE'
            else:
                iso=lambda t:t.isoformat(timespec='milliseconds').replace('+00:00','Z')
                lower=start-timedelta(minutes=3)
                rows=db.execute('SELECT sequence,received_at,kind,payload FROM events WHERE received_at>=? AND received_at<=? AND (symbol=? OR symbol IS NULL) ORDER BY sequence',(iso(lower),iso(end),symbol)).fetchall()
                # Coverage is an observed connection/subscription interval, not a fill guarantee.
                previous_state=db.execute("SELECT kind,payload FROM events WHERE symbol IS NULL AND kind IN ('STREAM_STATUS','RUNTIME_START') AND received_at<? ORDER BY sequence DESC LIMIT 1",(iso(lower),)).fetchone()
                prior_state=json.loads(previous_state[1]) if previous_state and previous_state[0]=='STREAM_STATUS' else {}
                connected=prior_state.get('state')=='SUBSCRIBED' and prior_state.get('feed')=='sip' and symbol in prior_state.get('subscribed_symbols',[])
                began=False;complete=True;quotes=[];bars={}
                for seq,received,kind,payload in rows:
                    r=json.loads(payload);received=time(received)
                    if not began and received>=start:began=True;complete=connected
                    if kind=='STREAM_STATUS':
                        connected=(r.get('state')=='SUBSCRIBED' and r.get('feed')=='sip' and symbol in r.get('subscribed_symbols',[]))
                        if received>=start and not connected:complete=False
                    elif kind=='RUNTIME_START':
                        connected=False
                        if received>=start:complete=False
                    elif kind=='MARKET':
                        if r.get('feed')!='sip':continue
                        if r.get('T') in ('b','u') and time(r['t'])+timedelta(minutes=1)<=received:
                            bars[r['t']]={**r,'available_at':received}
                        elif r.get('T')=='q' and received>=start:
                            prior=[b for b in bars.values() if time(b['t'])+timedelta(minutes=1)<=received and (received-time(b['t'])).total_seconds()<=150]
                            b=max(prior,key=lambda x:time(x['t'])) if prior else None
                            quotes.append(dict(sequence=seq,event_at=r['t'],available_at=received.isoformat(),
                                bid=r.get('bp'),ask=r.get('ap'),bid_size=(r.get('bs') or 0)*lot['shares'],ask_size=(r.get('as') or 0)*lot['shares'],
                                lagged_volume=b.get('v') if b else None,volume_available_at=b['available_at'].isoformat() if b else None,
                                volume_end_at=(time(b['t'])+timedelta(minutes=1)).isoformat() if b else None))
                if not began:complete=False
                setup=dict(id=ident,symbol=symbol,at=at,expires_at=(start+timedelta(seconds=30)).isoformat(),
                           quantity=1,entry=plan['entry'],max_entry=plan['entry']*1.001,stop=plan['stop'],target=plan['targets'][-1])
                try:result=simulate(setup,quotes,Policy(),dict(complete=complete,start=at,end=end.isoformat()))
                except (ValueError,KeyError,TypeError):result['status']='INVALID_PLAN_OR_EVENT'
                if result['status']=='NO_ENTRY' and now<start+timedelta(seconds=30):result['status']='WAITING'
                result.update(quantity=1,lot_size_source=lot['source'],coverage_basis='OBSERVED_SUBSCRIPTION_ONLY',
                              policy='PHASE1_UNCALIBRATED_ONE_SHARE',performance_claim_allowed=False)
        result['evaluated_at']=now.isoformat()
        db.execute('INSERT INTO outcomes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload',(ident,result['status'],json.dumps(result,allow_nan=False)))
        count+=1
    db.commit();return count


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--lots');a=p.parse_args()
    lots=json.loads(Path(a.lots).read_text()) if a.lots else []
    with sqlite3.connect(a.db,timeout=5) as db:print(json.dumps({'evaluated':evaluate(db,lots),'profitability_claim_allowed':False}))
