#!/usr/bin/env python3
"""TAGit v4.6 orthogonal-evidence quorum policy.

Keeps the validated v4/live21 ranker unchanged.  The policy layer only asks whether
several independent causal evidence families agree at the FIRST event:
  rank/model strength, persistence/progression, continuation, and snapshot regime.
Policy selection uses expanding pre-holdout OOF days only. Aug27-Sep4 is untouched.
No catalyst backfill and no SEC data are used here; those remain separate context.
"""
import json, math, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
data=G['data']; fit_score=G['fit_score']; enrich=G['enrich']; scode=G['scode']; metrics=G['metrics']; first_events=G['first_events']; sha=G['sha']
OUT=pathlib.Path('tag/data/tagit-v46-orthogonal-quorum-backtest.json')


def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    p=tp/n; den=1+z*z/n; center=p+z*z/(2*n)
    adj=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)
    return max(0.0,(center-adj)/den)

def active_days(xs): return len({x['day'] for x in xs})

def base_events(xs,session_code):
    if session_code==0:
        a=[x for x in xs if scode(x['session'])==0 and x['gate']]
    elif session_code==1:
        a=[x for x in xs if scode(x['session'])==1 and x['gate'] and x['progression']]
    else:a=[]
    return first_events(a)

def evidence(x,cfg):
    rank_ok=(x['rank']<=cfg['maxRank'] and x['ensemble']>=cfg['minEnsemble'] and x['disagreement']<=cfg['maxDisagreement'])
    persist_ok=(x['persistence']>=cfg['minPersistence'] and (x['progression'] or x['streak']>=cfg['minStreak']))
    cont_ok=(x['continuation']>=cfg['minContinuation'] and x['micro'][0]>=cfg['minM5'])
    regime_ok=(x['marketHeat']>=cfg['minHeat'])
    votes=int(rank_ok)+int(persist_ok)+int(cont_ok)+int(regime_ok)
    return votes,{'rank':rank_ok,'persistence':persist_ok,'continuation':cont_ok,'regime':regime_ok}

def apply(xs,cfg,session_code):
    out=[]
    for x in xs:
        if scode(x['session'])!=session_code or not x['gate']:continue
        votes,ev=evidence(x,cfg)
        if votes>=cfg['quorum']:
            out.append({**x,'evidenceVotes':votes,'evidenceFamilies':ev})
    return first_events(out)

# expanding OOF: every scoring day is trained only on earlier dates
prehold=sorted({x['day'] for x in data if x['day']<='2026-08-26'})
oof=[]; used=[]
for d in prehold:
    tr=[x for x in data if x['day']<d]; te=[x for x in data if x['day']==d]
    if len({x['day'] for x in tr})<4 or sum(bool(x['target']) for x in tr)<12 or not te:continue
    z=enrich(fit_score(tr,te)); oof.extend(z); used.append(d)

fit=[x for x in data if x['day']<='2026-08-26']; hold=[x for x in data if x['day']>='2026-08-27']
hp=enrich(fit_score(fit,hold))

# Small, interpretable policy grid.  No arbitrary score blending.
configs=[]
for mr in (10,15,20):
 for me in (.50,.60,.70):
  for mp in (25,40,55):
   for mc in (50,60,70):
    for mh in (0,40,55):
     for q in (2,3,4):
      configs.append({'maxRank':mr,'minEnsemble':me,'maxDisagreement':.40,'minPersistence':mp,'minStreak':2,'minContinuation':mc,'minM5':0.0,'minHeat':mh,'quorum':q})

def choose(session_code):
    u=[x for x in oof if scode(x['session'])==session_code]
    b=base_events(oof,session_code); bm=metrics(b,u)
    rows=[]
    for cfg in configs:
        a=apply(oof,cfg,session_code); m=metrics(a,u); days=active_days(a); lb=wilson(m['tp'],m['count'])
        support=(m['count']>=30 and m['tp']>=5 and days>=5)
        # Precision confidence first, but do not destroy all winner coverage.
        recall=m['recallTickerDayPct'] or 0
        utility=(100*lb)+(0.12*recall)+(0.35*m['tp']) if support else -1e6 + m['tp']
        rows.append((utility,cfg,m,round(100*lb,2),days))
    valid=[r for r in rows if r[0]>-1e5]
    best=max(valid if valid else rows,key=lambda z:z[0])
    # Session is actionable only when OOF evidence beats base precision by >=2pp,
    # has useful support, and retains >=40% of base ticker-day recall.
    pp=(best[2]['precisionPct'] or 0)-(bm['precisionPct'] or 0)
    retain=(best[2]['recallTickerDayPct'] or 0)>=.40*(bm['recallTickerDayPct'] or 0)
    enabled=(best[2]['count']>=30 and best[2]['tp']>=5 and best[4]>=5 and pp>=2 and retain)
    return {'enabled':enabled,'config':best[1],'oofMetrics':best[2],'wilsonLower90Pct':best[3],'activeDays':best[4],'baseOofMetrics':bm,'precisionImprovementPp':round(pp,2),'recallRetentionPass':retain}

pre=choose(0); reg=choose(1)

def evaluate(session_code,choice):
    u=[x for x in hp if scode(x['session'])==session_code]
    b=base_events(hp,session_code); bm=metrics(b,u)
    if not choice['enabled']:
        return {'enabled':False,'base':bm,'selected':{'count':0,'tp':0,'precisionPct':None,'recallObsPct':0.0,'tickerDays':0,'winnerTickerDays':0,'recallTickerDayPct':0.0}}
    a=apply(hp,choice['config'],session_code)
    return {'enabled':True,'base':bm,'selected':metrics(a,u),'events':a}

pe=evaluate(0,pre); re=evaluate(1,reg)
selected=[]
if pe['enabled']:selected+=pe.pop('events')
if re['enabled']:selected+=re.pop('events')
hold_first=first_events(selected)
hold_metrics=metrics(hold_first,hp)
base_all=first_events(base_events(hp,0)+base_events(hp,1)); base_metrics=metrics(base_all,hp)

report={
 'schemaVersion':'4.6-research','method':'TAGIT_V46_ORTHOGONAL_EVIDENCE_QUORUM','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
 'antiLeakage':['frozen v3.9 dataset only','expanding OOF policy selection uses only earlier-day model fits','Aug27-Sep4 untouched until final evaluation','snapshot regime uses same-snapshot causal features only','persistence/continuation use current and prior same ticker/day observations only','no catalyst/SEC/future data in model or policy'],
 'oofDays':used,'coverage':{'rows':len(data),'oofRows':len(oof),'holdoutRows':len(hold),'holdoutPositives':sum(bool(x['target']) for x in hold)},
 'selectedPolicies':{'pre':pre,'regular':reg,'after':{'enabled':False,'reason':'INFORMATIONAL_ONLY'}},
 'holdout':{'v4BaseFirstEvent':base_metrics,'v46FirstEvent':hold_metrics,'bySession':{'pre':pe,'regular':re}},
 'promotionRule':{'autoPromotion':False,'minHoldoutEvents':20,'minWinnerEvents':5,'mustImprovePrecisionByPp':2,'retainAtLeastHalfBaseTickerDayRecall':True,'noEnabledSessionZeroWinnerCollapse':True},
 'verdict':None
}
b=base_metrics; v=hold_metrics; pp=(v['precisionPct'] or 0)-(b['precisionPct'] or 0)
rec=(v['recallTickerDayPct'] or 0)>=.5*(b['recallTickerDayPct'] or 0); support=v['count']>=20 and v['tp']>=5
zero_collapse=all((not z['enabled']) or ((z['selected']['tp'] or 0)>0) for z in (pe,re))
report['verdict']='V46_SHADOW_CANDIDATE' if pp>=2 and rec and support and zero_collapse else 'DO_NOT_PROMOTE_V46'
OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
