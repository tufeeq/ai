#!/usr/bin/env python3
"""TAGit v5.0 strict precision research lab.

Goal: test whether a genuinely selective >=90% precision alert tier exists without
look-ahead. This script deliberately optimizes precision over coverage and refuses to
claim success unless the untouched chronological holdout also reaches the target.

Important fixes vs older experiments:
- frozen causal v3.9 dataset only;
- chronological train/calibration/holdout from the frozen contract;
- duplicate ticker/day observations get inverse-frequency training weight;
- hard-negative mining is learned inside TRAIN only;
- threshold/top-k/disagreement are selected on CALIBRATION only;
- HOLDOUT is touched once after the configuration is frozen;
- first qualifying event per ticker/day is the evaluation/action unit;
- 90% is a measured target, never a hard-coded reported result.
"""
import json, math, pathlib
from collections import Counter, defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json')
OUT=pathlib.Path('tag/data/tagit-v50-precision-lab.json')
TARGET_PRECISION=90.0
MIN_CAL_ALERTS=8
MIN_HOLD_ALERTS=8

root=json.loads(SRC.read_text())
data=root['data']; ns=root['splitRows']; ntr=int(ns['train']); ncal=int(ns['calibration'])
train=data[:ntr]; cal=data[ntr:ntr+ncal]; hold=data[ntr+ncal:]

# Preserve causality: only stored future-safe feature vectors and contemporaneous fields.
def sess(s):
    s=str(s or '').lower(); return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))

def fvec(x):
    s=sess(x.get('session'))
    base=list(x['base'])+list(x['sequence'])+list(x['micro'])
    # Interactions that are fully contemporaneous and often useful for rare-event separation.
    ch=float(x.get('change') or 0); cr=float(x.get('changeRank') or 0); vr=float(x.get('volumeRank') or 0)
    price=max(.001,float(x.get('price') or .001)); vol=max(0.,float(x.get('volume') or 0))
    base += [
      math.log(price), math.log1p(vol), ch/20., cr, vr,
      float(s==0),float(s==1),float(s==2),
      cr*vr, (ch/20.)*vr, (ch/20.)*cr,
      float(x['micro'][0])*float(x['micro'][1]),
      float(x['micro'][1])-float(x['micro'][2]),
      float(x['sequence'][0])-float(x['sequence'][1]),
    ]
    return np.asarray(base,float)

def y10(x): return int(bool(x.get('target')))
def clean(x): return int(float(x.get('mfeGT',-999))>=10 and float(x.get('maeGT',-999))>=-5)
def clearneg(x): return float(x.get('mfeGT',999))<4

def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    p=tp/n; den=1+z*z/n; c=p+z*z/(2*n); a=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)
    return max(0.,(c-a)/den)*100

def event_weight(rows):
    c=Counter(x['key'] for x in rows)
    return np.asarray([1.0/max(1,c[x['key']]) for x in rows],float)

def train_models(rows,seed=5000,hard=False):
    # Train on clean winners + clear negatives; ambiguous outcomes remain in evaluation.
    rr=[x for x in rows if clean(x) or clearneg(x)]
    X=np.asarray([fvec(x) for x in rr]); y=np.asarray([clean(x) for x in rr],int)
    sc=StandardScaler().fit(X); Xs=sc.transform(X)
    ew=event_weight(rr); pos=max(1,int(y.sum())); neg=max(1,len(y)-pos)
    w=ew*np.where(y==1,min(80.,neg/pos),1.)
    et=ExtraTreesClassifier(n_estimators=650,max_depth=12,min_samples_leaf=5,max_features=.72,class_weight='balanced_subsample',random_state=seed,n_jobs=-1).fit(X,y,sample_weight=ew)
    hg=HistGradientBoostingClassifier(max_iter=300,max_leaf_nodes=19,learning_rate=.035,l2_regularization=7,min_samples_leaf=18,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1200,C=.12,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=ew)
    if hard:
        # Mine only TRAIN false positives; no calibration/holdout information is used.
        p=(et.predict_proba(X)[:,1]+hg.predict_proba(X)[:,1]+lr.predict_proba(Xs)[:,1])/3
        cutoff=float(np.quantile(p[y==0],.90)) if np.any(y==0) else 1.
        w2=w.copy(); w2[(y==0)&(p>=cutoff)]*=5.0
        hg=HistGradientBoostingClassifier(max_iter=360,max_leaf_nodes=15,learning_rate=.03,l2_regularization=10,min_samples_leaf=22,random_state=seed+11).fit(X,y,sample_weight=w2)
        lr=LogisticRegression(max_iter=1400,C=.08,class_weight='balanced',random_state=seed+12).fit(Xs,y,sample_weight=np.where((y==0)&(p>=cutoff),ew*4,ew))
    return sc,et,hg,lr

def score(model,rows):
    sc,et,hg,lr=model; X=np.asarray([fvec(x) for x in rows]); Xs=sc.transform(X)
    a=et.predict_proba(X)[:,1]; b=hg.predict_proba(X)[:,1]; c=lr.predict_proba(Xs)[:,1]
    ens=.42*a+.40*b+.18*c; dis=np.std(np.vstack([a,b,c]),axis=0)
    out=[]
    for x,e,d,pa,pb,pc in zip(rows,ens,dis,a,b,c):
        out.append({**x,'v50Score':float(e),'v50Disagreement':float(d),'modelMin':float(min(pa,pb,pc))})
    return out

def first_events(xs):
    out=[]; seen=set()
    for x in sorted(xs,key=lambda z:(float(z.get('ts') or 0),z['ticker'])):
        if x['key'] in seen:continue
        seen.add(x['key']);out.append(x)
    return out

def apply(xs,cfg):
    thr,dis,minm,topk,sessions=cfg
    by=defaultdict(list)
    for x in xs:
        if sess(x['session']) not in sessions:continue
        if x['v50Score']>=thr and x['v50Disagreement']<=dis and x['modelMin']>=minm:
            by[x.get('si',x['day'])].append(x)
    selected=[]
    for g in by.values():
        g=sorted(g,key=lambda z:z['v50Score'],reverse=True)[:topk]; selected.extend(g)
    return first_events(selected)

def metrics(sel,univ):
    n=len(sel); tp=sum(y10(x) for x in sel); ctp=sum(clean(x) for x in sel)
    winner_keys={x['key'] for x in univ if y10(x)}; hit={x['key'] for x in sel if y10(x)}
    return {'count':n,'tp10':tp,'precision10Pct':round(100*tp/n,2) if n else None,
            'cleanTp':ctp,'cleanPrecisionPct':round(100*ctp/n,2) if n else None,
            'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,
            'winnerTickerDays':len(winner_keys),'capturedWinnerTickerDays':len(hit),
            'tickerDayRecallPct':round(100*len(hit)/len(winner_keys),2) if winner_keys else None,
            'activeDays':len({x['day'] for x in sel})}

# Train strictly on TRAIN. Calibration chooses the selective policy.
model=train_models(train,hard=True)
cp=score(model,cal)
thresholds=sorted(set([.50,.60,.70,.75,.80,.85,.88,.90,.92,.94,.96,.97,.98,.985,.99]+[float(np.quantile([x['v50Score'] for x in cp],q)) for q in (.90,.93,.95,.97,.98,.99)]))
configs=[]
for t in thresholds:
  for d in (.03,.05,.08,.12,.18,.25):
    for m in (.05,.10,.20,.30,.40,.50):
      for k in (1,2,3):
        for ss in ((0,),(1,),(0,1),(0,1,2)):
          cfg=(t,d,m,k,ss); z=metrics(apply(cp,cfg),cp); p=z['precision10Pct'] or 0
          # Prefer 90%-qualified calibration rules; among them maximize statistical support,
          # then Wilson lower bound, then recall. Otherwise expose the best frontier honestly.
          qualified=z['count']>=MIN_CAL_ALERTS and p>=TARGET_PRECISION
          utility=(1_000_000 if qualified else 0)+(z['wilsonLower90Pct'] or 0)*100+z['tp10']*10+(z['tickerDayRecallPct'] or 0)-z['count']*.01
          configs.append((utility,qualified,cfg,z))
configs.sort(key=lambda z:z[0],reverse=True)
_,calQualified,cfg,cm=configs[0]

# Freeze configuration, refit only with TRAIN+CAL labels, then touch HOLDOUT once.
# Threshold/config remains frozen from calibration.
final_model=train_models(train+cal,seed=5100,hard=True)
hp=score(final_model,hold); hs=metrics(apply(hp,cfg),hp)
holdQualified=bool(hs['count']>=MIN_HOLD_ALERTS and (hs['precision10Pct'] or 0)>=TARGET_PRECISION)

front=[]
for _,q,c,m in configs[:20]:
    front.append({'qualified90Calibration':q,'config':{'threshold':round(c[0],5),'maxDisagreement':c[1],'minModelProbability':c[2],'topKPerSnapshot':c[3],'sessions':list(c[4])},'calibration':m})

verdict='V50_90PCT_HOLDOUT_CONFIRMED' if calQualified and holdQualified else ('V50_CALIBRATED_90_NOT_CONFIRMED' if calQualified else 'V50_CURRENT_DATA_CANNOT_SUPPORT_90')
report={
 'schemaVersion':'5.0-precision-lab','method':'STRICT_SELECTIVE_EVENT_LEVEL_PRECISION','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':root['datasetSha256'],'target':'+10% MFE within next 60m before move is already >=10%',
 'precisionObjectivePct':TARGET_PRECISION,
 'dataReality':{'frozenRows':len(data),'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainTickerDays':len({x['key'] for x in train}),'calTickerDays':len({x['key'] for x in cal}),'holdTickerDays':len({x['key'] for x in hold}),'trainPositives':sum(y10(x) for x in train),'calPositives':sum(y10(x) for x in cal),'holdoutPositives':sum(y10(x) for x in hold)},
 'antiLeakage':['frozen v3.9 causal features only','chronological split from frozen contract','duplicate ticker/day inverse weighting','hard negatives mined inside training only','threshold/config selected calibration only','holdout touched only after policy freeze','first qualifying ticker/day event is action unit'],
 'selectedConfig':{'threshold':round(cfg[0],6),'maxDisagreement':cfg[1],'minModelProbability':cfg[2],'topKPerSnapshot':cfg[3],'sessions':list(cfg[4])},
 'calibration':cm,'holdout':hs,'calibrationReached90':calQualified,'holdoutReached90':holdQualified,'frontierTop20':front,
 'promotion':{'autoPromotion':False,'requiresIndependentExternalHistory':not holdQualified,'requiresForwardValidation':True},'verdict':verdict
}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
