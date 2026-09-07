#!/usr/bin/env python3
"""TAGit v4.8 actionability meta model.

Changes the second-stage target from 'ever touches +10% within 60m' to a cleaner
operational outcome using the frozen v3.9 future labels:
  CLEAN_WINNER = target(+10%/60m) AND MAE >= -4%.
The model still receives only causal pre-event features. MFE/MAE are labels only.

Evaluation is first-event ticker/day. Base ranker candidates are generated OOF.
Meta train <= Aug24, calibration Aug25-26, untouched holdout Aug27-Sep4.
No live/Champion override.
"""
import json, math, pathlib, runpy
from datetime import datetime, timezone
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
data=G['data']; fit_score=G['fit_score']; enrich=G['enrich']; scode=G['scode']; first_events=G['first_events']; sha=G['sha']
OUT=pathlib.Path('tag/data/tagit-v48-actionability-meta-backtest.json')


def cand(xs):
    a=[x for x in xs if (scode(x['session'])==0 and x['gate']) or (scode(x['session'])==1 and x['gate'] and x['progression'])]
    return first_events(a)

def clean(x):
    try:return bool(x['target']) and float(x.get('maeGT')) >= -4.0
    except:return False

def hard_negative(x):
    try:return float(x.get('mfeGT')) < 5.0
    except:return not bool(x['target'])

def fv(x):
    e=float(x['ensemble']); d=float(x['disagreement']); p=float(x['persistence'])/100.; c=float(x['continuation'])/100.; h=float(x['marketHeat'])/100.; r=max(1,int(x['rank'])); st=min(5,float(x['streak']))/5.; ri=float(x['rankImprovement'])/20.; m=[float(v) for v in x['micro'][:4]]; s=scode(x['session'])
    return [e,d,1/r,p,c,h,float(bool(x['progression'])),st,ri,*m,e*(1-d),e*p,e*c,p*c,c*h,m[0]-m[1],m[1]-m[2],float(s==0),float(s==1)]

def fitm(xs,C):
    X=np.asarray([fv(x) for x in xs]); y=np.asarray([int(clean(x)) for x in xs])
    sc=StandardScaler().fit(X); md=LogisticRegression(C=C,class_weight='balanced',max_iter=1200,random_state=4801).fit(sc.transform(X),y); return sc,md

def score(model,xs):
    sc,md=model; ps=md.predict_proba(sc.transform(np.asarray([fv(x) for x in xs])))[:,1]
    return [{**x,'actionabilityProbability':float(p)} for x,p in zip(xs,ps)]

def met(xs,univ):
    n=len(xs); tp=sum(clean(x) for x in xs); rawtp=sum(bool(x['target']) for x in xs); total_clean=len({(x['day'],x['ticker']) for x in univ if clean(x)}); got=len({(x['day'],x['ticker']) for x in xs if clean(x)})
    return {'count':n,'cleanTp':tp,'rawPlus10Tp':rawtp,'cleanPrecisionPct':round(100*tp/n,2) if n else None,'rawPlus10PrecisionPct':round(100*rawtp/n,2) if n else None,'cleanTickerDayRecallPct':round(100*got/total_clean,2) if total_clean else None}

def wilson(tp,n,z=1.645):
    if n<=0:return 0
    p=tp/n; den=1+z*z/n; return max(0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)

# Base-ranker expanding OOF events.
oof=[]; used=[]
for d in sorted({x['day'] for x in data if x['day']<='2026-08-26'}):
    tr=[x for x in data if x['day']<d]; te=[x for x in data if x['day']==d]
    if len({x['day'] for x in tr})<4 or sum(bool(x['target']) for x in tr)<12 or not te:continue
    z=cand(enrich(fit_score(tr,te))); oof+=z; used.append(d)
train=[x for x in oof if x['day']<='2026-08-24']
cal=[x for x in oof if '2026-08-25'<=x['day']<='2026-08-26']
# Train on clear examples only; ambiguous +5..+10 or deep-drawdown winners are abstain labels, not forced negatives.
train_clear=[x for x in train if clean(x) or hard_negative(x)]
cal_clear=cal

Cs=(.03,.07,.15,.3,.6,1.0)
ths=(.35,.4,.45,.5,.55,.6,.65,.7,.75)
best=None
for C in Cs:
    if sum(clean(x) for x in train_clear)<5:continue
    model=fitm(train_clear,C); z=score(model,cal_clear)
    for th in ths:
        a=[x for x in z if x['actionabilityProbability']>=th]
        m=met(a,cal_clear); support=len(a)>=8 and m['cleanTp']>=2
        lb=wilson(m['cleanTp'],len(a)); recall=m['cleanTickerDayRecallPct'] or 0
        util=100*lb+.12*recall+.5*m['cleanTp'] if support else -1e6+m['cleanTp']
        row=(util,C,th,m,round(100*lb,2))
        if best is None or row[0]>best[0]:best=row
if best is None:raise RuntimeError('No v4.8 config')
_,C,th,calm,cal_lb=best

# Refit on all causal pre-holdout OOF clear examples.
all_clear=[x for x in oof if clean(x) or hard_negative(x)]
model=fitm(all_clear,C)
fit=[x for x in data if x['day']<='2026-08-26']; hold=[x for x in data if x['day']>='2026-08-27']
hbase=cand(enrich(fit_score(fit,hold))); hs=score(model,hbase); selected=[x for x in hs if x['actionabilityProbability']>=th]
base_m=met(hbase,hbase); v=met(selected,hbase)
by={}
for code,name in ((0,'pre'),(1,'regular')):
    u=[x for x in hbase if scode(x['session'])==code]; a=[x for x in selected if scode(x['session'])==code]; by[name]={'base':met(u,u),'v48':met(a,u)}
pp=(v['cleanPrecisionPct'] or 0)-(base_m['cleanPrecisionPct'] or 0); rec=(v['cleanTickerDayRecallPct'] or 0)>=.5*(base_m['cleanTickerDayRecallPct'] or 0); support=v['count']>=20 and v['cleanTp']>=5
verdict='V48_SHADOW_CANDIDATE' if pp>=3 and rec and support else 'DO_NOT_PROMOTE_V48'

sc,md=model; names=['ensemble','disagreement','inverseRank','persistence','continuation','marketHeat','progression','streak','rankImprovement','m5','m10','m30','m60','ensembleXagreement','ensembleXpersistence','ensembleXcontinuation','persistenceXcontinuation','continuationXheat','m5MinusM10','m10MinusM30','isPre','isRegular']
coefs=sorted([{'feature':n,'coefficient':round(float(c),5)} for n,c in zip(names,md.coef_[0])],key=lambda z:abs(z['coefficient']),reverse=True)
report={'schemaVersion':'4.8-research','method':'TAGIT_V48_ACTIONABILITY_META','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
'cleanTarget':'+10% within 60m AND MAE >= -4%; MFE/MAE labels never used as features','antiLeakage':['frozen v3.9 only','expanding OOF base candidates','meta train <=Aug24','calibration Aug25-26 only','Aug27-Sep4 untouched','MFE/MAE future values are labels only','first ticker/day event evaluation'],
'coverage':{'rows':len(data),'oofDays':used,'trainEvents':len(train),'trainClearEvents':len(train_clear),'trainCleanWinners':sum(clean(x) for x in train_clear),'calEvents':len(cal),'calCleanWinners':sum(clean(x) for x in cal),'holdoutBaseEvents':len(hbase),'holdoutBaseCleanWinners':sum(clean(x) for x in hbase)},
'selected':{'C':C,'threshold':th,'calibration':calm,'calibrationWilsonLower90Pct':cal_lb},'holdout':{'base':base_m,'v48':v,'cleanPrecisionImprovementPp':round(pp,2),'bySession':by},'coefficientDiagnostics':coefs,
'promotionRule':{'autoPromotion':False,'minHoldoutEvents':20,'minCleanWinners':5,'mustImproveCleanPrecisionByPp':3,'retainAtLeastHalfBaseCleanRecall':True},'verdict':verdict}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
