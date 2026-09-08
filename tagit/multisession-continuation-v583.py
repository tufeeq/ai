#!/usr/bin/env python3
"""TAGit v5.8.3 failure-archetype multi-session continuation validator.

Extends the purged v5.8.1 learner with explicit false-continuation archetypes.
No holdout outcome is used for fitting, archetype construction, or threshold selection.
"""
from pathlib import Path
import json, math
from collections import defaultdict
import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.preprocessing import StandardScaler

exec(compile(Path('tagit/multisession-continuation-v581.py').read_text(encoding='utf-8'),
             'tagit/multisession-continuation-v581.py::v583','exec'), globals(), globals())

OUT583=Path('tag/data/tagit-v583-multisession-failure-archetypes.json')

# Explicit train-only false-continuation archetypes: plausible starter/volume states that
# fail to reach +20% in either of the next two sessions.
fail=[x for x in train if (x['starterDayHighPct']>=7 or x['starterClosePct']>=5 or x['volumeVs20d']>=1.8)
      and not x['next1Explode20'] and not x['next2Explode20']]
succ=[x for x in train if x['next1Explode20'] or x['next2Explode40']]
all_arch=succ+fail
arch_sc=None; succ_km=None; fail_km=None
if len(all_arch)>=100 and len(succ)>=40 and len(fail)>=80:
    arch_sc=StandardScaler().fit(np.asarray([x['feat'] for x in all_arch],float))
    def kmfit(g,seed):
        X=arch_sc.transform(np.asarray([x['feat'] for x in g],float))
        k=min(12,max(3,len(g)//180))
        return MiniBatchKMeans(n_clusters=k,random_state=seed,batch_size=512,n_init=10,max_iter=300).fit(X)
    succ_km=kmfit(succ,5831); fail_km=kmfit(fail,5832)

def sims(rr):
    if not rr or arch_sc is None:return np.zeros(len(rr)),np.zeros(len(rr))
    X=arch_sc.transform(np.asarray([x['feat'] for x in rr],float))
    ds=np.min(succ_km.transform(X),axis=1); df=np.min(fail_km.transform(X),axis=1)
    ss=max(float(np.median(ds)),1e-6); sf=max(float(np.median(df)),1e-6)
    return np.exp(-ds/ss),np.exp(-df/sf)

def enrich583(rr):
    base=enrich(rr)
    sp,sn=sims(rr)
    out=[]
    for x,p,n in zip(base,sp,sn):
        lift=float(p-n)
        # Preserve existing score semantics, then explicitly penalize failure-pattern similarity.
        score=float(np.clip(x['carryScore'] + .12*lift - .06*max(0,n-p),0,1))
        out.append({**x,'successContinuationSimilarity':float(p),'failureContinuationSimilarity':float(n),
                    'continuationPatternLift':lift,'carryScore583':score})
    return out

cp583=enrich583(cal); hp583=enrich583(hold)

def select583(rr,cfg):
    sc,p1,p2,up,di,lift=cfg
    return [x for x in rr if x['carryScore583']>=sc and x['pNext1Explode20']>=p1 and
            x['pNext2Explode20']>=p2 and x['predNext2MaxGainPct']>=up and
            x['disagreement']<=di and x['continuationPatternLift']>=lift]

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def dayblock_lower90(sel,seed=58390,n_boot=4000):
    """5th percentile precision after resampling whole active days with replacement.

    This is reporting-only uncertainty. It is never used for threshold/model selection,
    so holdout outcomes cannot feed back into the fitted discovery system.
    """
    by=defaultdict(list)
    for x in sel: by[x['day']].append(x)
    days=sorted(by)
    if not days:return None
    rng=np.random.default_rng(seed)
    vals=[]
    for _ in range(n_boot):
        sampled=rng.choice(days,size=len(days),replace=True)
        tp=n=0
        for d in sampled:
            g=by[d]; n+=len(g); tp+=sum(x['next1Explode20'] for x in g)
        if n: vals.append(100*tp/n)
    return round(float(np.quantile(vals,.05)),2) if vals else None

def stat(sel,universe):
    n=len(sel); tp=sum(x['next1Explode20'] for x in sel)
    by=defaultdict(list)
    for x in sel:by[x['day']].append(x)
    top3=[]
    for d,g in by.items():top3.extend(sorted(g,key=lambda z:z['carryScore583'],reverse=True)[:3])
    gains=[x['next2MaxGainPct'] for x in sel]
    winners={x['day'] for x in universe if x['next1Explode20']}; caught={x['day'] for x in sel if x['next1Explode20']}
    return {'count':n,'tpNext1':int(tp),'next1Precision20Pct':round(100*tp/n,2) if n else None,
            'wilsonLower90Next1Pct':round(wilson(tp,n),2) if n else None,
            'dayBlockLower90Next1Pct':dayblock_lower90(sel),'activeDays':len(by),
            'top3DailyPrecision20Pct':round(100*sum(x['next1Explode20'] for x in top3)/len(top3),2) if top3 else None,
            'medianNext2MaxGainPct':round(float(np.median(gains)),2) if gains else None,
            'winnerDayRecallPct':round(100*len(caught)/len(winners),2) if winners else None}

# Stability selection on two chronological calibration blocks only.
cal_days=sorted({x['day'] for x in cp583}); mid=max(1,len(cal_days)//2)
a_days=set(cal_days[:mid]); b_days=set(cal_days[mid:]); ca=[x for x in cp583 if x['day'] in a_days]; cb=[x for x in cp583 if x['day'] in b_days]
score_vals=np.asarray([x['carryScore583'] for x in cp583]); lift_vals=np.asarray([x['continuationPatternLift'] for x in cp583])
sg=sorted(set([.45,.55,.65,.72]+[round(float(np.quantile(score_vals,q)),4) for q in (.75,.85,.92)]))
lg=sorted(set([-.15,0,.08,.15]+[round(float(np.quantile(lift_vals,q)),3) for q in (.50,.70,.85)]))
candidates=[]
for sc in sg:
  for p1 in (.25,.35,.45,.55):
    for p2 in (.30,.40,.50,.60):
      for up in (12,16,20,25):
        for di in (.10,.14,.20):
          for lf in lg:
            cfg=(sc,p1,p2,up,di,lf); sa=stat(select583(ca,cfg),ca); sb=stat(select583(cb,cfg),cb)
            pa=sa['next1Precision20Pct'] or 0; pb=sb['next1Precision20Pct'] or 0; la=sa['wilsonLower90Next1Pct'] or 0; lb=sb['wilsonLower90Next1Pct'] or 0
            u=min(la,lb)*220+min(pa,pb)*35-abs(pa-pb)*35+min(sa['count'],100)+min(sb['count'],100)
            if sa['count']<30 or sb['count']<30:u-=8000
            if sa['activeDays']<10 or sb['activeDays']<10:u-=5000
            candidates.append((u,cfg,sa,sb))
candidates.sort(key=lambda z:z[0],reverse=True); _,cfg,sa,sb=candidates[0]
calstat=stat(select583(cp583,cfg),cp583); holdstat=stat(select583(hp583,cfg),hp583)

report={'schemaVersion':'5.8.3-failure-archetype-multisession','status':'COMPLETE','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
        'trainArchetypes':{'successCases':len(succ),'failureCases':len(fail),'successClusters':getattr(succ_km,'n_clusters',0),'failureClusters':getattr(fail_km,'n_clusters',0)},
        'selectedConfig':{'minCarryScore583':cfg[0],'minPNext1':cfg[1],'minPNext2':cfg[2],'minPredUpside':cfg[3],'maxDisagreement':cfg[4],'minContinuationPatternLift':cfg[5]},
        'calibrationBlocks':{'A':sa,'B':sb},'calibration':calstat,'holdout':holdstat,
        'baselineV581HoldoutPrecisionPct':(readj(Path('tag/data/tagit-v581-multisession-continuation.json'),{}).get('holdout') or {}).get('next1Precision20Pct'),
        'universeIntegrity':{'marketWidePointInTimeUniverse':False,'realDiscoveryPrecisionClaimAllowed':False},
        'antiLeakage':['features use current/prior completed sessions only','future sessions are labels only','split-boundary label horizons are purged by v5.8.1','success/failure archetypes fit on train only','configuration selected on chronological calibration blocks only','holdout evaluated only after freeze','day-block bootstrap is reporting-only and never participates in selection'],
        'credible90Claim':False,'mainBottleneck':'false continuation discrimination and historical mover-conditioned universe'}
OUT583.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
