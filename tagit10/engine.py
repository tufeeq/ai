#!/usr/bin/env python3
import csv, io, json, math, os, random, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET=ZoneInfo('America/New_York')
ROOT=Path(__file__).resolve().parents[1]
STATE_PATH=ROOT/'tagit10-state.json'
OUT_PATH=ROOT/'tagit10-live.json'
TOKEN=os.getenv('FINVIZ_TOKEN','').strip()
UA='Mozilla/5.0 TAGit10/1.0'

def now(): return datetime.now(timezone.utc)
def n(v,d=None):
    try:
        if v is None:return d
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip())
        return x if math.isfinite(x) else d
    except:return d

def get(url,timeout=12):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read()

def session(et):
    t=et.time()
    if et.weekday()>=5:return 'closed'
    from datetime import time as T
    if T(4)<=t<T(9,30):return 'pre-market'
    if T(9,30)<=t<T(16):return 'regular'
    if T(16)<=t<T(20):return 'after-hours'
    return 'closed'

def load_state():
    try:return json.loads(STATE_PATH.read_text())
    except:return {'schemaVersion':10,'sessionDateET':None,'symbols':{},'events':[],'sweepCursor':0,'finviz':{}}

def save_state(s):
    # keep bounded, auditable state rather than every quote
    s['events']=s.get('events',[])[-5000:]
    if len(s.get('symbols',{}))>2500:
        ranked=sorted(s['symbols'].items(),key=lambda kv:(kv[1].get('lastScore',0),kv[1].get('lastSeenUTC','')),reverse=True)[:2500]
        s['symbols']=dict(ranked)
    STATE_PATH.write_text(json.dumps(s,separators=(',',':')))

def finviz_rows():
    if not TOKEN:return []
    merged={}
    for sig in ('ta_topgainers','ta_unusualvolume','ta_mostactive'):
        try:
            raw=get(f'https://elite.finviz.com/export/screener?s={sig}&v=152&auth={TOKEN}',20).decode('utf-8-sig','ignore')
            for r in csv.DictReader(io.StringIO(raw)):
                sym=(r.get('Ticker') or '').strip().upper()
                if not sym:continue
                z=merged.setdefault(sym,{})
                z.update(r); z.setdefault('_lanes',[]).append(sig)
        except Exception: pass
        time.sleep(.7)
    return list(merged.values())

def symbol_directory():
    out=[]
    urls=[
      'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
      'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt']
    for u in urls:
        try:
            txt=get(u,15).decode('utf-8','ignore')
            for row in txt.splitlines()[1:]:
                p=row.split('|'); sym=(p[0] if p else '').strip().upper()
                if sym and sym.isascii() and '$' not in sym and '.' not in sym and len(sym)<=5 and sym not in ('FILE CREATION TIME','ACT SYMBOL'):
                    out.append(sym)
        except Exception: pass
    return sorted(set(out))

def chart(sym):
    try:
        url=f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d&includePrePost=true&events=div%2Csplits'
        j=json.loads(get(url,10)); r=j['chart']['result'][0]; ts=r.get('timestamp') or []; q=r['indicators']['quote'][0]
        closes=q.get('close') or []; vols=q.get('volume') or []
        pts=[(t,n(c),n(v,0) or 0) for t,c,v in zip(ts,closes,vols) if n(c) is not None]
        if len(pts)<3:return None
        meta=r.get('meta') or {}; prev=n(meta.get('chartPreviousClose') or meta.get('previousClose'))
        return pts,meta,prev
    except:return None

def features(sym, fr=None):
    res=chart(sym)
    if not res:return None
    pts,meta,prev=res; prices=[x[1] for x in pts]; vols=[x[2] for x in pts]
    p=prices[-1]; prev=prev or prices[0]
    change=(p/prev-1)*100 if prev else 0
    def ret(k): return (p/prices[-1-k]-1)*100 if len(prices)>k and prices[-1-k] else 0
    def rng(k):
        xs=prices[-k:] if len(prices)>=k else prices
        return (max(xs)/min(xs)-1)*100 if xs and min(xs)>0 else 99
    v5=sum(vols[-5:]); v15=sum(vols[-15:]); prior15=sum(vols[-30:-15]) if len(vols)>=30 else 0
    vacc=(v15/prior15) if prior15>0 else (v5/max(1,sum(vols[-10:-5])))
    dayvol=sum(vols)
    fin_rvol=n((fr or {}).get('Relative Volume'))
    avgvol=n((fr or {}).get('Average Volume'))
    rvol=fin_rvol if fin_rvol is not None else (dayvol/avgvol if avgvol else None)
    high=max(prices); prox=p/high if high else 0
    compress=max(0,1-min(rng(15),6)/6)
    accel=min(max(vacc,0),5)/5
    rv=min(max((rvol or 1)-1,0),4)/4
    momentum=min(max(ret(5),-2)+2,8)/8
    # Coverage-first score: reward abnormal flow while price is still contained.
    score=100*(0.34*accel+0.28*rv+0.23*compress+0.15*momentum)
    if change>=10: score*=0.72
    if change>=20: score*=0.55
    stage='WATCH'
    early=change<10 and score>=36 and (vacc>=1.25 or (rvol or 0)>=1.5) and rng(15)<=5.0
    actionable=change<15 and score>=58 and prox>=0.92 and ret(5)>=-1.5
    confirmed=score>=68 and ret(5)>0.5 and v5>0
    if early:stage='EARLY'
    if actionable:stage='ACTIONABLE'
    if confirmed:stage='CONFIRMED'
    return {'symbol':sym,'price':round(p,6),'changePct':round(change,3),'ret5mPct':round(ret(5),3),'ret15mPct':round(ret(15),3),'range15mPct':round(rng(15),3),'volume5m':int(v5),'volume15m':int(v15),'volumeAcceleration15m':round(vacc,3),'relativeVolume':round(rvol,3) if rvol is not None else None,'nearDayHigh':round(prox,4),'score':round(score,2),'stage':stage,'quoteTimestampUTC':datetime.fromtimestamp(pts[-1][0],timezone.utc).isoformat(),'lanes':(fr or {}).get('_lanes',[])}

def main():
    t=now(); et=t.astimezone(ET); sess=session(et); state=load_state(); date=et.date().isoformat()
    if state.get('sessionDateET')!=date: state={'schemaVersion':10,'sessionDateET':date,'symbols':{},'events':[],'sweepCursor':0,'finviz':{}}
    frs=finviz_rows(); fmap={(r.get('Ticker') or '').strip().upper():r for r in frs}
    hot=list(fmap)
    # Retain all symbols that have shown meaningful signal today.
    retained=[s for s,v in state['symbols'].items() if v.get('bestStage') in ('EARLY','ACTIONABLE','CONFIRMED') or v.get('lastScore',0)>=32]
    hot=list(dict.fromkeys(hot+retained))[:320]

    directory=symbol_directory()
    cursor=int(state.get('sweepCursor',0)); sweep=[]
    if directory:
        take=650; sweep=[directory[(cursor+i)%len(directory)] for i in range(min(take,len(directory)))]
        state['sweepCursor']=(cursor+take)%len(directory)
    universe=list(dict.fromkeys(hot+sweep))
    rows=[]
    with ThreadPoolExecutor(max_workers=28) as ex:
        fut={ex.submit(features,s,fmap.get(s)):s for s in universe}
        for f in as_completed(fut):
            x=f.result()
            if x:rows.append(x)

    rank={'WATCH':0,'EARLY':1,'ACTIONABLE':2,'CONFIRMED':3}
    for x in rows:
        s=x['symbol']; rec=state['symbols'].setdefault(s,{'firstSeenUTC':t.isoformat(),'bestStage':'WATCH','firstChangePct':x['changePct'],'maxScore':0})
        old=rec.get('bestStage','WATCH')
        rec.update({'lastSeenUTC':t.isoformat(),'lastScore':x['score'],'lastChangePct':x['changePct'],'maxScore':max(rec.get('maxScore',0),x['score'])})
        if rank[x['stage']]>rank.get(old,0):
            rec['bestStage']=x['stage']; rec['stageFirstUTC']=t.isoformat(); rec['stageFirstChangePct']=x['changePct']
            state['events'].append({'ts':t.isoformat(),'symbol':s,'event':'STAGE_UP','from':old,'to':x['stage'],'changePct':x['changePct'],'score':x['score']})

    # Broad radar is intentionally large to optimize early recall; actionable is a separate precision layer.
    watch=sorted(rows,key=lambda x:x['score'],reverse=True)[:140]
    early=[x for x in watch if x['stage'] in ('EARLY','ACTIONABLE','CONFIRMED') and x['changePct']<10][:70]
    action=[x for x in watch if x['stage'] in ('ACTIONABLE','CONFIRMED')][:35]
    confirmed=[x for x in action if x['stage']=='CONFIRMED'][:20]
    out={'schemaVersion':10,'mode':'FORWARD_PIT_COVERAGE_FIRST','goal':{'earlyTop50RecallPct':70,'status':'TARGET_NOT_GUARANTEED'},'updatedAtUTC':t.isoformat(),'updatedAtET':et.isoformat(),'session':sess,'universeScanned':len(universe),'quotesValid':len(rows),'hotLane':len(hot),'sweepLane':len(sweep),'watch':watch,'early':early,'actionable':action,'confirmed':confirmed,'truth':{'uiPollSeconds':10,'backendCadenceSeconds':90,'dataSource':'Yahoo 1m + Finviz Elite + Nasdaq Trader symbol directory','note':'70% is a forward-validation target, not a claimed achieved accuracy.'}}
    OUT_PATH.write_text(json.dumps(out,separators=(',',':')))
    save_state(state)
    print(json.dumps({'session':sess,'scanned':len(universe),'valid':len(rows),'watch':len(watch),'early':len(early),'actionable':len(action),'confirmed':len(confirmed)}))

if __name__=='__main__': main()
