#!/usr/bin/env python3
"""TAGit v4.1 shadow policy layer.

Builds a research-only event-conviction layer on top of the frozen v4 live21
ranker. It does not alter the champion, does not claim calibrated probability,
and never verifies execution. It adds persistence/continuation/catalyst context
using only information available at or before the current snapshot.
"""
import json, math, pathlib
from datetime import datetime, timezone

V4=pathlib.Path('tag/data/tagit-v4-shadow.json')
OUT=pathlib.Path('tag/data/tagit-v41-shadow.json')


def read(p, default):
    try: return json.loads(p.read_text())
    except Exception: return default

def clamp(x, lo=0.0, hi=100.0): return max(lo, min(hi, float(x)))
def num(v, d=0.0):
    try:
        x=float(v)
        return x if math.isfinite(x) else d
    except Exception:return d

v4=read(V4,{})
prev=read(OUT,{})
asof=v4.get('updatedAt') or datetime.now(timezone.utc).isoformat()
day=v4.get('tradingDateET')
session=str(v4.get('session') or 'unknown').lower()
active=session in ('pre-market','regular','after-hours')
healthy=v4.get('status')=='PASS'
prev_cache=prev.get('stateCache') or {}
items=[];cache={}

for x in v4.get('items') or []:
    sym=str(x.get('symbol') or '').upper()
    if not sym: continue
    gate=bool(x.get('shadowGatePassed'))
    progression=bool(x.get('progressionSeen'))
    rank=int(x.get('rank') or 999)
    rank_score=clamp(num(x.get('rankScorePct')))
    disagreement=clamp(num(x.get('modelDisagreement'))*100)
    m5=num(x.get('momentum5mPct'));m10=num(x.get('momentum10mPct'))
    pc=prev_cache.get(sym) or {}
    same=pc.get('tradingDateET')==day
    streak=(int(pc.get('selectedStreak') or 0)+1) if same and gate and active else (1 if gate and active else 0)
    prev_rank=int(pc.get('rank') or rank) if same else rank
    rank_improvement=max(-20,min(20,prev_rank-rank))

    persistence=0.0
    if gate:persistence+=20
    persistence+=min(40,streak*12)
    if progression:persistence+=22
    if rank_improvement>0:persistence+=min(10,rank_improvement*2)
    if disagreement<=18:persistence+=8
    persistence=clamp(persistence)

    continuation=50.0
    continuation+=max(-22,min(22,m5*3.0))
    continuation+=max(-16,min(16,m10*1.6))
    if progression:continuation+=14
    if rank_improvement>0:continuation+=min(8,rank_improvement*1.5)
    continuation=clamp(continuation)

    cat=x.get('catalystContext') or {}
    materiality=clamp(num(cat.get('catalystMateriality'))*100)
    confidence=clamp(num(cat.get('catalystConfidence'))*100)
    catalyst_quality=(materiality*.6+confidence*.4) if cat else 0.0
    risk=x.get('riskContext') or []
    risk_penalty=8.0 if 'RECENT_DILUTION_FILING' in risk else 0.0

    conviction=clamp(rank_score*.45+persistence*.25+continuation*.20+catalyst_quality*.10-risk_penalty)
    if not active:state='CLOSED'
    elif not healthy:state='BLOCKED_DATA'
    elif session=='after-hours':state='INFORMATIONAL'
    elif session=='pre-market' and gate and conviction>=60:state='V41_ALERT'
    elif session=='regular' and gate and progression and persistence>=40 and conviction>=62:state='V41_ALERT'
    elif gate:state='V41_DISCOVER'
    else:state='ABSTAIN'
    surface=state=='V41_ALERT'

    reason=[]
    reason.append(f'Rank #{rank} ({rank_score:.1f})')
    if streak>1:reason.append(f'Persistent {streak}x')
    if progression:reason.append('Progression confirmed')
    if m5>0:reason.append(f'5m +{m5:.1f}%')
    if cat.get('catalystType') and cat.get('catalystType')!='NONE':reason.append(str(cat.get('catalystType')))
    if risk_penalty:reason.append('Dilution risk context')

    item={
        'symbol':sym,'v41State':state,'surfaceEligible':surface,'rank':rank,
        'rankScorePct':round(rank_score,2),'eventConviction':round(conviction,2),
        'persistenceScore':round(persistence,2),'continuationScore':round(continuation,2),
        'selectedStreak':streak,'progressionSeen':progression,'modelDisagreementPct':round(disagreement,2),
        'momentum5mPct':round(m5,2),'momentum10mPct':round(m10,2),
        'catalystQuality':round(catalyst_quality,2),'catalystContext':cat or None,'riskContext':risk or None,
        'eventPolicy':'RESEARCH_ONLY_SHADOW_NO_CHAMPION_OVERRIDE','executionVerified':False,
        'scoreMeaning':'EVENT_CONVICTION_COMPOSITE_NOT_CALIBRATED_SUCCESS_PROBABILITY',
        'reason':' • '.join(reason)
    }
    items.append(item)
    cache[sym]={'tradingDateET':day,'rank':rank,'rankScorePct':rank_score,'selectedStreak':streak,'state':state}

items.sort(key=lambda z:(z['surfaceEligible'],z['eventConviction'],z['rankScorePct']),reverse=True)
payload={
    'schemaVersion':'4.1','source':'TAGit v4.1 event-conviction shadow layer','updatedAt':asof,'tradingDateET':day,
    'status':'PASS' if healthy else 'DEGRADED','session':session,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE',
    'championUnaffected':True,'executionVerified':False,
    'scoreMeaning':'EVENT_CONVICTION_COMPOSITE_NOT_CALIBRATED_SUCCESS_PROBABILITY',
    'thresholds':{'preMarketAlertConviction':60,'regularAlertConviction':62,'regularMinPersistence':40,'afterHours':'INFORMATIONAL_ONLY'},
    'counts':{'total':len(items),'alerts':sum(i['v41State']=='V41_ALERT' for i in items),'discover':sum(i['v41State']=='V41_DISCOVER' for i in items),'informational':sum(i['v41State']=='INFORMATIONAL' for i in items)},
    'items':items[:100],'stateCache':cache
}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in payload.items() if k not in ('items','stateCache')},ensure_ascii=False,indent=2))
