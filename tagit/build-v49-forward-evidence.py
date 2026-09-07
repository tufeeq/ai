#!/usr/bin/env python3
"""TAGit v4.9 immutable forward evidence store.

Purpose
-------
Persist ONE evidence record for the first v4 surface event per ticker/trading-day.
Evidence is frozen exactly as observed at that event. Later runs may update outcome
fields only; they never rewrite the original evidence block.

Causality rules
---------------
* Source of first-event evidence is tagit-shadow-learning-ledger, whose catalyst and
  SEC context are attached only to the current observation at collection time.
* Catalyst title publication time is not reliably available in the current Finviz
  contract, so freshness is NEVER fabricated. We record OBSERVED_AT_EVENT and
  published-time status UNKNOWN unless a causal timestamp is actually present.
* SEC evidence is accepted only when latestAcceptedAt <= event timestamp. Otherwise
  SEC fields are frozen as UNKNOWN/NOT_CAUSAL_AT_EVENT.
* Outcomes come only from the independent v4 follower and can mature later.
* No field in this store changes Champion or v4 rank decisions.
"""
import json, math, pathlib
from datetime import datetime, timezone

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
OUT=pathlib.Path('tag/data/tagit-v49-forward-evidence.json')
SUMMARY=pathlib.Path('tag/data/tagit-v49-evidence-summary.json')
POLICY='SHADOW_EVIDENCE_ONLY_NO_CHAMPION_OVERRIDE'


def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def parse_dt(v):
    try:
        z=datetime.fromisoformat(str(v).replace('Z','+00:00'))
        return z if z.tzinfo else z.replace(tzinfo=timezone.utc)
    except:return None

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def b(v): return bool(v)

def classify_materiality(v):
    if not finite(v):return 'UNKNOWN'
    x=float(v)
    if x>=.85:return 'VERY_HIGH'
    if x>=.70:return 'HIGH'
    if x>=.45:return 'MEDIUM'
    return 'LOW'

def sec_risk_level(flags,event_types):
    f={str(x).upper() for x in (flags or [])}; e={str(x).upper() for x in (event_types or [])}
    severe=('GOING_CONCERN','BANKRUPTCY','DEFAULT','DELISTING','TRADING_SUSPENSION','SEC_SUSPENSION')
    elevated=('ATM','OFFERING','REGISTERED_DIRECT','PRIVATE_PLACEMENT','WARRANT','CONVERTIBLE','REVERSE_SPLIT','DILUTION')
    if any(any(k in x for k in severe) for x in f|e):return 'HIGH'
    if any(any(k in x for k in elevated) for x in f|e):return 'ELEVATED'
    if f:return 'CONTEXT'
    return 'NONE'

def build_evidence(r):
    ts=r.get('v4FirstSurfaceAt') or r.get('timestamp'); event_dt=parse_dt(ts)
    cat_type=r.get('catalystTypeV2') or r.get('catalystClass') or 'NONE'
    cat_present=cat_type not in (None,'','NONE') or bool(r.get('hasFreshNewsField'))
    # No reliable publication timestamp in current Finviz derived contract.
    catalyst={
      'observedAtEvent':bool(cat_present),
      'type':cat_type if cat_present else 'NONE',
      'polarity':r.get('catalystPolarity') if cat_present else 'UNKNOWN',
      'materiality':r.get('catalystMateriality') if cat_present else 0.0,
      'materialityBand':classify_materiality(r.get('catalystMateriality')) if cat_present else 'NONE',
      'confidence':r.get('catalystConfidence') if cat_present else None,
      'strengthShadow':r.get('catalystStrengthShadow') if cat_present else None,
      'authority':r.get('catalystAuthority') if cat_present else None,
      'publicationTimeStatus':'UNKNOWN_PUBLISHED_TIME',
      'freshnessMin':None,
      'causalUsePolicy':'OBSERVED_AT_EVENT_CONTEXT_ONLY_UNTIL_PUBLISHED_TIME_AVAILABLE'
    }
    accepted=parse_dt(r.get('secLatestAcceptedAt')); sec_causal=bool(event_dt and accepted and accepted<=event_dt)
    if sec_causal:
        risk_flags=r.get('secRiskFlags') or []; event_types=r.get('secEventTypes') or []
        sec={
          'knownAtEvent':True,'acceptedAtUTC':r.get('secLatestAcceptedAt'),'latestForm':r.get('secLatestForm'),
          'eventTypes':event_types,'riskFlags':risk_flags,'contextFlags':r.get('secContextFlags') or [],
          'freshWithin72h':bool(r.get('secFreshWithin72h')),'filingsConsidered':r.get('secFilingsConsidered'),
          'riskLevel':sec_risk_level(risk_flags,event_types),'sourceOfficial':bool(r.get('secContextSourceOfficial')),
          'causalStatus':'ACCEPTED_BEFORE_OR_AT_EVENT'
        }
    else:
        sec={'knownAtEvent':False,'acceptedAtUTC':None,'latestForm':None,'eventTypes':[],'riskFlags':[],'contextFlags':[],
             'freshWithin72h':False,'filingsConsidered':0,'riskLevel':'UNKNOWN','sourceOfficial':bool(r.get('secContextSourceOfficial')),
             'causalStatus':'UNKNOWN_OR_NOT_CAUSAL_AT_EVENT'}
    fp=r.get('featurePercentiles') or {}
    return {
      'eventId':r.get('v4EventId'),'symbol':r.get('symbol'),'eventTimestampUTC':ts,'tradingDateET':r.get('tradingDateET'),'session':r.get('session'),
      'referencePrice':r.get('referencePrice'),
      'rank':r.get('v4Rank'),'rankScorePct':r.get('v4RankScorePct'),'modelDisagreement':r.get('v4ModelDisagreement'),
      'gatePassed':b(r.get('v4GatePassed')),'surfaceEligible':b(r.get('v4SurfaceEligible')),'progressionSeen':r.get('v4ProgressionSeen'),
      'eventPolicy':r.get('v4EventPolicy'),'marketHeat':r.get('marketHeat'),'microShape':r.get('microShape'),
      'precursorScore':r.get('precursorScore'),'continuationScore':r.get('continuationScore'),'tradabilityScore':r.get('tradabilityScore'),'riskScore':r.get('riskScore'),
      'featurePercentiles':{k:fp.get(k) for k in ('rvol','volume','dollarVolume','trades','atr','floatTightness','shortFloat','priceAcceleration','m1','m3','m5','m10')},
      'dataCompleteness':{
         'floatKnown':finite(fp.get('floatTightness')),'shortKnown':finite(fp.get('shortFloat')),
         'spreadKnown':False,'spreadStatus':'UNKNOWN_NOT_ZERO','newsObserved':bool(cat_present),'secKnownCausally':sec_causal
      },
      'catalyst':catalyst,'sec':sec,
      'modelProvenance':{'v4DatasetSha256':r.get('v4DatasetSha256'),'v4Policy':r.get('v4Policy'),'executionVerified':False},
      'immutability':'EVIDENCE_BLOCK_FROZEN_AT_FIRST_EVENT'
    }

def outcome_from(r):
    mature=r.get('v4OutcomeMature60') is True; censored=r.get('v4OutcomeCensored60') is True
    mfe=r.get('v4OutcomeMfe60Pct'); mae=r.get('v4OutcomeMae60Pct')
    clean=(bool(mature) and finite(mfe) and finite(mae) and float(mfe)>=10 and float(mae)>=-4)
    return {
      'status':'MATURE' if mature else ('CENSORED' if censored else 'OPEN'),
      'mature60':mature,'censored60':censored,'censorReason':r.get('v4OutcomeCensorReason'),
      'mfe60Pct':mfe if finite(mfe) else None,'mae60Pct':mae if finite(mae) else None,
      'hit10_60m':bool(r.get('v4Hit10_60m')) if mature else None,
      'cleanWinner10_60_mae4':clean if mature else None,
      'barsObserved':r.get('v4OutcomeBarsObserved'),'lastObservedAtUTC':r.get('v4OutcomeLastObservedAt'),
      'maturedAtUTC':r.get('v4OutcomeMaturedAtUTC'),'source':r.get('v4OutcomeSource'),
      'executionVerified':False
    }

def rate(rows,key):
    mature=[x for x in rows if x.get('outcome',{}).get('status')=='MATURE']
    if not mature:return {'mature':0,'positive':0,'precisionPct':None}
    pos=sum(x['outcome'].get(key) is True for x in mature)
    return {'mature':len(mature),'positive':pos,'precisionPct':round(100*pos/len(mature),2)}

def summarize(records):
    mature=[x for x in records if x.get('outcome',{}).get('status')=='MATURE']; openr=[x for x in records if x.get('outcome',{}).get('status')=='OPEN']; cens=[x for x in records if x.get('outcome',{}).get('status')=='CENSORED']
    def groups(fn):
        d={}
        for x in records:d.setdefault(str(fn(x)),[]).append(x)
        out={}
        for k,v in sorted(d.items()):
            raw=rate(v,'hit10_60m'); clean=rate(v,'cleanWinner10_60_mae4')
            out[k]={'events':len(v),'raw10':raw,'clean':clean,'eligibleForInterpretation':raw['mature']>=20}
        return out
    return {
      'schemaVersion':'4.9-summary','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':POLICY,
      'counts':{'events':len(records),'mature':len(mature),'open':len(openr),'censored':len(cens),'rawWinners':sum(x['outcome'].get('hit10_60m') is True for x in mature),'cleanWinners':sum(x['outcome'].get('cleanWinner10_60_mae4') is True for x in mature)},
      'overall':{'raw10':rate(records,'hit10_60m'),'clean':rate(records,'cleanWinner10_60_mae4')},
      'bySession':groups(lambda x:x['evidence'].get('session') or 'UNKNOWN'),
      'byCatalystType':groups(lambda x:(x['evidence'].get('catalyst') or {}).get('type') or 'NONE'),
      'byCatalystMateriality':groups(lambda x:(x['evidence'].get('catalyst') or {}).get('materialityBand') or 'UNKNOWN'),
      'bySecRisk':groups(lambda x:(x['evidence'].get('sec') or {}).get('riskLevel') or 'UNKNOWN'),
      'interpretationRule':'NO SUBGROUP CLAIM BEFORE >=20 MATURE FIRST-EVENTS; PREFER >=30 FOR POLICY RESEARCH',
      'promotionPolicy':'NO_AUTO_PROMOTION_FROM_FORWARD_STORE'
    }

ledger=read(LEDGER,{}); old=read(OUT,{'schemaVersion':'4.9','policy':POLICY,'events':[]})
records=old.get('events') or []; byid={x.get('eventId'):x for x in records if x.get('eventId')}
first={}
for r in ledger.get('records') or []:
    if not r.get('v4FirstSurfaceEvent'):continue
    eid=r.get('v4EventId'); ts=parse_dt(r.get('v4FirstSurfaceAt') or r.get('timestamp'))
    if not eid or not ts:continue
    if eid not in first or ts<first[eid][0]:first[eid]=(ts,r)
created=0;outcomes_updated=0
for eid,(_,r) in first.items():
    if eid not in byid:
        ev={'eventId':eid,'createdAtUTC':datetime.now(timezone.utc).isoformat(),'evidence':build_evidence(r),'outcome':outcome_from(r),'policy':POLICY}
        records.append(ev);byid[eid]=ev;created+=1
    else:
        # Evidence is immutable. Outcome alone can advance OPEN -> MATURE/CENSORED or refresh derived observations.
        newo=outcome_from(r); oldo=byid[eid].get('outcome') or {}
        if json.dumps(newo,sort_keys=True)!=json.dumps(oldo,sort_keys=True):
            byid[eid]['outcome']=newo;byid[eid]['outcomeUpdatedAtUTC']=datetime.now(timezone.utc).isoformat();outcomes_updated+=1
records=sorted(records,key=lambda x:((x.get('evidence') or {}).get('eventTimestampUTC') or '',x.get('eventId') or ''))[-10000:]
payload={'schemaVersion':'4.9','updatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':POLICY,'eventIdentity':'first v4 surface event per symbol|ET trading date','rawBarsPersisted':False,'rawEliteRowsPersisted':False,'evidenceImmutable':True,'events':records}
OUT.write_text(json.dumps(payload,separators=(',',':'))+'\n',encoding='utf-8')
summary=summarize(records); SUMMARY.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','events':len(records),'created':created,'outcomesUpdated':outcomes_updated,'mature':summary['counts']['mature'],'open':summary['counts']['open'],'censored':summary['counts']['censored'],'policy':POLICY}))
