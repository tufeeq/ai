#!/usr/bin/env python3
"""Summarize TAGit v4 forward shadow evidence at event level.

Uses only first surfaced v4 events already recorded in the derived ledger and their
independently followed 60-minute outcomes. This is measurement, not a promotion
mechanism and not a trading recommendation.
"""
import json, math, pathlib, statistics
from collections import defaultdict
from datetime import datetime, timezone

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
OUT=pathlib.Path('tag/data/tagit-v4-forward-eval.json')
MIN_MATURE_EVENTS=100
MIN_DISTINCT_DAYS=10


def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def dt(v):
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except:return None

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def rnd(v,n=2):
    return round(float(v),n) if finite(v) else None

def med(xs):
    a=[float(x) for x in xs if finite(x)]
    return round(statistics.median(a),2) if a else None

def mean(xs):
    a=[float(x) for x in xs if finite(x)]
    return round(statistics.fmean(a),2) if a else None

def metrics(xs):
    mature=[x for x in xs if x.get('v4OutcomeMature60') is True]
    hits=sum(x.get('v4Hit10_60m') is True for x in mature)
    cens=sum(x.get('v4OutcomeCensored60') is True for x in xs)
    open_=[x for x in xs if x.get('v4OutcomeMature60') is not True and x.get('v4OutcomeCensored60') is not True]
    return {
      'events':len(xs),
      'mature60':len(mature),
      'hits10_60m':hits,
      'precision10_60mPct':round(hits/len(mature)*100,2) if mature else None,
      'medianMfe60Pct':med([x.get('v4OutcomeMfe60Pct') for x in mature]),
      'medianMae60Pct':med([x.get('v4OutcomeMae60Pct') for x in mature]),
      'meanMfe60Pct':mean([x.get('v4OutcomeMfe60Pct') for x in mature]),
      'meanMae60Pct':mean([x.get('v4OutcomeMae60Pct') for x in mature]),
      'censored60':cens,
      'openOrUnresolved':len(open_),
      'distinctUtcDays':len({str(x.get('v4FirstSurfaceAt') or x.get('timestamp') or '')[:10] for x in xs if x.get('v4FirstSurfaceAt') or x.get('timestamp')})
    }

ledger=read(LEDGER,{})
records=ledger.get('records') or []
events=[x for x in records if x.get('v4FirstSurfaceEvent') is True and x.get('v4EventId')]
# Defensive event-id dedupe: keep earliest canonical record only.
byid={}
for x in events:
    eid=str(x.get('v4EventId'));cur=byid.get(eid)
    tx=dt(x.get('v4FirstSurfaceAt') or x.get('timestamp'))
    tc=dt(cur.get('v4FirstSurfaceAt') or cur.get('timestamp')) if cur else None
    if cur is None or (tx and tc and tx<tc):byid[eid]=x
events=list(byid.values())
now=datetime.now(timezone.utc)
stale=[]
for x in events:
    if x.get('v4OutcomeMature60') is True or x.get('v4OutcomeCensored60') is True:continue
    opened=dt(x.get('v4FirstSurfaceAt') or x.get('timestamp'))
    if opened and (now-opened).total_seconds()/60>180:stale.append(x)

bysession=defaultdict(list)
for x in events:bysession[str(x.get('session') or 'unknown')].append(x)
overall=metrics(events)
ready=overall['mature60']>=MIN_MATURE_EVENTS and overall['distinctUtcDays']>=MIN_DISTINCT_DAYS
latest=max((dt(x.get('v4FirstSurfaceAt') or x.get('timestamp')) for x in events if dt(x.get('v4FirstSurfaceAt') or x.get('timestamp'))),default=None)
payload={
  'schemaVersion':1,
  'method':'TAGIT_V4_FORWARD_FIRST_SURFACE_EVENT_EVALUATION',
  'updatedAtUTC':now.isoformat(),
  'policy':'MEASUREMENT_ONLY_NO_CHAMPION_OVERRIDE',
  'championUnaffected':True,
  'executionVerified':False,
  'eventIdentity':'symbol|UTC-day; first v4 surface event only',
  'outcomeDefinition':'+10% MFE within 60 minutes after first surfaced event; Yahoo 1m transient follow-up; missing coverage is censored, never forced negative',
  'status':'FORWARD_SAMPLE_READY_FOR_REVIEW' if ready else 'COLLECTING_FORWARD_EVIDENCE',
  'reviewReadiness':{
    'minimumMatureEvents':MIN_MATURE_EVENTS,
    'minimumDistinctDays':MIN_DISTINCT_DAYS,
    'matureEventsObserved':overall['mature60'],
    'distinctDaysObserved':overall['distinctUtcDays'],
    'readyForHumanReview':ready,
    'autoPromotionAllowed':False
  },
  'overall':overall,
  'bySession':{k:metrics(v) for k,v in sorted(bysession.items())},
  'staleUnresolvedOver180m':len(stale),
  'latestFirstSurfaceEventAtUTC':latest.isoformat() if latest else None,
  'historicalReferences':{
    'v310Live21SelectedGate':{'precisionPct':6.67,'recallPct':80.56,'note':'observation-level frozen holdout; not directly comparable to forward first-event precision'},
    'v38PremarketFirstEvent':{'precisionPct':21.43,'note':'historical pre-market first-event diagnostic; not a live expectation'}
  },
  'limitations':[
    'Forward results are event-level and are not directly interchangeable with observation-level historical metrics.',
    'No bid/ask spread is available, so this evaluates discovery quality, not executable trade quality.',
    'Catalyst and dilution fields are context only and do not override the v4 rank.'
  ]
}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':payload['status'],'events':overall['events'],'mature60':overall['mature60'],'precision10_60mPct':overall['precision10_60mPct'],'stale':len(stale)}))
