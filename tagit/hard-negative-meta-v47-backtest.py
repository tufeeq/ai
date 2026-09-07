#!/usr/bin/env python3
"""TAGit v4.7 hard-negative meta learner.

Two-stage design:
1) Keep the validated v4/live21 ranker as a wide high-recall candidate generator.
2) Learn only among first-event hard candidates whether the event is a +10%/60m winner.

Causality / evaluation:
- Frozen v3.9 dataset only.
- Base-ranker scores for meta training are expanding OOF: each day is scored by a
  ranker trained only on prior days.
- Meta learner trains on OOF days through Aug24.
- Hyperparameters / thresholds are selected only on Aug25-26 OOF events.
- Final meta learner is refit on all OOF events through Aug26 and evaluated once on
  Aug27-Sep4 holdout scored by a ranker fit through Aug26.
- First event per ticker/day is the unit of action/evaluation.
- No catalyst, SEC, Yahoo future bars or current/future data enter features.
"""
import json, math, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
data=G['data']; fit_score=G['fit_score']; enrich=G['enrich']; scode=G['scode']; metrics=G['metrics']; first_events=G['first_events']; sha=G['sha']
OUT=pathlib.Path('tag/data/tagit-v47-hard-negative-meta-backtest.json')


def candidates(xs):
    # Wide v4 candidate set: pre gate; regular gate+progression; after informational.
    a=[x for x in xs if (scode(x['session'])==0 and x['gate']) or (scode(x['session'])==1 and x['gate'] and x['progression'])]
    return first_events(a)

def fvec(x):
    e=float(x['ensemble']); d=float(x['disagreement']); p=float(x['persistence'])/100.; c=float(x['continuation'])/100.; h=float(x['marketHeat'])/100.
    rank=max(1,int(x['rank'])); ri=float(x['rankImprovement'])/20.; streak=min(5,float(x['streak']))/5.
    m=[float(v) for v in x['micro'][:4]]
    s=scode(x['session'])
    return [
      e,d,1.0/rank,p,c,h,float(bool(x['progression'])),streak,ri,
      m[0],m[1],m[2],m[3],
      e*p,e*c,p*c,c*h,e*(1-d),
      float(s==0),float(s==1)
    ]

def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    ph=tp/n; den=1+z*z/n; center=ph+z*z/(2*n); adj=z*math.sqrt((ph*(1-ph)+z*z/(4*n))/n)
    return max(0.0,(center-adj)/den)

def fit_meta(tr,C):
    X=np.asarray([fvec(x) for x in tr],float); y=np.asarray([int(bool(x['target'])) for x in tr])
    sc=StandardScaler().fit(X); mdl=LogisticRegression(C=C,class_weight='balanced',max_iter=1000,random_state=4701).fit(sc.transform(X),y)
    return sc,mdl

def score_meta(model,xs):
    sc,mdl=model; X=np.asarray([fvec(x) for x in xs],float)
    ps=mdl.predict_proba(sc.transform(X))[:,1]
    return [{**x,'metaProbability':float(p)} for x,p in zip(xs,ps)]

def pick(xs,thr,session_code=None):
    return [x for x in xs if x['metaProbability']>=thr and (session_code is None or scode(x['session'])==session_code)]

def active_days(xs):return len({x['day'] for x in xs})

# Expanding OOF base-ranker events.
days=sorted({x['day'] for x in data if x['day']<='2026-08-26'})
oof=[]; used=[]
for d in days:
    tr=[x for x in data if x['day']<d]; te=[x for x in data if x['day']==d]
    if len({x['day'] for x in tr})<4 or sum(bool(x['target']) for x in tr)<12 or not te:continue
    z=candidates(enrich(fit_score(tr,te)))
    if z:oof.extend(z); used.append(d)
meta_train=[x for x in oof if x['day']<='2026-08-24']
meta_cal=[x for x in oof if '2026-08-25'<=x['day']<='2026-08-26']

# Thresholds picked only on calibration. A session can be disabled if it cannot
# beat its base precision with meaningful support.
Cs=(.03,.07,.15,.30,.60,1.0)
thresholds=(.40,.45,.50,.55,.60,.65,.70,.75,.80)
configs=[]
for C in Cs:
    if sum(bool(x['target']) for x in meta_train)<4:continue
    model=fit_meta(meta_train,C); cal=score_meta(model,meta_cal)
    for tp in thresholds:
      for tr in thresholds:
        selected=[]; enabled={}
        for code,thr,name in ((0,tp,'pre'),(1,tr,'regular')):
            u=[x for x in meta_cal if scode(x['session'])==code]; a=pick(cal,thr,code)
            bm=metrics(u,u); am=metrics(a,u)
            pp=(am['precisionPct'] or 0)-(bm['precisionPct'] or 0)
            # Calibration support deliberately modest; final holdout has stricter support.
            on=am['count']>=5 and am['tp']>=2 and pp>=2
            enabled[name]=on
            if on:selected+=a
        m=metrics(selected,meta_cal); lb=wilson(m['tp'],m['count']); days_active=active_days(selected)
        utility=100*lb + .20*(m['recallTickerDayPct'] or 0) + .75*m['tp'] if selected else -1e6
        configs.append((utility,C,tp,tr,enabled,m,round(100*lb,2),days_active))

best=max(configs,key=lambda z:z[0]) if configs else None
if best is None:
    raise RuntimeError('No v4.7 calibration configurations')
_,C,tp,tr,enabled,calm,cal_lb,cal_days=best

# Refit meta on all causal OOF events through Aug26; holdout remains untouched.
meta_all=meta_train+meta_cal
final_model=fit_meta(meta_all,C)
fit=[x for x in data if x['day']<='2026-08-26']; hold=[x for x in data if x['day']>='2026-08-27']
hold_base=candidates(enrich(fit_score(fit,hold))); hs=score_meta(final_model,hold_base)
sel=[]
if enabled.get('pre'):sel+=pick(hs,tp,0)
if enabled.get('regular'):sel+=pick(hs,tr,1)
sel=first_events(sel)
base=metrics(hold_base,hold_base); vm=metrics(sel,hold_base)

by={}
for code,name,thr in ((0,'pre',tp),(1,'regular',tr)):
    u=[x for x in hold_base if scode(x['session'])==code]; a=[x for x in sel if scode(x['session'])==code]
    by[name]={'enabled':bool(enabled.get(name)),'threshold':thr,'base':metrics(u,u),'v47':metrics(a,u)}

pp=(vm['precisionPct'] or 0)-(base['precisionPct'] or 0)
rec=(vm['recallTickerDayPct'] or 0)>=.5*(base['recallTickerDayPct'] or 0)
support=vm['count']>=20 and vm['tp']>=5
nozero=all((not z['enabled']) or (z['v47']['tp'] or 0)>0 for z in by.values())
verdict='V47_SHADOW_CANDIDATE' if pp>=2 and rec and support and nozero else 'DO_NOT_PROMOTE_V47'

# Descriptive residual coefficients only; do not use as causal claims.
sc,mdl=final_model
names=['ensemble','disagreement','inverseRank','persistence','continuation','marketHeat','progression','streak','rankImprovement','m5','m10','m30','m60','ensembleXpersistence','ensembleXcontinuation','persistenceXcontinuation','continuationXheat','ensembleXagreement','isPre','isRegular']
coef=sorted([{'feature':n,'coefficient':round(float(c),5)} for n,c in zip(names,mdl.coef_[0])],key=lambda z:abs(z['coefficient']),reverse=True)

report={
 'schemaVersion':'4.7-research','method':'TAGIT_V47_HARD_NEGATIVE_META','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
 'antiLeakage':['frozen v3.9 dataset only','base meta-training candidates are expanding OOF day-by-day','meta train <=Aug24','threshold/hyperparameter selection Aug25-26 only','Aug27-Sep4 untouched until final evaluation','first event ticker/day is action unit','no catalyst/SEC/network/future data in features'],
 'coverage':{'rows':len(data),'oofDays':used,'metaTrainEvents':len(meta_train),'metaTrainWinners':sum(bool(x['target']) for x in meta_train),'calEvents':len(meta_cal),'calWinners':sum(bool(x['target']) for x in meta_cal),'holdoutBaseEvents':len(hold_base),'holdoutBaseWinners':sum(bool(x['target']) for x in hold_base)},
 'selected':{'C':C,'preThreshold':tp,'regularThreshold':tr,'enabledSessions':enabled,'calibrationMetrics':calm,'calibrationWilsonLower90Pct':cal_lb,'calibrationActiveDays':cal_days},
 'holdout':{'v4BaseFirstEvent':base,'v47FirstEvent':vm,'precisionImprovementPp':round(pp,2),'bySession':by},
 'residualCoefficientDiagnostics':coef,
 'promotionRule':{'autoPromotion':False,'minHoldoutEvents':20,'minWinnerEvents':5,'mustImprovePrecisionByPp':2,'retainAtLeastHalfBaseTickerDayRecall':True,'noEnabledSessionZeroWinnerCollapse':True},
 'verdict':verdict
}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
