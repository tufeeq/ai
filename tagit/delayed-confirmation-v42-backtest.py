#!/usr/bin/env python3
"""TAGit v4.2: session-specific delayed-confirmation policy on frozen v3.9.

Premarket is allowed to surface the first high-conviction event. Regular-session
alerts are deliberately delayed until persistence/progression survive additional
snapshots. After-hours stays informational. All policy choices use Aug25-26 only;
Aug27-Sep4 is untouched holdout.
"""
import json,pathlib,runpy
from datetime import datetime,timezone

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
cp,hp=G['cp'],G['hp'];scode=G['scode'];clamp=G['clamp'];metrics=G['metrics'];first_events=G['first_events'];BASE_GATE=G['BASE_GATE'];apply_v41=G['apply_policy'];cfg41=G['cfg']
OUT=pathlib.Path('tag/data/tagit-v42-delayed-confirmation-backtest.json')

WEIGHTS=[(.55,.25,.20),(.50,.30,.20),(.45,.35,.20),(.50,.25,.25)]

def conviction(x,w):return clamp(w[0]*(x['ensemble']*100)+w[1]*x['persistence']+w[2]*x['continuation'])
def apply_pre(xs,c):
    return [{**x,'eventConvictionV42':conviction(x,c['weights'])} for x in xs if scode(x['session'])==0 and x['gate'] and conviction(x,c['weights'])>=c['threshold'] and x['rank']<=c['maxRank']]
def apply_reg(xs,c):
    out=[]
    for x in xs:
        if scode(x['session'])!=1 or not x['gate'] or not x['progression']:continue
        cv=conviction(x,c['weights'])
        if x['streak']<c['minStreak'] or x['persistence']<c['minPersistence'] or x['rank']>c['maxRank'] or x['rankImprovement']<c['minRankImprovement'] or cv<c['threshold']:continue
        out.append({**x,'eventConvictionV42':cv})
    return out

def choose_pre(xs):
    cands=[]
    u=[x for x in xs if scode(x['session'])==0]
    for w in WEIGHTS:
      for th in (50,55,60,65,70,75):
       for mr in (5,10,15,20):
        c={'weights':w,'threshold':th,'maxRank':mr};a=first_events(apply_pre(xs,c));m=metrics(a,u);p=m['precisionPct'] or 0;r=m['recallTickerDayPct'] or 0
        support=min(1,m['count']/10)*min(1,m['tp']/3);util=p*support+r*.18+m['tp']*1.5
        cands.append((util,c,m))
    return max(cands,key=lambda z:z[0])
def choose_reg(xs):
    cands=[];u=[x for x in xs if scode(x['session'])==1]
    for w in WEIGHTS:
      for th in (50,55,60,65,70,75,80):
       for st in (2,3,4):
        for ps in (30,40,50,60,70):
         for mr in (5,10,15,20):
          for ri in (-8,-4,0):
           c={'weights':w,'threshold':th,'minStreak':st,'minPersistence':ps,'maxRank':mr,'minRankImprovement':ri};a=first_events(apply_reg(xs,c));m=metrics(a,u);p=m['precisionPct'] or 0;r=m['recallTickerDayPct'] or 0
           support=min(1,m['count']/8)*min(1,m['tp']/2);util=p*support+r*.15+m['tp']*1.8
           cands.append((util,c,m))
    return max(cands,key=lambda z:z[0])

bp=choose_pre(cp);br=choose_reg(cp);preCfg=bp[1];regCfg=br[1]
calA=apply_pre(cp,preCfg)+apply_reg(cp,regCfg);holdA=apply_pre(hp,preCfg)+apply_reg(hp,regCfg)
calE=first_events(calA);holdE=first_events(holdA)
baseCal=G['base_v4'](cp);baseHold=G['base_v4'](hp);v41Cal=apply_v41(cp,cfg41);v41Hold=apply_v41(hp,cfg41)

def sess(xs,univ):
    d={}
    for code,name in ((0,'pre'),(1,'regular'),(2,'after')):
        u=[x for x in univ if scode(x['session'])==code];a=[x for x in xs if scode(x['session'])==code]
        d[name]={'observation':metrics(a,u),'firstEvent':metrics(first_events(a),u)}
    return d

report={
 'schemaVersion':'4.2-research','method':'TAGIT_V42_SESSION_DELAYED_CONFIRMATION','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':G['sha'],
 'antiLeakage':['inherits frozen v4.1 causal ranker and state construction','premarket/regular policies selected on Aug25-26 only','Aug27-Sep4 untouched holdout','after-hours never alerts','no catalyst or market-heat dependency'],
 'coverage':G['report']['coverage'],'baseGate':BASE_GATE,
 'selectedPolicies':{'pre':preCfg,'regular':regCfg,'after':'INFORMATIONAL_ONLY'},
 'calibration':{'v4FirstEvent':metrics(first_events(baseCal),cp),'v41FirstEvent':metrics(first_events(v41Cal),cp),'v42FirstEvent':metrics(calE,cp),'v42BySession':sess(calA,cp)},
 'holdout':{'v4FirstEvent':metrics(first_events(baseHold),hp),'v41FirstEvent':metrics(first_events(v41Hold),hp),'v42FirstEvent':metrics(holdE,hp),'v42Observation':metrics(holdA,hp),'v42BySession':sess(holdA,hp)},
 'promotionRule':{'autoPromotion':False,'minFirstEvents':12,'minWinnerEvents':4,'mustBeatV4FirstEventPrecision':True,'mustNotLoseMoreThanHalfV4TickerDayRecall':True},
 'verdict':None
}
v4=report['holdout']['v4FirstEvent'];v42=report['holdout']['v42FirstEvent']
passp=(v42['precisionPct'] or 0)>(v4['precisionPct'] or 0);support=v42['count']>=12 and v42['tp']>=4;rec=(v42['recallTickerDayPct'] or 0)>=.5*(v4['recallTickerDayPct'] or 0)
report['verdict']='V42_SHADOW_CANDIDATE' if passp and support and rec else 'DO_NOT_PROMOTE_V42'
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
