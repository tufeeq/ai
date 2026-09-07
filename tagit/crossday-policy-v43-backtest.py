#!/usr/bin/env python3
"""TAGit v4.3 cross-day policy calibration.

Fixes the main v4.2 weakness: policy thresholds were selected from only Aug25-26.
Here, the ranker is scored expanding-walk-forward across multiple pre-holdout days.
Session policy is selected from those out-of-fold predictions using Wilson lower-bound
precision and support constraints. Aug27-Sep4 remains untouched until final evaluation.
"""
import json,math,pathlib,runpy
from datetime import datetime,timezone

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
data=G['data'];fit_score=G['fit_score'];enrich=G['enrich'];scode=G['scode'];clamp=G['clamp'];metrics=G['metrics'];first_events=G['first_events'];base_v4=G['base_v4'];sha=G['sha']
OUT=pathlib.Path('tag/data/tagit-v43-crossday-policy-backtest.json')

WEIGHTS=[(.55,.25,.20),(.50,.30,.20),(.45,.35,.20),(.50,.25,.25)]
def conv(x,w):return clamp(w[0]*(x['ensemble']*100)+w[1]*x['persistence']+w[2]*x['continuation'])
def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    p=tp/n;den=1+z*z/n;center=p+z*z/(2*n);adj=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)
    return max(0,(center-adj)/den)
def active_days(a):return len({x['day'] for x in a})

def apply_pre(xs,c):
    if c.get('mode')=='BASE':return [x for x in xs if scode(x['session'])==0 and x['gate']]
    return [{**x,'v43Conviction':conv(x,c['weights'])} for x in xs if scode(x['session'])==0 and x['gate'] and x['rank']<=c['maxRank'] and conv(x,c['weights'])>=c['threshold']]
def apply_reg(xs,c):
    if c.get('enabled') is False:return []
    if c.get('mode')=='BASE':return [x for x in xs if scode(x['session'])==1 and x['gate'] and x['progression']]
    out=[]
    for x in xs:
        if scode(x['session'])!=1 or not x['gate'] or not x['progression']:continue
        cv=conv(x,c['weights'])
        if x['streak']<c['minStreak'] or x['persistence']<c['minPersistence'] or x['rank']>c['maxRank'] or x['rankImprovement']<c['minRankImprovement'] or cv<c['threshold']:continue
        out.append({**x,'v43Conviction':cv})
    return out

def score_candidate(a,u):
    e=first_events(a);m=metrics(e,u);lb=wilson(m['tp'],m['count']);support=min(1,m['count']/18)*min(1,m['tp']/4)
    util=lb*100*support+(m['recallTickerDayPct'] or 0)*.12+m['tp']*1.4+active_days(e)*.25
    return util,m,lb,e

def choose_pre(oof):
    u=[x for x in oof if scode(x['session'])==0];base=apply_pre(oof,{'mode':'BASE'});bu,bm,blb,be=score_candidate(base,u)
    best=(bu,{'mode':'BASE'},bm,blb)
    for w in WEIGHTS:
      for th in (50,55,60,65,70,75):
       for mr in (5,10,15,20):
        c={'mode':'CONVICTION','weights':w,'threshold':th,'maxRank':mr};a=apply_pre(oof,c);u0,m,lb,_=score_candidate(a,u)
        cand=(u0,c,m,lb)
        if cand[0]>best[0]:best=cand
    # Do not replace base unless there is genuine support and precision improvement.
    if best[1].get('mode')!='BASE':
        if best[2]['count']<12 or best[2]['tp']<3 or (best[2]['precisionPct'] or 0)<(bm['precisionPct'] or 0):
            return {'selected':{'mode':'BASE'},'selectedMetrics':bm,'selectedWilson':blb,'baseMetrics':bm,'baseWilson':blb}
    return {'selected':best[1],'selectedMetrics':best[2],'selectedWilson':best[3],'baseMetrics':bm,'baseWilson':blb}
def choose_reg(oof):
    u=[x for x in oof if scode(x['session'])==1];base=apply_reg(oof,{'mode':'BASE'});_,bm,blb,_=score_candidate(base,u);best=None
    for w in WEIGHTS:
      for th in (55,60,65,70,75,80):
       for st in (2,3,4):
        for ps in (30,40,50,60,70):
         for mr in (5,10,15,20):
          for ri in (-8,-4,0):
           c={'enabled':True,'mode':'DELAYED','weights':w,'threshold':th,'minStreak':st,'minPersistence':ps,'maxRank':mr,'minRankImprovement':ri};a=apply_reg(oof,c);u0,m,lb,_=score_candidate(a,u);cand=(u0,c,m,lb)
           if best is None or cand[0]>best[0]:best=cand
    # Regular is disabled unless multi-day OOF evidence beats the base with real support.
    if best is None or best[2]['count']<12 or best[2]['tp']<3 or (best[2]['precisionPct'] or 0)<(bm['precisionPct'] or 0)+2 or best[3]<=blb:
        return {'selected':{'enabled':False,'reason':'INSUFFICIENT_CROSSDAY_EVIDENCE'},'selectedMetrics':metrics([],u),'selectedWilson':0.0,'baseMetrics':bm,'baseWilson':blb,'bestAttempt':best[2] if best else None}
    return {'selected':best[1],'selectedMetrics':best[2],'selectedWilson':best[3],'baseMetrics':bm,'baseWilson':blb,'bestAttempt':best[2]}

prehold=sorted({x['day'] for x in data if x['day']<='2026-08-26'});oof=[];used=[]
for i,d in enumerate(prehold):
    tr=[x for x in data if x['day']<d];te=[x for x in data if x['day']==d]
    if len({x['day'] for x in tr})<4 or sum(bool(x['target']) for x in tr)<12 or not te:continue
    oof.extend(enrich(fit_score(tr,te)));used.append(d)
assert len(used)>=4 and len(oof)>0
preSel=choose_pre(oof);regSel=choose_reg(oof)

hold=[x for x in data if x['day']>='2026-08-27'];fit=[x for x in data if x['day']<='2026-08-26'];hp=enrich(fit_score(fit,hold))
oofA=apply_pre(oof,preSel['selected'])+apply_reg(oof,regSel['selected']);holdA=apply_pre(hp,preSel['selected'])+apply_reg(hp,regSel['selected'])
baseOOF=base_v4(oof);baseHold=base_v4(hp)

def sess(a,u):
    d={}
    for code,name in ((0,'pre'),(1,'regular'),(2,'after')):
        uu=[x for x in u if scode(x['session'])==code];aa=[x for x in a if scode(x['session'])==code]
        d[name]={'observation':metrics(aa,uu),'firstEvent':metrics(first_events(aa),uu)}
    return d

report={
 'schemaVersion':'4.3-research','method':'TAGIT_V43_EXPANDING_CROSSDAY_POLICY_CALIBRATION','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
 'antiLeakage':['frozen v3.9 dataset only','policy inputs are expanding walk-forward out-of-fold predictions from days before Aug27','each OOF day is scored by a model trained only on earlier days','Aug27-Sep4 untouched until final evaluation','after-hours disabled','regular may be disabled if cross-day evidence is insufficient'],
 'oofDays':used,'oofRows':len(oof),'holdoutRows':len(hp),'holdoutPositives':sum(bool(x['target']) for x in hp),
 'selectedPolicies':{'pre':preSel,'regular':regSel,'after':{'enabled':False}},
 'oof':{'v4FirstEvent':metrics(first_events(baseOOF),oof),'v43FirstEvent':metrics(first_events(oofA),oof),'v43BySession':sess(oofA,oof)},
 'holdout':{'v4FirstEvent':metrics(first_events(baseHold),hp),'v43FirstEvent':metrics(first_events(holdA),hp),'v43Observation':metrics(holdA,hp),'v43BySession':sess(holdA,hp)},
 'promotionRule':{'autoPromotion':False,'minFirstEvents':20,'minWinnerEvents':4,'precisionImprovementPp':2,'retainAtLeastHalfV4TickerDayRecall':True,'noEnabledSessionZeroWinnerCollapse':True},
 'verdict':None
}
v4=report['holdout']['v4FirstEvent'];v43=report['holdout']['v43FirstEvent'];pp=(v43['precisionPct'] or 0)-(v4['precisionPct'] or 0);rec=(v43['recallTickerDayPct'] or 0)>=.5*(v4['recallTickerDayPct'] or 0);support=v43['count']>=20 and v43['tp']>=4
collapse=False
for name in ('pre','regular'):
    enabled=(name=='pre') or bool(regSel['selected'].get('enabled',False))
    sm=report['holdout']['v43BySession'][name]['firstEvent']
    if enabled and sm['count']>=5 and sm['tp']==0:collapse=True
report['verdict']='V43_SHADOW_CANDIDATE' if pp>=2 and rec and support and not collapse else 'DO_NOT_PROMOTE_V43'
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
