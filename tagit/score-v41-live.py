#!/usr/bin/env python3
"""TAGit v4.1 context-only forward research layer.

Historical validation showed event-conviction thresholds add only modest precision
and lose recall. Therefore v4.1 never surfaces an alert and never overrides v4 or
the champion. It records causal persistence/continuation plus catalyst/SEC context
so forward outcomes can determine whether those contexts deserve future weight.
"""
import json,math,pathlib
from datetime import datetime,timezone

V4=pathlib.Path('tag/data/tagit-v4-shadow.json')
SEC=pathlib.Path('tag/data/tagit-sec-event-shadow.json')
OUT=pathlib.Path('tag/data/tagit-v41-shadow.json')


def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def clamp(x,lo=0.,hi=100.):return max(lo,min(hi,float(x)))
def num(v,d=0.):
    try:
        x=float(v);return x if math.isfinite(x) else d
    except:return d

v4=read(V4,{});sec=read(SEC,{})
prev=read(OUT,{});prev_cache=prev.get('stateCache') or {}
sec_by={str(x.get('symbol') or '').upper():x for x in sec.get('items') or []}
asof=v4.get('updatedAt') or datetime.now(timezone.utc).isoformat();day=v4.get('tradingDateET');session=str(v4.get('session') or 'unknown').lower();active=session in ('pre-market','regular','after-hours');healthy=v4.get('status')=='PASS'
items=[];cache={}

for x in v4.get('items') or []:
    sym=str(x.get('symbol') or '').upper()
    if not sym:continue
    gate=bool(x.get('shadowGatePassed'));progression=bool(x.get('progressionSeen'));rank=int(x.get('rank') or 999);rank_score=clamp(num(x.get('rankScorePct')));dis=clamp(num(x.get('modelDisagreement'))*100);m5=num(x.get('momentum5mPct'));m10=num(x.get('momentum10mPct'))
    pc=prev_cache.get(sym) or {};same=pc.get('tradingDateET')==day
    streak=(int(pc.get('selectedStreak') or 0)+1) if same and gate and active else (1 if gate and active else 0);prev_rank=int(pc.get('rank') or rank) if same else rank;ri=max(-20,min(20,prev_rank-rank))
    persistence=clamp((20 if gate else 0)+min(40,streak*12)+(22 if progression else 0)+(min(10,ri*2) if ri>0 else 0)+(8 if dis<=18 else 0))
    continuation=clamp(50+max(-22,min(22,m5*3))+max(-16,min(16,m10*1.6))+(14 if progression else 0)+(min(8,ri*1.5) if ri>0 else 0))
    # Robust pre-market OOF blend from v4.3, without catalyst/SEC weights.
    core=clamp(rank_score*.45+persistence*.35+continuation*.20)
    cat=x.get('catalystContext') or {};sx=sec_by.get(sym) or {};sec_risk=sx.get('riskFlags') or [];sec_events=sx.get('eventTypes') or []
    research_candidate=bool(active and healthy and gate and ((session=='pre-market' and core>=55) or (session=='regular' and progression and streak>=2 and core>=70)))
    if not active:state='CLOSED'
    elif not healthy:state='BLOCKED_DATA'
    elif session=='after-hours':state='INFORMATIONAL'
    elif research_candidate:state='V41_RESEARCH_CANDIDATE'
    elif gate:state='V41_DISCOVER'
    else:state='ABSTAIN'
    context_veto=bool(any('BANKRUPTCY' in z or 'DILUTION' in z or 'LISTING' in z for z in sec_risk))
    reason=[f'Rank #{rank} ({rank_score:.1f})']
    if streak>1:reason.append(f'Persistent {streak}x')
    if progression:reason.append('Progression confirmed')
    if m5>0:reason.append(f'5m +{m5:.1f}%')
    if cat.get('catalystType') and cat.get('catalystType')!='NONE':reason.append('Catalyst:'+str(cat.get('catalystType')))
    if sec_events:reason.append('SEC:'+','.join(sec_events[:2]))
    if sec_risk:reason.append('SEC risk context')
    items.append({'symbol':sym,'v41State':state,'surfaceEligible':False,'researchCandidate':research_candidate,'rank':rank,'rankScorePct':round(rank_score,2),'eventConvictionCore':round(core,2),'persistenceScore':round(persistence,2),'continuationScore':round(continuation,2),'selectedStreak':streak,'progressionSeen':progression,'modelDisagreementPct':round(dis,2),'momentum5mPct':round(m5,2),'momentum10mPct':round(m10,2),'catalystContext':cat or None,'secEventContext':{'latestForm':sx.get('latestForm'),'latestAcceptedAt':sx.get('latestAcceptedAt'),'eventTypes':sec_events,'riskFlags':sec_risk,'freshWithin72h':bool(sx.get('freshWithin72h'))} if sx else None,'contextVetoSuggestedForFutureStudy':context_veto,'eventPolicy':'CONTEXT_ONLY_FORWARD_RESEARCH_NO_ALERT_OVERRIDE','executionVerified':False,'scoreMeaning':'CORE_CONVICTION_NOT_CALIBRATED_SUCCESS_PROBABILITY','reason':' • '.join(reason)})
    cache[sym]={'tradingDateET':day,'rank':rank,'rankScorePct':rank_score,'selectedStreak':streak,'state':state}

items.sort(key=lambda z:(z['researchCandidate'],z['eventConvictionCore'],z['rankScorePct']),reverse=True)
payload={'schemaVersion':'4.1-forward','source':'TAGit v4.1 context-only forward research','updatedAt':asof,'tradingDateET':day,'status':'PASS' if healthy else 'DEGRADED','session':session,'policy':'SHADOW_CONTEXT_ONLY_NO_ALERT_OVERRIDE','championUnaffected':True,'v4Unaffected':True,'executionVerified':False,'surfacePolicy':'DISABLED_PENDING_FORWARD_EVIDENCE','scoreMeaning':'CORE_CONVICTION_NOT_CALIBRATED_SUCCESS_PROBABILITY','historicalEvidence':{'v41HoldoutFirstEventPrecisionPct':12.5,'v4HoldoutFirstEventPrecisionPct':10.87,'v41TickerDayRecallPct':17.65,'reasonNotPromoted':'MODEST_PRECISION_GAIN_WITH_LARGE_RECALL_LOSS'},'counts':{'total':len(items),'researchCandidates':sum(i['researchCandidate'] for i in items),'discover':sum(i['v41State']=='V41_DISCOVER' for i in items),'informational':sum(i['v41State']=='INFORMATIONAL' for i in items),'surfaceEligible':0},'items':items[:100],'stateCache':cache}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in payload.items() if k not in ('items','stateCache')},ensure_ascii=False,indent=2))
