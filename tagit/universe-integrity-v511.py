#!/usr/bin/env python3
"""TAGit v5.11 universe-integrity gate.

A chronological price holdout is not sufficient for 'real discovery precision' if the
historical symbol universe was assembled from known movers or today's universe. This gate
separates model precision from true scanner/discovery precision and requires forward,
point-in-time universe evidence before any production-quality claim.
"""
import json, pathlib
from datetime import datetime, timezone

ROOT=pathlib.Path('tag/data')
DISCOVERY=ROOT/'discovery.json'
DLEDGER=ROOT/'discovery-ledger.json'
V59=ROOT/'tagit-v59-event-discovery.json'
ULEDGER=ROOT/'tagit-forward-universe-ledger.json'
OUT=ROOT/'tagit-v511-universe-integrity.json'


def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def iso_day(v):
    return str(v or '')[:10]

disc=readj(DISCOVERY,{})
dl=readj(DLEDGER,{})
v59=readj(V59,{})
now=datetime.now(timezone.utc).isoformat()
day=iso_day(dl.get('sessionDateET') or disc.get('snapshotTimestampET') or disc.get('snapshotTimestampUTC') or now)

symbols={}
for r in disc.get('rows') or []:
    s=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
    if not s:continue
    symbols[s]={
        'firstObservedUTC':r.get('_firstObservedTimestampUTC'),
        'originClass':r.get('_originClass'),
        'lanes':r.get('_discoveryLanes') or [],
        'firstChange':r.get('_firstObservedChange'),
        'firstVolume':r.get('_firstObservedVolume')
    }
# Prefer the session ledger first-seen records when available.
for s,z in (dl.get('tickers') or {}).items():
    s=str(s).upper().strip()
    if not s:continue
    symbols.setdefault(s,{})
    symbols[s].update({'firstObservedUTC':z.get('firstSeenUTC'),'originClass':z.get('originClass'),'firstChange':z.get('firstChangePct'),'firstVolume':z.get('firstVolume')})

ledger=readj(ULEDGER,{'schemaVersion':'5.11-forward-universe-ledger','policy':'APPEND_ONLY_POINT_IN_TIME_NO_RETROACTIVE_MEMBERSHIP','sessions':[]})
if ledger.get('policy')!='APPEND_ONLY_POINT_IN_TIME_NO_RETROACTIVE_MEMBERSHIP':
    raise RuntimeError('incompatible universe ledger policy')
existing={x.get('sessionDateET') for x in ledger.get('sessions') or []}
if day and day not in existing:
    ledger.setdefault('sessions',[]).append({'sessionDateET':day,'capturedAtUTC':now,'snapshotTimestampUTC':disc.get('snapshotTimestampUTC'),'symbols':symbols})
ledger['sessions']=sorted(ledger.get('sessions') or [],key=lambda x:x.get('sessionDateET') or '')
ledger['sessionCount']=len(ledger['sessions'])
ledger['symbolSessionCount']=sum(len(x.get('symbols') or {}) for x in ledger['sessions'])
ULEDGER.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Minimum credibility for REAL scanner precision. This is intentionally stricter than a
# model-only holdout because discovery requires an unbiased point-in-time candidate universe.
min_sessions=20
min_symbol_sessions=5000
universe_ready=ledger['sessionCount']>=min_sessions and ledger['symbolSessionCount']>=min_symbol_sessions
model_candidate=bool((v59.get('credibilityGate') or {}).get('candidate90OnHistoricalHoldout'))
real_discovery_eligible=bool(model_candidate and universe_ready)

report={
  'schemaVersion':'5.11-universe-integrity',
  'generatedAtUTC':now,
  'historicalModelHoldoutStatus':v59.get('verdict'),
  'historicalModelCandidate90':model_candidate,
  'knownSelectionBiasRisk':'v5.x historical symbol set includes known historical movers and current discovery symbols; therefore model holdout precision is not automatically real scanner precision',
  'forwardUniverse':{'sessionCount':ledger['sessionCount'],'symbolSessionCount':ledger['symbolSessionCount'],'requiredSessions':min_sessions,'requiredSymbolSessions':min_symbol_sessions,'ready':universe_ready},
  'realDiscoveryPrecisionClaimEligible':real_discovery_eligible,
  'requiredNextValidation':'replay frozen model on each append-only point-in-time universe session, count every emitted decision including hard negatives, then compute independent ticker-day precision and day-block uncertainty',
  'verdict':'REAL_DISCOVERY_CLAIM_ELIGIBLE_PENDING_FORWARD_OUTCOMES' if real_discovery_eligible else 'MODEL_RESEARCH_ONLY_UNIVERSE_EVIDENCE_INSUFFICIENT'
}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
