#!/usr/bin/env python3
"""TAGit v3.10 frozen live-compatible benchmark.

Uses ONLY features reproducible from the live Finviz Elite feed + causal state cache:
  base[0:11]      = price/change/volume/cross-sectional ranks/screener flags/session
  sequence[0:6]   = price/change/volume velocity, velocity acceleration, age, change since first
  micro[0:4]      = 5m/10m/30m/60m momentum transforms
The full 34-feature historical set is evaluated only as an upper-bound comparator.
No Yahoo-only VWAP/HOD/LOD/bar-range features enter the live-compatible candidate.
"""
import hashlib,json,pathlib
from collections import defaultdict
from datetime import datetime,timezone
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier,HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json'); OUT=pathlib.Path('tag/data/tagit-v310-live-compatible.json')
r=json.loads(SRC.read_text()); data=r['data']; expected=r['datasetSha256']
canon=json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False)
assert hashlib.sha256(canon.encode()).hexdigest()==expected

def scode(s):
    s=str(s or '').lower(); return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)

def vec(x,mode):
    base=list(x['base'])
    if mode=='base': return base
    live=base+list(x['sequence'][:6])
    if mode=='live21': return live+list(x['micro'][:4])
    if mode=='live17': return live
    if mode=='full34': return base+list(x['sequence'])+list(x['micro'])
    raise ValueError(mode)

def fit_score(tr,te,mode):
    X=np.asarray([vec(x,mode) for x in tr],float); Xt=np.asarray([vec(x,mode) for x in te],float)
    y=np.asarray([int(x['target']) for x in tr]); sc=StandardScaler().fit(X); Xs=sc.transform(X); Xts=sc.transform(Xt)
    pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); w=np.where(y==1,min(80,neg/pos),1.0)
    hard=np.asarray([1.8 if (not x['target'] and (x['changeRank']>.7 or x['volumeRank']>.8)) else 1.0 for x in tr]); w*=hard
    et=ExtraTreesClassifier(n_estimators=420,max_depth=11,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=3101,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=15,learning_rate=.045,l2_regularization=4,min_samples_leaf=22,random_state=3102).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.25,random_state=3103).fit(Xs,y)
    a=et.predict_proba(Xt)[:,1]; b=hg.predict_proba(Xt)[:,1]; c=lr.predict_proba(Xts)[:,1]
    out=[None]*len(te); by=defaultdict(list)
    for i,x in enumerate(te):by[x['si']].append(i)
    for ids in by.values():
        ra,rb,rc=rank01(a[ids]),rank01(b[ids]),rank01(c[ids]); ens=.42*ra+.38*rb+.20*rc; dis=np.std(np.vstack([ra,rb,rc]),axis=0); order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids[loc]; out[i]={**te[i],'ensemble':float(ens[loc]),'disagreement':float(dis[loc]),'rank':rr}
    return out

def stat(xs,u):
    n=len(xs);tp=sum(bool(x['target']) for x in xs);den=sum(bool(x['target']) for x in u)
    return {'count':n,'tp':tp,'precisionPct':round(tp/n*100,2) if n else None,'recallPct':round(tp/den*100,2) if den else None,'tickerDays':len(set(x['key'] for x in xs)),'winnerTickerDays':len(set(x['key'] for x in xs if x['target'])),'meanMFE':round(float(np.mean([x['mfeGT'] for x in xs])),2) if n else None,'meanMAE':round(float(np.mean([x['maeGT'] for x in xs])),2) if n else None}
def apply(xs,cfg):
    k,e,d=cfg;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]
def choose(cp):
    best=None
    for k in (3,5,8,10,15,20):
      for e in (.35,.50,.65,.75,.85,.93):
       for d in (.10,.18,.28,.40,.60):
        s=stat(apply(cp,(k,e,d)),cp); p=s['precisionPct'] or 0; rec=s['recallPct'] or 0
        support=min(1,s['count']/25)*min(1,s['tp']/6); util=p*support+s['tp']*1.7+rec*.20
        cand=(util,(k,e,d),s)
        if best is None or cand[0]>best[0]:best=cand
    return best

train=[x for x in data if x['day']<='2026-08-24']; cal=[x for x in data if '2026-08-25'<=x['day']<='2026-08-26']; hold=[x for x in data if x['day']>='2026-08-27']
results=[]
for mode in ('base','live17','live21','full34'):
    cp=fit_score(train,cal,mode); hp=fit_score(train+cal,hold,mode); _,cfg,cs=choose(cp); hs=stat(apply(hp,cfg),hp)
    top={str(k):stat([x for x in hp if x['rank']<=k],hp) for k in (1,3,5,10,20)}
    sess={}
    for code,name in ((0,'pre'),(1,'regular'),(2,'after')):
        u=[x for x in hp if scode(x['session'])==code]; sess[name]={'selected':stat(apply(u,cfg),u),'top10':stat([x for x in u if x['rank']<=10],u),'top20':stat([x for x in u if x['rank']<=20],u)}
    results.append({'mode':mode,'featureCount':len(vec(train[0],mode)),'selectedConfig':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2]},'calibration':cs,'holdout':hs,'holdoutTopK':top,'holdoutBySession':sess})

live=next(x for x in results if x['mode']=='live21'); full=next(x for x in results if x['mode']=='full34')
report={'schemaVersion':1,'method':'TAGIT_V310_FROZEN_LIVE_COMPATIBLE_BENCHMARK','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':expected,
'featureContract':{'base11':'LIVE_PARITY','sequenceFirst6':'LIVE_DERIVABLE_FROM_STATE_CACHE','microFirst4':'FINVIZ_5_10_30_60M_MOMENTUM_PARITY','excludedHistoricalMicro':'VWAP/HOD/LOD/range/bar-volume/age from Yahoo-only backfill','excludedSequence':'legacy persistence fields without guaranteed live provider parity'},
'antiLeakage':['frozen v3.9 dataset only; no network calls','Aug11-24 train; Aug25-26 calibration; Aug27-Sep4 untouched holdout','full34 is upper-bound comparator only and cannot be promoted live'],
'coverage':{'rows':len(data),'train':len(train),'calibration':len(cal),'holdout':len(hold),'holdoutPositives':sum(bool(x['target']) for x in hold)},'results':results,
'live21VsFull34':{'live21HoldoutPrecision':live['holdout']['precisionPct'],'live21HoldoutRecall':live['holdout']['recallPct'],'full34HoldoutPrecision':full['holdout']['precisionPct'],'full34HoldoutRecall':full['holdout']['recallPct']}}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
