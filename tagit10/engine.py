#!/usr/bin/env python3
import csv, io, json, math, os, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET=ZoneInfo('America/New_York'); ROOT=Path(__file__).resolve().parents[1]
STATE_PATH=ROOT/'tagit10-state.json'; OUT_PATH=ROOT/'tagit10-live.json'; TOKEN=os.getenv('FINVIZ_TOKEN','').strip(); UA='Mozilla/5.0 TAGit10/1.2'
def now(): return datetime.now(timezone.utc)
def n(v,d=None):
    try:
        if v is None:return d
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip()); return x if math.isfinite(x) else d
    except:return d
def get(url,timeout=12):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read()
def session(et):
    from datetime import time as T
    t=et.time()
    if et.weekday()>=5:return 'closed'
    if T(4)<=t<T(9,30):return 'pre-market'
    if T(9,30)<=t<T(16):return 'regular'
    if T(16)<=t<T(20):return 'after-hours'
    return 'closed'
def load_state():
    try:return json.loads(STATE_PATH.read_text())
    except:return {'schemaVersion':10,'sessionDateET':None,'symbols':{},'events':[],'sweepCursor':0}
def save_state(s):
    s['events']=s.get('events',[])[-5000:]
    if len(s.get('symbols',{}))>2500:s['symbols']=dict(sorted(s['symbols'].items(),key=lambda kv:(kv[1].get('maxScore',0),kv[1].get('lastSeenUTC','')),reverse=True)[:2500])
    STATE_PATH.write_text(json.dumps(s,separators=(',',':')))
def finviz_rows():
    if not TOKEN:return []
    merged={}
    for sig in ('ta_topgainers','ta_unusualvolume','ta_mostactive'):
        try:
            raw=get(f'https://elite.finviz.com/export/screener?s={sig}&v=152&auth={TOKEN}',20).decode('utf-8-sig','ignore')
            for r in csv.DictReader(io.StringIO(raw)):
                s=(r.get('Ticker') or '').strip().upper()
                if s:z=merged.setdefault(s,{});z.update(r);z.setdefault('_lanes',[]).append(sig)
        except:pass
        time.sleep(.5)
    return list(merged.values())
def symbol_directory():
    out=[]
    for u in ('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'):
        try:
            for r in csv.DictReader(io.StringIO(get(u,15).decode('utf-8','ignore')),delimiter='|'):
                s=(r.get('Symbol') or r.get('ACT Symbol') or '').strip().upper(); etf=(r.get('ETF') or '').strip().upper(); test=(r.get('Test Issue') or '').strip().upper()
                if s and s.isascii() and '$' not in s and '.' not in s and len(s)<=5 and etf!='Y' and test!='Y':out.append(s)
        except:pass
    return sorted(set(out))
def chart(sym):
    try:
        r=json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d&includePrePost=true&events=div%2Csplits',10))['chart']['result'][0];ts=r.get('timestamp') or [];q=r['indicators']['quote'][0]
        pts=[(t,n(c),n(v,0) or 0) for t,c,v in zip(ts,q.get('close') or [],q.get('volume') or []) if n(c) is not None]
        if len(pts)<3:return None
        m=r.get('meta') or {};return pts,m,n(m.get('chartPreviousClose') or m.get('previousClose'))
    except:return None
def pick(fr,*keys):
    for k in keys:
        if k in (fr or {}):
            v=n(fr.get(k))
            if v is not None:return v
    return None
def features(sym,fr=None,sess='regular'):
    res=chart(sym)
    if not res:return None
    pts,meta,prev=res;prices=[x[1] for x in pts];vols=[x[2] for x in pts];p=prices[-1];prev=prev or prices[0];change=(p/prev-1)*100 if prev else 0
    def ret(k):return (p/prices[-1-k]-1)*100 if len(prices)>k and prices[-1-k] else 0
    xs=prices[-15:] if len(prices)>=15 else prices;range15=(max(xs)/min(xs)-1)*100 if xs and min(xs)>0 else 99
    v5=sum(vols[-5:]);v15=sum(vols[-15:]);prior15=sum(vols[-30:-15]) if len(vols)>=30 else 0;vacc=v15/prior15 if prior15>0 else 0
    finvol=pick(fr,'Volume','Current Volume');avgvol=pick(fr,'Average Volume','Avg Volume');finr=pick(fr,'Relative Volume','Rel Volume','Rel Volume (Intraday)');dayvol=max(sum(vols),finvol or 0);volratio=dayvol/avgvol if avgvol else None;rvol=finr if finr is not None else volratio
    prox=p/max(prices) if prices else 0;compress=max(0,1-min(range15,6)/6);accel=min(max(vacc,0),5)/5;rv=min(max((rvol or 0),0),3)/3;momentum=min(max(ret(5),0),6)/6;flow=max(accel,rv)
    score=100*(.42*accel+.33*rv+.15*compress*flow+.10*momentum)
    if sess=='pre-market' and dayvol>=50000 and volratio is not None:score=max(score,min(72,100*(.55*min(volratio,.5)/.5+.20*compress+.25*momentum)))
    if change>=10:score*=.72
    if change>=20:score*=.55
    preflow=sess=='pre-market' and dayvol>=50000 and (volratio or 0)>=.06;early=change<10 and score>=34 and (vacc>=1.2 or (rvol or 0)>=1.25 or preflow) and range15<=5.5;actionable=change<15 and score>=55 and prox>=.90 and ret(5)>=-1.5;confirmed=score>=66 and ret(5)>.4 and (v5>0 or dayvol>=100000);stage='CONFIRMED' if confirmed else 'ACTIONABLE' if actionable else 'EARLY' if early else 'WATCH'
    return {'symbol':sym,'price':round(p,6),'changePct':round(change,3),'ret5mPct':round(ret(5),3),'ret15mPct':round(ret(15),3),'range15mPct':round(range15,3),'volume5m':int(v5),'volume15m':int(v15),'sessionVolume':int(dayvol),'volumeAcceleration15m':round(vacc,3),'relativeVolume':round(rvol,3) if rvol is not None else None,'volumeVsAvg':round(volratio,4) if volratio is not None else None,'nearDayHigh':round(prox,4),'score':round(score,2),'stage':stage,'quoteTimestampUTC':datetime.fromtimestamp(pts[-1][0],timezone.utc).isoformat(),'lanes':(fr or {}).get('_lanes',[])}
def main():
    t=now();et=t.astimezone(ET);sess=session(et);state=load_state();date=et.date().isoformat()
    if state.get('sessionDateET')!=date:state={'schemaVersion':10,'sessionDateET':date,'symbols':{},'events':[],'sweepCursor':0}
    frs=finviz_rows();fmap={(r.get('Ticker') or '').strip().upper():r for r in frs};hot=list(fmap);retained=[s for s,v in state['symbols'].items() if v.get('bestStage') in ('EARLY','ACTIONABLE','CONFIRMED') or v.get('maxScore',0)>=30];hot=list(dict.fromkeys(hot+retained))[:340]
    directory=symbol_directory();cursor=int(state.get('sweepCursor',0));sweep=[]
    if directory:take=700;sweep=[directory[(cursor+i)%len(directory)] for i in range(min(take,len(directory)))];state['sweepCursor']=(cursor+take)%len(directory)
    universe=list(dict.fromkeys(hot+sweep));rows=[]
    with ThreadPoolExecutor(max_workers=28) as ex:
        fut=[ex.submit(features,s,fmap.get(s),sess) for s in universe]
        for f in as_completed(fut):
            x=f.result()
            if x:rows.append(x)
    rank={'WATCH':0,'EARLY':1,'ACTIONABLE':2,'CONFIRMED':3}
    for x in rows:
        s=x['symbol'];rec=state['symbols'].setdefault(s,{'firstSeenUTC':t.isoformat(),'bestStage':'WATCH','firstChangePct':x['changePct'],'maxScore':0});old=rec.get('bestStage','WATCH');rec.update({'lastSeenUTC':t.isoformat(),'lastScore':x['score'],'lastChangePct':x['changePct'],'maxScore':max(rec.get('maxScore',0),x['score'])})
        if rank[x['stage']]>rank.get(old,0):rec['bestStage']=x['stage'];rec['stageFirstUTC']=t.isoformat();rec['stageFirstChangePct']=x['changePct'];state['events'].append({'ts':t.isoformat(),'symbol':s,'event':'STAGE_UP','from':old,'to':x['stage'],'changePct':x['changePct'],'score':x['score']})
    watch=sorted(rows,key=lambda x:x['score'],reverse=True)[:140];early=[x for x in watch if x['stage'] in ('EARLY','ACTIONABLE','CONFIRMED') and x['changePct']<10][:70];action=[x for x in watch if x['stage'] in ('ACTIONABLE','CONFIRMED')][:35];confirmed=[x for x in action if x['stage']=='CONFIRMED'][:20]
    out={'schemaVersion':10,'mode':'FORWARD_PIT_COVERAGE_FIRST','goal':{'earlyTop50RecallPct':70,'status':'TARGET_NOT_GUARANTEED'},'updatedAtUTC':t.isoformat(),'updatedAtET':et.isoformat(),'session':sess,'universeScanned':len(universe),'quotesValid':len(rows),'hotLane':len(hot),'sweepLane':len(sweep),'watch':watch,'early':early,'actionable':action,'confirmed':confirmed,'truth':{'uiPollSeconds':10,'backendCadenceSeconds':300,'backendCadence':'GitHub Actions scheduled every 5 minutes; best-effort, may be delayed','dataSource':'Yahoo 1m + Finviz Elite + Nasdaq Trader equities','note':'70% is a forward-validation target, not a claimed achieved accuracy.'}}
    OUT_PATH.write_text(json.dumps(out,separators=(',',':')));save_state(state);print(json.dumps({'session':sess,'scanned':len(universe),'valid':len(rows),'watch':len(watch),'early':len(early),'actionable':len(action),'confirmed':len(confirmed)}))
if __name__=='__main__':main()
