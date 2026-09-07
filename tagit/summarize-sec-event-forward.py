#!/usr/bin/env python3
"""Forward-only SEC context outcome summary for first v4 events.

No weights are learned or applied here. Buckets become reviewable only after
minimum support; no automatic alert override or promotion is possible.
"""
import json,pathlib
from collections import defaultdict
from datetime import datetime,timezone

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
OUT=pathlib.Path('tag/data/tagit-sec-event-forward.json')
MIN_BUCKET_N=20;MIN_TOTAL_N=50;MIN_DAYS=5

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def stat(a):
    n=len(a);tp=sum(r.get('v4Hit10_60m') is True for r in a)
    return {'n':n,'tp':tp,'precisionPct':round(tp/n*100,2) if n else None,'meanMfe60Pct':round(sum(float(r.get('v4OutcomeMfe60Pct') or 0) for r in a)/n,2) if n else None,'meanMae60Pct':round(sum(float(r.get('v4OutcomeMae60Pct') or 0) for r in a)/n,2) if n else None,'tradingDays':len({r.get('tradingDateET') for r in a if r.get('tradingDateET')})}

ledger=read(LEDGER,{});records=ledger.get('records') or []
mature=[r for r in records if r.get('v4FirstSurfaceEvent') is True and r.get('v4OutcomeMature60') is True and r.get('v4Hit10_60m') is not None]
buckets=defaultdict(list)
for r in mature:
    ev=r.get('secEventTypes') or [];risk=r.get('secRiskFlags') or [];ctx=r.get('secContextFlags') or []
    if not ev and not risk and not ctx:buckets['SEC_NONE'].append(r)
    for x in ev:buckets['EVENT:'+str(x)].append(r)
    for x in risk:buckets['RISK:'+str(x)].append(r)
    if r.get('secFreshWithin72h'):buckets['SEC_FRESH_72H'].append(r)
    else:buckets['SEC_NOT_FRESH_72H'].append(r)
    # Catalyst is already captured independently; SEC buckets stay filing-specific.

bs={}
for k,a in sorted(buckets.items()):
    s=stat(a);s['eligibleForPolicyReview']=bool(s['n']>=MIN_BUCKET_N and s['tradingDays']>=MIN_DAYS);bs[k]=s
total=stat(mature);ready=bool(total['n']>=MIN_TOTAL_N and total['tradingDays']>=MIN_DAYS)
report={'schemaVersion':1,'method':'TAGIT_SEC_EVENT_FORWARD_FIRST_EVENT_STUDY','updatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'MEASUREMENT_ONLY_NO_ALERT_OVERRIDE','target':'+10% MFE within 60m after first v4 surface event','minimumEvidence':{'overallMatureEvents':MIN_TOTAL_N,'bucketMatureEvents':MIN_BUCKET_N,'tradingDays':MIN_DAYS},'total':total,'overallReadyForReview':ready,'buckets':bs,'promotionAllowed':False,'notes':['SEC context is frozen at the observation snapshot','censored/unmatured events are excluded, never treated as failures','bucket evidence must mature before any future model weight or veto is considered']}
OUT.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','total':total,'overallReadyForReview':ready,'buckets':len(bs)},indent=2))
