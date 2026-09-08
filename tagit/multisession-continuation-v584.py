#!/usr/bin/env python3
"""TAGit v5.8.4 asymmetric failure-veto continuation validator.

Research-only successor to v5.8.3. It uses train-only failure archetypes only as a veto,
never as a positive boost. Configuration is selected on the first chronological half of
calibration and must pass a second calibration half guardrail before the consumed research
holdout is opened. No holdout outcome participates in model fitting or selection.
"""
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone
import json, math
import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.preprocessing import StandardScaler

exec(compile(Path('tagit/multisession-continuation-v581.py').read_text(encoding='utf-8'),
             'tagit/multisession-continuation-v581.py::v584','exec'), globals(), globals())

OUT584=Path('tag/data/tagit-v584-multisession-asymmetric-veto.json')

# Train-only failure archetypes. Positives are used solely to estimate a relative margin;
# the final score can only stay unchanged or be reduced.
fail=[x for x in train if (x['starterDayHighPct']>=7 or x['starterClosePct']>=5 or x['volumeVs20d']>=1.8)
      and not x['next1Explode20'] and not x['next2Explode20']]
succ=[x for x in train if x['next1Explode20'] or x['next2Explode40']]
arch_sc=None; succ_km=None; fail_km=None
if len(succ)>=40 and len(fail)>=80:
    all_arch=succ+fail
    arch_sc=StandardScaler().fit(np.asarray([x['feat'] for x in all_arch],float))
    def kmfit(g,seed):
        X=arch_sc.transform(np.asarray([x['feat'] for x in g],float))
        k=min(10,max(3,len(g)//220))
        return MiniBatchKMeans(n_clusters=k,random_state=seed,batch_size=512,n_init=10,max_iter=300).fit(X)
    succ_km=kmfit(succ,5841); fail_km=kmfit(fail,5842)

def similarity(rr):
    if not rr or arch_sc is None:
        return np.zeros(len(rr)),np.zeros(len(rr))
    X=arch_sc.transform(np.asarray([x['feat'] for x in rr],float))
    ds=np.min(succ_km.transform(X),axis=1); df=np.min(fail_km.transform(X),axis=1)
    ss=max(float(np.median(ds)),1e-6); sf=max(float(np.median(df)),1e-6)
    return np.exp(-ds/ss),np.exp(-df/sf)

def enrich584(rr):
    base=enrich(rr)
    sp,sn=similarity(rr)
    out=[]
    for x,p,n in zip(base,sp,sn):
        fail_margin=float(n-p)
        out.append({**x,'successContinuationSimilarity':float(p),'failureContinuationSimilarity':float(n),
                    'failureMargin':fail_margin})
    return out

cp584=enrich584(cal); hp584=enrich584(hold)

def apply_cfg(rr,cfg):
    sc,p1,p2,up,di,margin,penalty=cfg
    out=[]
    for x in rr:
        veto=max(0.0,x['failureMargin']-margin)
        gated=float(np.clip(x['carryScore']-penalty*veto,0,1))
        if gated>=sc and x['pNext1Explode20']>=p1 and x['pNext2Explode20']>=p2 and x['predNext2MaxGainPct']>=up and x['disagreement']<=di:
            out.append({**x,'carryScore584':gated,'vetoStrength':veto})
    return out

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def dayblock_lower90(sel,seed=58490,n_boot=3000):
    by=defaultdict(list)
    for x in sel: by[x['day']].append(x)
    days=sorted(by)
    if not days:return None
    rng=np.random.default_rng(seed); vals=[]
    for _ in range(n_boot):
        sampled=rng.choice(days,size=len(days),replace=True); tp=nn=0
        for d in sampled:
            g=by[d]; nn+=len(g); tp+=sum(x['next1Explode20'] for x in g)
        if nn: vals.append(100*tp/nn)
    return round(float(np.quantile(vals,.05)),2) if vals else None

def stat(sel,universe):
    n=len(sel); tp=sum(x['next1Explode20'] for x in sel)
    by=defaultdict(list)
    for x in sel:by[x['day']].append(x)
    top3=[]
    for _,g in by.items(): top3.extend(sorted(g,key=lambda z:z.get('carryScore584',z['carryScore']),reverse=True)[:3])
    winners={x['day'] for x in universe if x['next1Explode20']}; caught={x['day'] for x in sel if x['next1Explode20']}
    gains=[x['next2MaxGainPct'] for x in sel]
    return {'count':n,'tpNext1':int(tp),'next1Precision20Pct':round(100*tp/n,2) if n else None,
            'wilsonLower90Next1Pct':round(wilson(tp,n),2) if n else None,
            'dayBlockLower90Next1Pct':dayblock_lower90(sel),'activeDays':len(by),
            'top3DailyPrecision20Pct':round(100*sum(x['next1Explode20'] for x in top3)/len(top3),2) if top3 else None,
            'medianNext2MaxGainPct':round(float(np.median(gains)),2) if gains else None,
            'winnerDayRecallPct':round(100*len(caught)/len(winners),2) if winners else None}

# Nested chronological calibration: A selects, B confirms. Holdout is not touched until freeze.
cal_days=sorted({x['day'] for x in cp584}); mid=max(1,len(cal_days)//2)
a_days=set(cal_days[:mid]); b_days=set(cal_days[mid:])
ca=[x for x in cp584 if x['day'] in a_days]; cb=[x for x in cp584 if x['day'] in b_days]
base_scores=np.asarray([x['carryScore'] for x in ca]); p1s=np.asarray([x['pNext1Explode20'] for x in ca]); p2s=np.asarray([x['pNext2Explode20'] for x in ca]); ups=np.asarray([x['predNext2MaxGainPct'] for x in ca])
sg=sorted(set([.45,.55,.65,.75]+[round(float(np.quantile(base_scores,q)),4) for q in (.80,.90,.95)]))
p1g=sorted(set([.25,.4,.55]+[round(float(np.quantile(p1s,q)),4) for q in (.75,.88)]))
p2g=sorted(set([.30,.45,.60]+[round(float(np.quantile(p2s,q)),4) for q in (.75,.88)]))
upg=sorted(set([12,16,20,25]+[round(float(np.quantile(ups,q)),2) for q in (.65,.80)]))
margin_grid=(0.00,.04,.08,.12,.18); penalty_grid=(0.0,.15,.30,.50)

candidates=[]
for sc in sg:
  for p1 in p1g:
    for p2 in p2g:
      for up in upg:
        for di in (.12,.20,.30):
          for margin in margin_grid:
            for penalty in penalty_grid:
              cfg584=(sc,p1,p2,up,di,margin,penalty); sa=stat(apply_cfg(ca,cfg584),ca)
              p=sa['next1Precision20Pct'] or 0; lo=sa['wilsonLower90Next1Pct'] or 0; top=sa['top3DailyPrecision20Pct'] or 0; rec=sa['winnerDayRecallPct'] or 0
              utility=lo*180+p*30+top*14+rec*4+min(sa['count'],160)
              if sa['count']<35:utility-=7000
              if sa['activeDays']<12:utility-=5000
              candidates.append((utility,cfg584,sa))
candidates.sort(key=lambda z:z[0],reverse=True)

# Confirm top candidates on B. Prefer a veto only when it does not degrade B Wilson/support
# versus the same configuration with penalty=0. This keeps failure memory asymmetric and optional.
confirmed=[]
for _,cfg584,sa in candidates[:40]:
    sb=stat(apply_cfg(cb,cfg584),cb)
    base_cfg=(*cfg584[:5],cfg584[5],0.0)
    bb=stat(apply_cfg(cb,base_cfg),cb)
    lo=sb['wilsonLower90Next1Pct'] or 0; blo=bb['wilsonLower90Next1Pct'] or 0
    n=sb['count']; bn=bb['count']
    passes=(n>=30 and sb['activeDays']>=10 and lo>=blo-0.75 and n>=max(30,int(.70*bn)))
    score=(1 if passes else 0, lo, sb['next1Precision20Pct'] or 0, sb['top3DailyPrecision20Pct'] or 0, sb['winnerDayRecallPct'] or 0, n)
    confirmed.append((score,cfg584,sa,sb,bb))
confirmed.sort(key=lambda z:z[0],reverse=True)
_,cfg584,sa,sb,bb=confirmed[0]
calstat=stat(apply_cfg(cp584,cfg584),cp584)
# Only now evaluate the already-consumed research holdout.
holdstat=stat(apply_cfg(hp584,cfg584),hp584)

report={'schemaVersion':'5.8.4-asymmetric-failure-veto','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
        'status':'COMPLETE','policy':'RESEARCH_ONLY_CONSUMED_HOLDOUT_NO_CHAMPION_OVERRIDE',
        'trainArchetypes':{'successCases':len(succ),'failureCases':len(fail),'successClusters':getattr(succ_km,'n_clusters',0),'failureClusters':getattr(fail_km,'n_clusters',0)},
        'selectedConfig':{'minCarryScore':cfg584[0],'minPNext1':cfg584[1],'minPNext2':cfg584[2],'minPredUpside':cfg584[3],'maxDisagreement':cfg584[4],'failureMargin':cfg584[5],'vetoPenalty':cfg584[6]},
        'calibrationASelection':sa,'calibrationBConfirmation':sb,'calibrationBBaselineNoVeto':bb,'calibration':calstat,'holdout':holdstat,
        'realDiscoveryPrecisionPct':None,
        'universeIntegrity':{'marketWidePointInTimeUniverse':False,'survivorshipSafe':False,'realDiscoveryPrecisionClaimAllowed':False},
        'antiLeakage':['features use current/prior completed sessions only','future sessions are labels only','split-boundary label horizons purged by v5.8.1','failure/success archetypes fit on train only','calibration A selects configuration','calibration B confirms before research holdout is opened','veto can only reduce baseline score','holdout is consumed research evidence and cannot establish real precision','day-block bootstrap is reporting-only'],
        'credible90Claim':False,'mainBottleneck':'historical universe is mover-conditioned and not point-in-time; continuation failure memory can reduce recall if over-applied'}
OUT584.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
