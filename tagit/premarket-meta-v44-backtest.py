#!/usr/bin/env python3
"""TAGit v4.4 causal pre-market event meta-ranker.

Design:
- Frozen v3.9 dataset only; no network calls.
- Base ranker is the validated live21 v4 ranker from v4.1 helpers.
- Only the FIRST pre-market base-gate event per ticker/day is eligible.
- Build expanding-walk-forward ranker predictions on pre-holdout days.
- Meta-model predictions used for threshold selection are themselves expanding
  out-of-fold by day: a meta prediction is produced only by earlier event-days.
- Fit final meta-model on all eligible OOF events and evaluate Aug27-Sep4.
- Regular and after-hours are intentionally disabled for this experiment.
"""
import json, math, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
data=G['data']; fit_score=G['fit_score']; enrich=G['enrich']; scode=G['scode']
metrics=G['metrics']; first_events=G['first_events']; sha=G['sha']
OUT=pathlib.Path('tag/data/tagit-v44-premarket-meta-backtest.json')


def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    p=tp/n; den=1+z*z/n; center=p+z*z/(2*n)
    adj=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)
    return max(0.0,(center-adj)/den)


def base_pre_events(xs):
    eligible=[x for x in xs if scode(x['session'])==0 and x['gate']]
    return first_events(eligible)


def feat(x):
    # All fields are causal and reproducible in the live v4/v4.1 state cache.
    return [
        float(x['ensemble']*100),
        float(x['disagreement']*100),
        float(x['rank']),
        float(x['persistence']),
        float(x['continuation']),
        float(x['streak']),
        1.0 if x['progression'] else 0.0,
        float(x['rankImprovement']),
        float(x['micro'][0]*10),
        float(x['micro'][1]*10),
    ]


def fit_meta(train_events, test_events):
    if not train_events or not test_events:return np.array([])
    X=np.asarray([feat(x) for x in train_events],float); Xt=np.asarray([feat(x) for x in test_events],float)
    y=np.asarray([int(bool(x['target'])) for x in train_events],int)
    if len(set(y.tolist()))<2:return np.full(len(test_events),float(y.mean() if len(y) else 0.0))
    sc=StandardScaler().fit(X); Xs=sc.transform(X); Xts=sc.transform(Xt)
    lr=LogisticRegression(max_iter=800,class_weight='balanced',C=.22,random_state=4401).fit(Xs,y)
    et=ExtraTreesClassifier(n_estimators=420,max_depth=5,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=4402,n_jobs=-1).fit(X,y)
    return .60*lr.predict_proba(Xts)[:,1]+.40*et.predict_proba(Xt)[:,1]


def active_days(xs):return len({x['day'] for x in xs})

# 1) Expanding base-ranker OOF predictions before holdout.
prehold=sorted({x['day'] for x in data if x['day']<='2026-08-26'})
base_oof=[]; base_oof_days=[]
for d in prehold:
    tr=[x for x in data if x['day']<d]; te=[x for x in data if x['day']==d]
    if len({x['day'] for x in tr})<4 or sum(bool(x['target']) for x in tr)<12 or not te:continue
    scored=enrich(fit_score(tr,te)); ev=base_pre_events(scored)
    if ev:
        base_oof.extend(ev); base_oof_days.append(d)

# 2) Expanding meta-OOF: each day predicted using only earlier event-days.
meta_oof=[]; meta_days=[]
for d in sorted({x['day'] for x in base_oof}):
    tr=[x for x in base_oof if x['day']<d]; te=[x for x in base_oof if x['day']==d]
    if len({x['day'] for x in tr})<3 or sum(bool(x['target']) for x in tr)<5 or not te:continue
    pr=fit_meta(tr,te)
    for x,p in zip(te,pr):meta_oof.append({**x,'metaProb':float(p)})
    meta_days.append(d)
assert meta_oof and len(meta_days)>=2

# 3) Choose threshold only from causal meta-OOF predictions.
thresholds=sorted(set([round(float(np.quantile([x['metaProb'] for x in meta_oof],q)),4) for q in (.35,.45,.55,.65,.72,.78,.83,.87,.90,.93)] + [.50,.55,.60,.65,.70,.75]))
cands=[]
for th in thresholds:
    a=[x for x in meta_oof if x['metaProb']>=th]
    m=metrics(a,meta_oof); p=(m['precisionPct'] or 0)/100.0; lb=wilson(m['tp'],m['count'])
    support=min(1,m['count']/20)*min(1,m['tp']/4); day_support=min(1,active_days(a)/4)
    utility=100*lb*support*day_support + (m['recallTickerDayPct'] or 0)*.10 + m['tp']*1.2
    cands.append((utility,th,m,lb,active_days(a)))
# Require actual support; otherwise use broadest candidate with support rather than a tiny-sample winner.
valid=[z for z in cands if z[2]['count']>=15 and z[2]['tp']>=3 and z[4]>=3]
best=max(valid if valid else cands,key=lambda z:z[0])
selected_th=best[1]

# 4) Final untouched historical evaluation on Aug27-Sep4.
fit=[x for x in data if x['day']<='2026-08-26']; hold=[x for x in data if x['day']>='2026-08-27']
hp=enrich(fit_score(fit,hold)); hold_base=base_pre_events(hp)
final_meta_train=base_oof
hold_prob=fit_meta(final_meta_train,hold_base)
hold_scored=[{**x,'metaProb':float(p)} for x,p in zip(hold_base,hold_prob)]
hold_alert=[x for x in hold_scored if x['metaProb']>=selected_th]

# v4.1 pre comparator = first pre event from v4.1 selected historical policy.
def v41_pre(xs):
    cfg={'weights':(.45,.30,.15,.10),'preThr':55,'regThr':65,'regMinPersistence':30,'minHeat':0}
    return first_events(G['apply_policy'](xs,cfg))
v41_pre_hold=[x for x in v41_pre(hp) if scode(x['session'])==0]

report={
 'schemaVersion':'4.4-research','method':'TAGIT_V44_CAUSAL_PREMARKET_EVENT_META_RANKER','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
 'antiLeakage':['frozen v3.9 dataset only; no network calls','base ranker OOF day uses only earlier training days','meta OOF day uses only earlier OOF event-days','threshold selected only from expanding meta-OOF predictions','Aug27-Sep4 not used in model or threshold fitting','first pre-market base-gate event only','regular and after-hours disabled'],
 'features':['rankScorePct','modelDisagreementPct','rank','persistence','continuation','streak','progression','rankImprovement','momentum5mPct','momentum10mPct'],
 'coverage':{'baseOofDays':base_oof_days,'baseOofEvents':len(base_oof),'baseOofWinners':sum(bool(x['target']) for x in base_oof),'metaOofDays':meta_days,'metaOofEvents':len(meta_oof),'metaOofWinners':sum(bool(x['target']) for x in meta_oof),'holdoutBasePreEvents':len(hold_base),'holdoutBasePreWinners':sum(bool(x['target']) for x in hold_base)},
 'selectedThreshold':selected_th,
 'metaOof':{'selected':best[2],'wilsonLower90':round(best[3]*100,2),'activeDays':best[4]},
 'holdout':{
   'v4BasePreFirstEvent':metrics(hold_base,[x for x in hp if scode(x['session'])==0]),
   'v41PreFirstEvent':metrics(v41_pre_hold,[x for x in hp if scode(x['session'])==0]),
   'v44MetaFirstEvent':metrics(hold_alert,[x for x in hp if scode(x['session'])==0]),
   'v44ActiveDays':active_days(hold_alert)
 },
 'promotionRule':{'autoPromotion':False,'mustBeatV41PrePrecisionByPp':2,'minHoldoutEvents':15,'minHoldoutWinners':4,'retainAtLeastHalfV41PreTickerDayRecall':True},
 'verdict':None
}
v41=report['holdout']['v41PreFirstEvent'];v44=report['holdout']['v44MetaFirstEvent']
pp=(v44['precisionPct'] or 0)-(v41['precisionPct'] or 0); support=v44['count']>=15 and v44['tp']>=4
rec=(v44['recallTickerDayPct'] or 0)>=.5*(v41['recallTickerDayPct'] or 0)
report['verdict']='V44_FORWARD_SHADOW_CANDIDATE' if pp>=2 and support and rec else 'DO_NOT_PROMOTE_V44'
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
