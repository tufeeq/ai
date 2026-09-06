#!/usr/bin/env python3
"""TAGit v3.2 causal minute-bar backfill challenger.

Research-only. Builds a recall-oriented RADAR cohort from point-in-time TAG history,
fetches one Yahoo 5m chart per unique radar ticker for Aug25-Sep4, derives only
bars timestamped <= each observation, and compares baseline vs +minute features.
Raw bars are ephemeral and never committed.
"""
import bisect, json, math, pathlib, runpy, time, urllib.parse, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor

OUT=pathlib.Path('tag/data/tagit-v32-minute-backfill.json')

def q(v,d=0.0):
    try:return float(v) if v is not None and math.isfinite(float(v)) else d
    except:return d

def rel(mfe):
    if mfe>=40:return 4
    if mfe>=20:return 3
    if mfe>=10:return 2
    if mfe>=5:return 1
    return 0

def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)

g=runpy.run_path('tagit/historical-feature-builder.py')['build']()
early=g['early']; names=g['feature_names']; ni={n:i for i,n in enumerate(names)}

# RADAR cohort: current-snapshot ranking only, no future labels in selection.
byiso=defaultdict(list)
for x in early:byiso[x['iso']].append(x)
radar=[]
for xs in byiso.values():
    for x in xs:
        f=x['features']; x['_radarScore']=.36*q(f[ni['logRvol']])+.34*q(f[ni['logVolumeVelocity']])+.12*q(f[ni['quietBase']])+.08*q(f[ni['rvolUpSteps']])+.06*q(f[ni['positiveSteps']])+.04*q(f[ni['logDollarVolume']])/20
    xs.sort(key=lambda z:z['_radarScore'],reverse=True)
    radar.extend(xs[:20])
radar_ids={(x['iso'],x['ticker']) for x in radar}; radar=[x for x in early if (x['iso'],x['ticker']) in radar_ids]
tickers=sorted(set(x['ticker'] for x in radar))

# Yahoo 5m bars, one request per ticker for the full research window.
start=int(datetime(2026,8,24,tzinfo=timezone.utc).timestamp()); end=int(datetime(2026,9,6,tzinfo=timezone.utc).timestamp())
UA={'User-Agent':'Mozilla/5.0 TAGit-personal-research/3.2'}

def fetch(ticker):
    sym=urllib.parse.quote(ticker,safe='')
    url=f'https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={start}&period2={end}&interval=5m&includePrePost=true&events=div%2Csplits'
    err=None
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers=UA)
            with urllib.request.urlopen(req,timeout=20) as r:d=json.loads(r.read().decode())
            res=((d.get('chart') or {}).get('result') or [None])[0]
            if not res:return ticker,None,'NO_RESULT'
            tss=res.get('timestamp') or []; ind=((res.get('indicators') or {}).get('quote') or [{}])[0]
            closes=ind.get('close') or []; highs=ind.get('high') or []; lows=ind.get('low') or []; vols=ind.get('volume') or []
            bars=[]
            for i,t in enumerate(tss):
                if i>=len(closes) or closes[i] is None:continue
                bars.append({'ts':float(t)*1000,'c':q(closes[i]),'h':q(highs[i],q(closes[i])) if i<len(highs) else q(closes[i]),'l':q(lows[i],q(closes[i])) if i<len(lows) else q(closes[i]),'v':q(vols[i]) if i<len(vols) else 0})
            return ticker,bars,None
        except Exception as e:
            err=type(e).__name__;time.sleep(1.2*(attempt+1))
    return ticker,None,err

bars={}; errors={}
with ThreadPoolExecutor(max_workers=4) as ex:
    futs={ex.submit(fetch,t):t for t in tickers}
    for f in as_completed(futs):
        t,b,e=f.result()
        if b:bars[t]=b
        else:errors[t]=e

# Derive causal minute features at each original observation timestamp.
def minute_features(ticker,obs_ts):
    a=bars.get(ticker)
    if not a:return None
    times=[z['ts'] for z in a];i=bisect.bisect_right(times,obs_ts)-1
    if i<0:return None
    cur=a[i]; age=(obs_ts-cur['ts'])/60000
    if age>12:return None
    # Keep only same UTC date as current bar for VWAP/HOD proxy; pre/post are retained.
    day=datetime.fromtimestamp(cur['ts']/1000,timezone.utc).date()
    daybars=[]
    j=i
    while j>=0 and datetime.fromtimestamp(a[j]['ts']/1000,timezone.utc).date()==day:
        daybars.append(a[j]);j-=1
    daybars.reverse()
    def back(minutes):
        target=cur['ts']-minutes*60000;k=bisect.bisect_right(times,target)-1
        if k<0:return None
        z=a[k]
        if cur['ts']-z['ts']>minutes*60000+12*60000:return None
        return z
    def rmin(m):
        z=back(m);return (cur['c']/z['c']-1)*100 if z and z['c'] else 0
    vols=[z['v'] for z in daybars[-4:]];prev=np.mean(vols[:-1]) if len(vols)>=2 else 0
    vacc=(vols[-1]/prev-1) if prev>0 else 0
    sumv=sum(z['v'] for z in daybars);vwap=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in daybars)/sumv if sumv>0 else cur['c']
    hod=max(z['h'] for z in daybars) if daybars else cur['h'];lod=min(z['l'] for z in daybars) if daybars else cur['l']
    recent=daybars[-3:];rng=(max(z['h'] for z in recent)/min(z['l'] for z in recent)-1)*100 if recent and min(z['l'] for z in recent)>0 else 0
    return [rmin(5),rmin(10),rmin(30),rmin(60),(cur['c']/vwap-1)*100 if vwap else 0,(cur['c']/hod-1)*100 if hod else 0,(cur['c']/lod-1)*100 if lod else 0,max(-5,min(10,vacc)),rng/10,math.log1p(max(0,cur['v']))/20,age/12]

BASE=['change','logRvol','logVolumeVelocity','shortRate','rvolDeltaPerMin','volumeVelocityAccel','m5','m10','m30','m60','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','logDollarVolume','logFloat','floatRotation','gap','sma20','perfWeek','sessionCode']
rows=[];covered=0
for x in radar:
    mf=minute_features(x['ticker'],x['ts']);covered+=int(mf is not None)
    base=[q(x['features'][ni[n]]) for n in BASE]
    rows.append({**x,'rel':rel(x['mfe60']),'base':base,'minute':mf or [0]*11,'minuteKnown':1 if mf is not None else 0})

# Models and strict time split: Aug25 train, Aug26 calibration, Sep1-4 untouched holdout.
train=[x for x in rows if x['day']=='2026-08-25'];cal=[x for x in rows if x['day']=='2026-08-26'];hold=[x for x in rows if x['day']>='2026-09-01']

def matrix(xs,mode):
    if mode=='base':return np.asarray([x['base'] for x in xs],float)
    return np.asarray([x['base']+x['minute']+[x['minuteKnown']] for x in xs],float)

def score(tr,te,mode):
    X=matrix(tr,mode);Xt=matrix(te,mode);y=np.asarray([x['rel'] for x in tr],float)
    et=ExtraTreesRegressor(n_estimators=320,max_depth=10,min_samples_leaf=7,max_features=.8,random_state=3201,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingRegressor(max_iter=180,max_leaf_nodes=15,learning_rate=.05,l2_regularization=3,min_samples_leaf=20,random_state=3202).fit(X,y)
    a=et.predict(Xt);b=hg.predict(Xt);out=[None]*len(te);bys=defaultdict(list)
    for i,x in enumerate(te):bys[x['iso']].append(i)
    for ids in bys.values():
        ra=rank01(a[ids]);rb=rank01(b[ids]);ens=.58*ra+.42*rb;dis=np.abs(ra-rb)
        order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids[loc];out[i]={**te[i],'ensemble':float(ens[loc]),'disagreement':float(dis[loc]),'rank':rr}
    return out

def stat(xs,univ):
    n=len(xs);tp=sum(x['target'] for x in xs);den=sum(x['target'] for x in univ)
    return {'count':n,'tp':tp,'precision10_60mPct':round(tp/n*100,2) if n else None,'recallObsPct':round(tp/den*100,2) if den else None,'tickerDays':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target']))}

def apply(xs,c):
    k,e,d=c;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]

def select(calp):
    allc=[]
    for k in (1,2,3,5,8,10):
        for e in (.45,.60,.75,.85,.93):
            for d in (.15,.30,.50,.80):
                s=stat(apply(calp,(k,e,d)),calp);p=s['precision10_60mPct'] or 0
                support=min(1,s['count']/15)*min(1,s['tp']/3);util=p*support+s['tp']*2+s['recallObsPct']*.3
                allc.append(((k,e,d),s,util))
    return max(allc,key=lambda z:z[2])

results=[]
for mode in ('base','base+minute'):
    calp=score(train,cal,mode);holdp=score(train+cal,hold,mode);cfg,cals,_=select(calp);hs=stat(apply(holdp,cfg),holdp)
    fixed={str(k):stat([x for x in holdp if x['rank']<=k],holdp) for k in (1,3,5,10,20)}
    results.append({'mode':mode,'featureCount':len(matrix(train,mode)[0]) if train else 0,'selectedConfig':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2]},'calibration':cals,'holdout':hs,'holdoutTopK':fixed})

report={'schemaVersion':1,'method':'TAGIT_V32_YAHOO_5M_CAUSAL_BACKFILL_CHALLENGER','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
        'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','cohort':{'radarObservations':len(radar),'uniqueRadarTickers':len(tickers),'yahooTickersSucceeded':len(bars),'yahooTickersFailed':len(errors),'minuteFeatureCoveragePct':round(covered/max(1,len(rows))*100,2)},
        'split':{'trainAug25':len(train),'calibrationAug26':len(cal),'holdoutSep1to4':len(hold),'trainPositives':sum(x['target'] for x in train),'calibrationPositives':sum(x['target'] for x in cal),'holdoutPositives':sum(x['target'] for x in hold)},
        'antiLeakage':['RADAR cohort selected from current point-in-time features only','minute bars at or before observation only','future MFE labels never enter features','thresholds selected on Aug26 only','Sep1-4 untouched holdout'],'results':results,
        'failedTickerSample':dict(list(errors.items())[:30])}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
