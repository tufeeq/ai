#!/usr/bin/env python3
"""TAGit v5.8 Multi-Session Continuation Learner.

Goal
- Detect starter sessions that may continue/explode in the next 1-2 sessions.
- Learn recurring patterns such as +10-25% starter day -> next-session expansion.
- Keep carryover candidates alive across the close instead of resetting discovery.

All features use the current/prior completed sessions only. Future sessions are labels only.
Research-only; no champion override.
"""
import json, math, pathlib, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor, HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT=pathlib.Path('tag/data')
FROZEN=ROOT/'tagit-v39-frozen-groundtruth.json'
DISCOVERY=ROOT/'discovery.json'
BASE57=ROOT/'tagit-v57-cumulative-opportunities.json'
OUT=ROOT/'tagit-v58-multisession-continuation.json'
LIB=ROOT/'tagit-v58-multisession-case-library.json'
WATCH=ROOT/'tagit-v58-carryover-watch.json'
NY=ZoneInfo('America/New_York')
UA={'User-Agent':'Mozilla/5.0 TAGit-v5.8-multisession-research'}
MAX_SYMBOLS=420

FEATURES=[
 'dayHighGain','closeGain','gap','rangePct','closePosition','closeFromHigh',
 'firstHourReturn','lastHourReturn','dayTrend','logVolume','volumeVs20d',
 'prevDayHighGain','prevCloseGain','prevRange','prevVolumeVs20d','twoDayCloseGain',
 'threeDayCloseGain','upStreak','rangeCompression3d','volumeAcceleration3d',
 'starter10to25','starter10to40'
]

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def ret(a,b):return (a/b-1)*100 if a and b else 0.0

def safe_med(v,default=1.0):
    if not v:return max(default,1e-9)
    x=float(np.median(v)); return x if x>1e-9 else max(default,1e-9)

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def fetch(sym,retries=4):
    q=urllib.parse.quote(sym,safe='')
    u=f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range=730d&interval=60m&includePrePost=false&events=div%2Csplits'
    err=None
    for k in range(retries):
        try:
            req=urllib.request.Request(u,headers=UA)
            with urllib.request.urlopen(req,timeout=25) as r:d=json.loads(r.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return sym,[],'NO_RESULT'
            ts=z.get('timestamp') or []; q0=((z.get('indicators') or {}).get('quote') or [{}])[0]
            O=q0.get('open') or [];H=q0.get('high') or [];L=q0.get('low') or [];C=q0.get('close') or [];V=q0.get('volume') or []
            out=[]
            for i,t in enumerate(ts):
                if i>=len(C) or C[i] is None:continue
                c=float(C[i]);o=float(O[i] if i<len(O) and O[i] is not None else c);h=float(H[i] if i<len(H) and H[i] is not None else c);l=float(L[i] if i<len(L) and L[i] is not None else c);v=float(V[i] if i<len(V) and V[i] is not None else 0)
                if c<=0:continue
                dt=datetime.fromtimestamp(int(t),timezone.utc).astimezone(NY)
                m=dt.hour*60+dt.minute
                if 570<=m<960:out.append({'t':int(t),'dt':dt,'o':o,'h':h,'l':l,'c':c,'v':max(0.0,v)})
            return sym,out,None
        except Exception as e:
            err=f'{type(e).__name__}:{e}';time.sleep(.5*(k+1))
    return sym,[],err

frozen=readj(FROZEN,{'data':[]})
freq=Counter(str(x.get('ticker') or '').upper() for x in frozen.get('data',[]) if x.get('ticker'))
hist=[s for s,_ in freq.most_common(330)]
disc=readj(DISCOVERY,{'rows':[]});fresh=[]
for r in disc.get('rows') or []:
    s=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
    if s and s not in fresh:fresh.append(s)
symbols=[]
for s in hist+fresh:
    if s and s not in symbols:symbols.append(s)
    if len(symbols)>=MAX_SYMBOLS:break

raw={};errors={}
with ThreadPoolExecutor(max_workers=12) as ex:
    fs=[ex.submit(fetch,s) for s in symbols]
    for f in as_completed(fs):
        s,b,e=f.result();raw[s]=b
        if e or not b:errors[s]=e or 'EMPTY'

rows=[];latest=[]
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:by[z['dt'].date().isoformat()].append(z)
    days=[]
    for d in sorted(by):
        a=sorted(by[d],key=lambda x:x['t'])
        if len(a)<4:continue
        o=a[0]['o'];c=a[-1]['c'];h=max(x['h'] for x in a);l=min(x['l'] for x in a);v=sum(x['v'] for x in a)
        days.append({'day':d,'bars':a,'o':o,'c':c,'h':h,'l':l,'v':v})
    for i in range(3,len(days)):
        cur=days[i];p1=days[i-1];p2=days[i-2];p3=days[i-3]
        prev_close=p1['c']; vols=[x['v'] for x in days[max(0,i-20):i]]; medv=safe_med(vols,cur['v'] or 1)
        prev_med=safe_med([x['v'] for x in days[max(0,i-21):i-1]],p1['v'] or 1)
        dh=ret(cur['h'],prev_close);cg=ret(cur['c'],prev_close);gap=ret(cur['o'],prev_close);rng=ret(cur['h'],cur['l'])
        cp=(cur['c']-cur['l'])/(cur['h']-cur['l']) if cur['h']>cur['l'] else .5
        cfh=ret(cur['c'],cur['h']);bars0=cur['bars'];first=ret(bars0[0]['c'],cur['o']);last=ret(bars0[-1]['c'],bars0[-2]['c']) if len(bars0)>=2 else 0;trend=ret(cur['c'],bars0[0]['c'])
        vr=cur['v']/medv; pvr=p1['v']/prev_med
        p1dh=ret(p1['h'],p2['c']);p1cg=ret(p1['c'],p2['c']);p1rng=ret(p1['h'],p1['l'])
        two=ret(cur['c'],p2['c']);three=ret(cur['c'],p3['c'])
        streak=int(cg>0)+int(p1cg>0)+int(ret(p2['c'],p3['c'])>0)
        ranges=[ret(x['h'],x['l']) for x in (p2,p1,cur)]; comp3=(ranges[-1]-np.mean(ranges[:-1])) if len(ranges)>1 else 0
        vols3=[p2['v'],p1['v'],cur['v']]; vacc=(vols3[-1]/safe_med(vols3[:-1],vols3[-1]))
        feat=[dh/50,cg/40,gap/30,rng/40,cp,cfh/20,first/20,last/20,trend/30,math.log1p(cur['v'])/20,math.log1p(max(vr,0))/3,p1dh/50,p1cg/40,p1rng/40,math.log1p(max(pvr,0))/3,two/60,three/80,streak/3,comp3/30,math.log1p(max(vacc,0))/3,float(10<=dh<25),float(10<=dh<40)]
        # Future labels are based only on following sessions.
        n1=days[i+1] if i+1<len(days) else None;n2=days[i+2] if i+2<len(days) else None
        if n1 is None:
            latest.append({'symbol':sym,'day':cur['day'],'feat':feat,'starterDayHighPct':dh,'starterClosePct':cg,'close':cur['c'],'volumeVs20d':vr})
            continue
        n1gain=ret(n1['h'],cur['c']);n1close=ret(n1['c'],cur['c'])
        max2=n1['h'];
        if n2 is not None:max2=max(max2,n2['h'])
        n2gain=ret(max2,cur['c'])
        row={'symbol':sym,'day':cur['day'],'key':sym+'|'+cur['day'],'feat':feat,'starterDayHighPct':dh,'starterClosePct':cg,'volumeVs20d':vr,
             'next1Explode20':bool(n1gain>=20),'next1Explode30':bool(n1gain>=30),'next2Explode20':bool(n2gain>=20),'next2Explode40':bool(n2gain>=40),
             'next1HighGainPct':n1gain,'next1CloseGainPct':n1close,'next2MaxGainPct':n2gain,'nextDay':n1['day'],'secondDay':n2['day'] if n2 else None}
        rows.append(row)

# Focus training universe on plausible carryover states while keeping hard negatives.
def eligible(x):
    return (x['starterDayHighPct']>=7 or x['starterClosePct']>=5 or x['volumeVs20d']>=1.8) and x['starterDayHighPct']<70
rows=[x for x in rows if eligible(x)]
dates=sorted({x['day'] for x in rows});ia=max(1,int(.70*len(dates)));ib=max(ia+1,int(.85*len(dates)))
td=set(dates[:ia]);cd=set(dates[ia:ib]);hd=set(dates[ib:])
train=[x for x in rows if x['day'] in td];cal=[x for x in rows if x['day'] in cd];hold=[x for x in rows if x['day'] in hd]

def fit_cls(rr,target,seed):
    X=np.asarray([x['feat'] for x in rr],float);y=np.asarray([int(x[target]) for x in rr],int)
    if len(y)==0 or len(np.unique(y))<2:return {'constant':float(y[0]) if len(y) else 0.0,'n':len(y),'p':int(y.sum()) if len(y) else 0}
    pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);w=np.where(y==1,min(60,neg/pos),1.0)
    sc=StandardScaler().fit(X);Xs=sc.transform(X)
    et=ExtraTreesClassifier(n_estimators=420,max_depth=13,min_samples_leaf=8,max_features=.78,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=240,max_leaf_nodes=19,learning_rate=.035,l2_regularization=14,min_samples_leaf=25,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.07,class_weight='balanced',random_state=seed+2).fit(Xs,y)
    return {'sc':sc,'et':et,'hg':hg,'lr':lr,'n':len(y),'p':int(y.sum())}

def prob(m,rr):
    if 'constant' in m:return np.full(len(rr),m['constant']),np.zeros(len(rr))
    X=np.asarray([x['feat'] for x in rr],float);Xs=m['sc'].transform(X)
    ps=np.vstack([m['et'].predict_proba(X)[:,1],m['hg'].predict_proba(X)[:,1],m['lr'].predict_proba(Xs)[:,1]])
    return .45*ps[0]+.40*ps[1]+.15*ps[2],np.std(ps,axis=0)

def fit_reg(rr,target,seed):
    X=np.asarray([x['feat'] for x in rr],float);y=np.asarray([max(-20,min(150,float(x[target]))) for x in rr],float)
    et=ExtraTreesRegressor(n_estimators=320,max_depth=13,min_samples_leaf=9,max_features=.78,n_jobs=-1,random_state=seed).fit(X,y)
    hg=HistGradientBoostingRegressor(max_iter=210,max_leaf_nodes=17,learning_rate=.04,l2_regularization=14,min_samples_leaf=28,random_state=seed+1).fit(X,y)
    return {'et':et,'hg':hg}

def rpred(m,rr):
    X=np.asarray([x['feat'] for x in rr],float);return .55*m['et'].predict(X)+.45*m['hg'].predict(X)

m1=fit_cls(train,'next1Explode20',5810);m2=fit_cls(train,'next2Explode20',5830);m40=fit_cls(train,'next2Explode40',5850);mr=fit_reg(train,'next2MaxGainPct',5870)

# Positive archetypes: starter sessions that lead to next-1/2-session explosion.
pos=[x for x in train if x['next1Explode20'] or x['next2Explode40']]
arch=None
if len(pos)>=40:
    X=np.asarray([x['feat'] for x in pos],float);sc=StandardScaler().fit(X);k=min(10,max(3,len(pos)//120));km=MiniBatchKMeans(n_clusters=k,random_state=5880,batch_size=512,n_init=10,max_iter=300).fit(sc.transform(X));arch={'sc':sc,'km':km}

def sim(rr):
    if not rr or arch is None:return np.zeros(len(rr))
    X=arch['sc'].transform(np.asarray([x['feat'] for x in rr],float));d=np.min(arch['km'].transform(X),axis=1);scale=max(float(np.median(d)),1e-6);return np.exp(-d/scale)

def enrich(rr):
    p1,d1=prob(m1,rr);p2,d2=prob(m2,rr);p40,_=prob(m40,rr);rg=rpred(mr,rr);s=sim(rr);out=[]
    for x,a,b,c,d,e,f in zip(rr,p1,p2,p40,rg,d1,s):
        score=float(.38*a+.25*b+.12*c+.15*np.clip(d,0,60)/60+.07*f+.03*(1-min(1,e/.35)))
        out.append({**x,'pNext1Explode20':float(a),'pNext2Explode20':float(b),'pNext2Explode40':float(c),'predNext2MaxGainPct':float(d),'disagreement':float(e),'archetypeSimilarity':float(f),'carryScore':score})
    return out

def select(rr,cfg):
    sc,p1,p2,rg,di=cfg
    return [x for x in rr if x['carryScore']>=sc and x['pNext1Explode20']>=p1 and x['pNext2Explode20']>=p2 and x['predNext2MaxGainPct']>=rg and x['disagreement']<=di]

def stat(sel):
    n=len(sel);tp1=sum(x['next1Explode20'] for x in sel);tp2=sum(x['next2Explode20'] for x in sel);t40=sum(x['next2Explode40'] for x in sel);g=[x['next2MaxGainPct'] for x in sel]
    return {'count':n,'next1Precision20Pct':round(100*tp1/n,2) if n else None,'next2Precision20Pct':round(100*tp2/n,2) if n else None,'next2Precision40Pct':round(100*t40/n,2) if n else None,'wilsonLower90Next1Pct':round(wilson(tp1,n),2) if n else None,'medianNext2MaxGainPct':round(float(np.median(g)),2) if g else None,'p75Next2MaxGainPct':round(float(np.quantile(g,.75)),2) if g else None,'activeDays':len({x['day'] for x in sel})}

cp=enrich(cal);scores=np.asarray([x['carryScore'] for x in cp]);p1s=np.asarray([x['pNext1Explode20'] for x in cp]);p2s=np.asarray([x['pNext2Explode20'] for x in cp]);rgs=np.asarray([x['predNext2MaxGainPct'] for x in cp])
sg=sorted(set([.45,.55,.65,.75,.82]+[round(float(np.quantile(scores,q)),4) for q in (.80,.88,.92,.95)]))
p1g=sorted(set([.25,.4,.55,.7]+[round(float(np.quantile(p1s,q)),4) for q in (.75,.85,.92)]))
p2g=sorted(set([.30,.45,.60,.75]+[round(float(np.quantile(p2s,q)),4) for q in (.75,.85,.92)]))
rggrid=sorted(set([10,15,20,25]+[round(float(np.quantile(rgs,q)),2) for q in (.60,.75,.85)]))
configs=[]
for sc in sg:
  for p1 in p1g:
    for p2 in p2g:
      for rg in rggrid:
        for di in (.12,.20,.30):
          cfg=(sc,p1,p2,rg,di);z=stat(select(cp,cfg));n=z['count'];p=z['next1Precision20Pct'] or 0;lo=z['wilsonLower90Next1Pct'] or 0;p2v=z['next2Precision20Pct'] or 0;med=z['medianNext2MaxGainPct'] or 0
          u=lo*150+p*35+p2v*20+min(med,50)*18+min(n,200)
          if n<50:u-=5000
          configs.append((u,cfg,z))
configs.sort(key=lambda x:x[0],reverse=True);_,cfg,cm=configs[0]
hp=enrich(hold);hs=stat(select(hp,cfg))

# Case library from train positives.
clusters=[]
if arch is not None:
    X=np.asarray([x['feat'] for x in pos],float);labels=arch['km'].predict(arch['sc'].transform(X))
    for k in range(arch['km'].n_clusters):
        g=[x for x,l in zip(pos,labels) if int(l)==k]
        if not g:continue
        F=np.asarray([x['feat'] for x in g],float)
        clusters.append({'cluster':k,'count':len(g),'next1Explode20RatePct':round(100*sum(x['next1Explode20'] for x in g)/len(g),2),'next2Explode40RatePct':round(100*sum(x['next2Explode40'] for x in g)/len(g),2),'medianStarterHighPct':round(float(np.median([x['starterDayHighPct'] for x in g])),2),'medianStarterClosePct':round(float(np.median([x['starterClosePct'] for x in g])),2),'medianNext2MaxGainPct':round(float(np.median([x['next2MaxGainPct'] for x in g])),2),'medianFeatures':{n:round(float(np.median(F[:,i])),4) for i,n in enumerate(FEATURES)},'exemplars':[{'symbol':x['symbol'],'day':x['day'],'starterHighPct':round(x['starterDayHighPct'],2),'next2MaxGainPct':round(x['next2MaxGainPct'],2)} for x in sorted(g,key=lambda q:q['next2MaxGainPct'],reverse=True)[:6]]})
    clusters.sort(key=lambda z:(z['next1Explode20RatePct'],z['medianNext2MaxGainPct']),reverse=True)

# Score latest completed session for a live carryover watch. No global timestamp cap.
latest_enriched=[]
if latest:
    # keep plausible starter/carry states only
    lc=[x for x in latest if (x['starterDayHighPct']>=7 or x['starterClosePct']>=5 or x['volumeVs20d']>=1.8) and x['starterDayHighPct']<70]
    # adapt keys expected by enrich
    latest_enriched=enrich(lc) if lc else []
    latest_enriched=sorted(latest_enriched,key=lambda x:x['carryScore'],reverse=True)

base57=readj(BASE57,{})
report={'schemaVersion':'5.8-multisession-continuation','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'COMPLETE' if train and cal and hold else 'INSUFFICIENT','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','objective':{'primary':'detect starter session that explodes >=20% in next session','secondary':'detect continuation/explosion over next two sessions and estimate remaining upside','carryover':'do not reset valid opportunities at session close'},'data':{'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'eligibleSessionRows':len(rows),'days':len(dates),'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainPositiveNext1':sum(x['next1Explode20'] for x in train),'trainPositiveNext2':sum(x['next2Explode20'] for x in train),'positiveArchetypeCases':len(pos),'archetypes':len(clusters)},'selectedConfig':{'minCarryScore':cfg[0],'minPNext1Explode20':cfg[1],'minPNext2Explode20':cfg[2],'minPredNext2MaxGainPct':cfg[3],'maxDisagreement':cfg[4]},'calibration':cm,'holdout':hs,'baselineV57HoldoutPrecisionPct':(base57.get('holdout') or {}).get('precisionActionablePct'),'antiLeakage':['features use current/prior completed sessions only','future sessions are labels only','chronological 70/15/15 split','thresholds selected on calibration only','untouched chronological holdout evaluated after freeze','latest carryover watch is scored without using future outcomes'],'verdict':'V58_RESEARCH_COMPLETE','errorsSample':dict(list(errors.items())[:20])}
lib={'schemaVersion':'5.8-multisession-case-library','generatedAtUTC':report['generatedAtUTC'],'definition':'starter/carry session -> next 1-2 session continuation','featureNames':FEATURES,'clusters':clusters,'policy':'TRAIN_ONLY_ARCHETYPES'}
watch={'schemaVersion':'5.8-carryover-watch','generatedAtUTC':report['generatedAtUTC'],'policy':'RESEARCH_ONLY_NO_BUY_RECOMMENDATION','noGlobalTimestampCap':True,'candidates':[{'symbol':x['symbol'],'day':x['day'],'starterDayHighPct':round(x['starterDayHighPct'],2),'starterClosePct':round(x['starterClosePct'],2),'volumeVs20d':round(x['volumeVs20d'],2),'carryScore':round(x['carryScore'],4),'pNext1Explode20':round(x['pNext1Explode20'],4),'pNext2Explode20':round(x['pNext2Explode20'],4),'predNext2MaxGainPct':round(x['predNext2MaxGainPct'],2)} for x in latest_enriched]}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');LIB.write_text(json.dumps(lib,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');WATCH.write_text(json.dumps(watch,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
