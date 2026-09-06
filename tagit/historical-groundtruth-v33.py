#!/usr/bin/env python3
"""TAGit v3.3: causal 5m feature backfill + independent 60m ground truth.

Research-only. The candidate universe is selected from point-in-time TAG features.
Yahoo 5m bars at/before each observation are features; bars after the frozen
observation are used ONLY to create evaluation labels (MFE/MAE). Thresholds are
selected on Aug-26; Sep-1..4 remains untouched holdout.
"""
import bisect, json, math, pathlib, runpy, time, urllib.parse, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor

OUT=pathlib.Path('tag/data/tagit-v33-groundtruth.json')

def q(v,d=0.0):
    try:return float(v) if v is not None and math.isfinite(float(v)) else d
    except:return d

def relevance(mfe):
    if mfe>=40:return 4
    if mfe>=20:return 3
    if mfe>=10:return 2
    if mfe>=5:return 1
    return 0

def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)

# Point-in-time base history.
g=runpy.run_path('tagit/historical-feature-builder.py')['build']()
early=g['early']; names=g['feature_names']; ni={n:i for i,n in enumerate(names)}

# Broad recall lane: Top-50 per snapshot, selected BEFORE any Yahoo future data.
byiso=defaultdict(list)
for x in early:byiso[x['iso']].append(x)
cohort=[]
for xs in byiso.values():
    for x in xs:
        f=x['features']
        x['_radarScore']=.34*q(f[ni['logRvol']])+.32*q(f[ni['logVolumeVelocity']])+.11*q(f[ni['quietBase']])+.08*q(f[ni['rvolUpSteps']])+.06*q(f[ni['positiveSteps']])+.05*q(f[ni['logDollarVolume']])/20+.04*(1-min(1,abs(q(x['change']))/20))
    xs.sort(key=lambda z:z['_radarScore'],reverse=True)
    cohort.extend(xs[:50])
ids={(x['iso'],x['ticker']) for x in cohort};cohort=[x for x in early if (x['iso'],x['ticker']) in ids]
tickers=sorted(set(x['ticker'] for x in cohort))

# One 5m request per unique ticker for entire research window; raw bars remain ephemeral.
start=int(datetime(2026,8,24,tzinfo=timezone.utc).timestamp());end=int(datetime(2026,9,6,tzinfo=timezone.utc).timestamp())
UA={'User-Agent':'Mozilla/5.0 TAGit-personal-research/3.3'}
def fetch(ticker):
    sym=urllib.parse.quote(ticker,safe='')
    url=f'https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={start}&period2={end}&interval=5m&includePrePost=true&events=div%2Csplits'
    err=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers=UA)
            with urllib.request.urlopen(req,timeout=20) as r:d=json.loads(r.read().decode())
            res=((d.get('chart') or {}).get('result') or [None])[0]
            if not res:return ticker,None,'NO_RESULT'
            tss=res.get('timestamp') or []; qq=((res.get('indicators') or {}).get('quote') or [{}])[0]
            cs=qq.get('close') or [];hs=qq.get('high') or [];ls=qq.get('low') or [];vs=qq.get('volume') or []
            arr=[]
            for i,t in enumerate(tss):
                if i>=len(cs) or cs[i] is None:continue
                c=q(cs[i]);arr.append({'ts':float(t)*1000,'c':c,'h':q(hs[i],c) if i<len(hs) else c,'l':q(ls[i],c) if i<len(ls) else c,'v':q(vs[i]) if i<len(vs) else 0})
            return ticker,arr,None
        except Exception as e:
            err=type(e).__name__;time.sleep(1.0*(attempt+1))
    return ticker,None,err
bars={};errors={}
with ThreadPoolExecutor(max_workers=6) as ex:
    futs={ex.submit(fetch,t):t for t in tickers}
    for f in as_completed(futs):
        t,b,e=f.result()
        if b:bars[t]=b
        else:errors[t]=e

# Causal features + future-only independent ground truth.
def align(ticker,obs_ts,obs_price):
    a=bars.get(ticker)
    if not a:return None
    times=[z['ts'] for z in a];i=bisect.bisect_right(times,obs_ts)-1
    if i<0:return None
    cur=a[i];age=(obs_ts-cur['ts'])/60000
    if age>12 or cur['c']<=0:return None
    parity=abs(cur['c']/obs_price-1)*100 if obs_price else 999
    if parity>7.5:return {'quality':False,'age':age,'parity':parity}
    def prior(minutes):
        target=cur['ts']-minutes*60000;k=bisect.bisect_right(times,target)-1
        if k<0:return None
        z=a[k]
        return z if 0<=cur['ts']-z['ts']<=minutes*60000+12*60000 else None
    def rmin(m):
        z=prior(m);return (cur['c']/z['c']-1)*100 if z and z['c'] else 0
    # Today's bars visible at decision time only.
    day=datetime.fromtimestamp(cur['ts']/1000,timezone.utc).date();db=[];j=i
    while j>=0 and datetime.fromtimestamp(a[j]['ts']/1000,timezone.utc).date()==day:
        db.append(a[j]);j-=1
    db.reverse();sumv=sum(z['v'] for z in db);vwap=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in db)/sumv if sumv else cur['c'];hod=max(z['h'] for z in db);lod=min(z['l'] for z in db)
    last4=db[-4:];prevv=np.mean([z['v'] for z in last4[:-1]]) if len(last4)>=2 else 0;vacc=(last4[-1]['v']/prevv-1) if prevv>0 else 0
    last3=db[-3:];rng=(max(z['h'] for z in last3)/min(z['l'] for z in last3)-1)*100 if last3 and min(z['l'] for z in last3)>0 else 0
    feats=[rmin(5),rmin(10),rmin(30),rmin(60),(cur['c']/vwap-1)*100 if vwap else 0,(cur['c']/hod-1)*100 if hod else 0,(cur['c']/lod-1)*100 if lod else 0,max(-5,min(10,vacc)),rng/10,math.log1p(max(0,cur['v']))/20,age/12,parity/7.5]
    # Future bars are label-only. First future timestamp strictly > observation.
    future=[];k=bisect.bisect_right(times,obs_ts)
    while k<len(a) and a[k]['ts']<=obs_ts+60*60000:
        if a[k]['ts']>obs_ts:future.append(a[k])
        k+=1
    if not future:return {'quality':False,'age':age,'parity':parity}
    anchor=cur['c'];mfe=(max(z['h'] for z in future)/anchor-1)*100;mae=(min(z['l'] for z in future)/anchor-1)*100
    return {'quality':True,'features':feats,'mfe':mfe,'mae':mae,'anchor':anchor,'age':age,'parity':parity,'futureBars':len(future)}

BASE=['change','logRvol','logVolumeVelocity','shortRate','rvolDeltaPerMin','volumeVelocityAccel','m5','m10','m30','m60','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','logDollarVolume','logFloat','floatRotation','gap','sma20','perfWeek','sessionCode']
rows=[];aligned=0;labelled=0;parity_reject=0
for x in cohort:
    a=align(x['ticker'],x['ts'],x['price'])
    if a:aligned+=1
    if not a or not a.get('quality'):
        if a and a.get('parity',0)>7.5:parity_reject+=1
        continue
    labelled+=1;base=[q(x['features'][ni[n]]) for n in BASE]
    rows.append({**x,'base':base,'minute':a['features'],'mfeGT':a['mfe'],'maeGT':a['mae'],'targetGT':a['mfe']>=10,'relGT':relevance(a['mfe']),'barAge':a['age'],'parity':a['parity'],'futureBars':a['futureBars']})

train=[x for x in rows if x['day']=='2026-08-25'];cal=[x for x in rows if x['day']=='2026-08-26'];hold=[x for x in rows if x['day']>='2026-09-01']

def matrix(xs,mode):return np.asarray([x['base'] if mode=='base' else x['base']+x['minute'] for x in xs],float)
def score(tr,te,mode):
    X=matrix(tr,mode);Xt=matrix(te,mode);y=np.asarray([x['relGT'] for x in tr],float)
    et=ExtraTreesRegressor(n_estimators=360,max_depth=11,min_samples_leaf=6,max_features=.8,random_state=3301,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingRegressor(max_iter=200,max_leaf_nodes=15,learning_rate=.045,l2_regularization=3,min_samples_leaf=18,random_state=3302).fit(X,y)
    a=et.predict(Xt);b=hg.predict(Xt);out=[None]*len(te);bys=defaultdict(list)
    for i,x in enumerate(te):bys[x['iso']].append(i)
    for ids2 in bys.values():
        ra=rank01(a[ids2]);rb=rank01(b[ids2]);ens=.58*ra+.42*rb;dis=np.abs(ra-rb);order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids2[loc];out[i]={**te[i],'ensemble':float(ens[loc]),'disagreement':float(dis[loc]),'rank':rr}
    return out

def stat(xs,univ):
    n=len(xs);tp=sum(x['targetGT'] for x in xs);den=sum(x['targetGT'] for x in univ)
    return {'count':n,'tp':tp,'precision10_60mPct':round(tp/n*100,2) if n else None,'recallObsPct':round(tp/den*100,2) if den else None,'tickerDays':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['targetGT'])),'meanMFE':round(float(np.mean([x['mfeGT'] for x in xs])),2) if n else None,'meanMAE':round(float(np.mean([x['maeGT'] for x in xs])),2) if n else None}
def apply(xs,c):
    k,e,d=c;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]
def select(calp):
    z=[]
    for k in (1,2,3,5,8,10,15,20):
        for e in (.35,.50,.65,.75,.85,.93):
            for d in (.12,.25,.40,.65,1.0):
                s=stat(apply(calp,(k,e,d)),calp);p=s['precision10_60mPct'] or 0;support=min(1,s['count']/20)*min(1,s['tp']/5);utility=p*support+s['tp']*1.7+s['recallObsPct']*.22
                z.append(((k,e,d),s,utility))
    return max(z,key=lambda x:x[2])

results=[]
for mode in ('base','base+minute'):
    cp=score(train,cal,mode);hp=score(train+cal,hold,mode);cfg,cs,_=select(cp);hs=stat(apply(hp,cfg),hp)
    topk={str(k):stat([x for x in hp if x['rank']<=k],hp) for k in (1,3,5,10,20,50)}
    results.append({'mode':mode,'featureCount':matrix(train,mode).shape[1] if train else 0,'selectedConfig':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2]},'calibration':cs,'holdout':hs,'holdoutTopK':topk})

# Ground-truth density and how much of original sparse labels were missed.
orig_pos=sum(x.get('target',False) for x in rows);gt_pos=sum(x['targetGT'] for x in rows)
report={'schemaVersion':1,'method':'TAGIT_V33_YAHOO_5M_INDEPENDENT_GROUND_TRUTH','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
'cohort':{'radarTopK':50,'pointInTimeObservations':len(cohort),'uniqueTickers':len(tickers),'yahooSucceeded':len(bars),'yahooFailed':len(errors),'alignedObservations':aligned,'qualityLabelledObservations':labelled,'qualityCoveragePct':round(labelled/max(1,len(cohort))*100,2),'parityRejected':parity_reject},
'groundTruth':{'yahoo5mPositiveObservations':gt_pos,'oldSparsePositiveObservationsSameRows':orig_pos,'positiveLiftVsSparse':round(gt_pos/max(1,orig_pos),2)},
'split':{'train':{'rows':len(train),'positives':sum(x['targetGT'] for x in train)},'calibration':{'rows':len(cal),'positives':sum(x['targetGT'] for x in cal)},'holdout':{'rows':len(hold),'positives':sum(x['targetGT'] for x in hold)}},
'antiLeakage':['cohort selection uses only point-in-time TAG features','Yahoo bars <= observation are features only','Yahoo bars > observation and <=60m are labels only','Finviz/Yahoo current-price parity <=7.5% required','Aug26 selects thresholds; Sep1-4 untouched'],'results':results,'failedTickerSample':dict(list(errors.items())[:30])}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
