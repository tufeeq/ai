#!/usr/bin/env python3
import json,math,pathlib
from datetime import datetime,timezone

RICH=pathlib.Path('tag/data/finviz-rich.json')
LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def ts(v):
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except:return None

rich=read(RICH,{});ledger=read(LEDGER,{})
cur=ts(rich.get('updatedAt'));session=str(rich.get('session') or '').lower()
if not cur or session not in ('pre-market','regular','after-hours'):
    print(json.dumps({'status':'SKIP','reason':'inactive_or_bad_timestamp','session':session}));raise SystemExit(0)
prices={}
for r in rich.get('rows') or []:
    t=r.get('_tagit') or {};sym=str(r.get('Ticker') or '').upper();p=t.get('price')
    if sym and finite(p):prices[sym]=float(p)
updated=mature30=mature60=0
for rec in ledger.get('records') or []:
    opened=ts(rec.get('timestamp'));sym=str(rec.get('symbol') or '').upper();ref=rec.get('referencePrice')
    if not opened or opened.date()!=cur.date() or sym not in prices or not finite(ref) or float(ref)<=0:continue
    elapsed=(cur-opened).total_seconds()/60
    if elapsed<=0 or elapsed>480:continue
    ret=(prices[sym]/float(ref)-1)*100
    rec['lastObservedAt']=rich.get('updatedAt');rec['lastObservedPrice']=round(prices[sym],6);rec['lastReturnPct']=round(ret,3)
    rec['mfePct']=round(max(float(rec.get('mfePct')) if finite(rec.get('mfePct')) else ret,ret),3)
    rec['maePct']=round(min(float(rec.get('maePct')) if finite(rec.get('maePct')) else ret,ret),3)
    if elapsed<=30:
        rec['mfe30Pct']=round(max(float(rec.get('mfe30Pct')) if finite(rec.get('mfe30Pct')) else ret,ret),3)
        rec['mae30Pct']=round(min(float(rec.get('mae30Pct')) if finite(rec.get('mae30Pct')) else ret,ret),3)
    if elapsed<=60:
        rec['mfe60Pct']=round(max(float(rec.get('mfe60Pct')) if finite(rec.get('mfe60Pct')) else ret,ret),3)
        rec['mae60Pct']=round(min(float(rec.get('mae60Pct')) if finite(rec.get('mae60Pct')) else ret,ret),3)
    if elapsed>=30 and rec.get('hit5_30m') is None:
        rec['hit5_30m']=bool((float(rec.get('mfe30Pct')) if finite(rec.get('mfe30Pct')) else rec['mfePct'])>=5);rec['mature30At']=rich.get('updatedAt');mature30+=1
    if elapsed>=60 and rec.get('hit10_60m') is None:
        rec['hit10_60m']=bool((float(rec.get('mfe60Pct')) if finite(rec.get('mfe60Pct')) else rec['mfePct'])>=10);rec['mature60At']=rich.get('updatedAt');rec['label']=1 if rec['hit10_60m'] else 0;mature60+=1
    updated+=1
ledger['outcomeLabeling']={'updatedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'POINT_IN_TIME_CURRENT_AND_PRIOR_SNAPSHOTS_ONLY','updatedRecords':updated,'newMature30':mature30,'newMature60':mature60}
LEDGER.write_text(json.dumps(ledger,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','updatedRecords':updated,'newMature30':mature30,'newMature60':mature60,'symbolsObserved':len(prices)}))
