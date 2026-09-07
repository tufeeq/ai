#!/usr/bin/env python3
"""Attach current derived SEC context to the matching TAGit shadow snapshot records.

The context is immutable evidence-at-observation: only records from the current
snapshot timestamp are patched. Later outcome followers can mature those records.
"""
import json,pathlib
from datetime import datetime,timezone

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
SEC=pathlib.Path('tag/data/tagit-sec-event-shadow.json')

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

ledger=read(LEDGER,{});sec=read(SEC,{})
records=ledger.get('records') or [];latest=ledger.get('latestSnapshot');asof=sec.get('asOfUTC')
by={str(x.get('symbol') or '').upper():x for x in sec.get('items') or []}
patched=0
for r in records:
    if latest and r.get('timestamp')!=latest:continue
    sym=str(r.get('symbol') or '').upper();x=by.get(sym)
    if not x:continue
    r['secContextAsOfUTC']=asof
    r['secContextSourceOfficial']=True
    r['secLatestForm']=x.get('latestForm')
    r['secLatestAcceptedAt']=x.get('latestAcceptedAt')
    r['secEventTypes']=x.get('eventTypes') or []
    r['secRiskFlags']=x.get('riskFlags') or []
    r['secContextFlags']=x.get('contextFlags') or []
    r['secFreshWithin72h']=bool(x.get('freshWithin72h'))
    r['secFilingsConsidered']=int(x.get('filingsConsidered') or 0)
    patched+=1
ledger['secEventContextAttachment']={'updatedAtUTC':datetime.now(timezone.utc).isoformat(),'secAsOfUTC':asof,'sourceOfficial':True,'recordsPatchedThisSnapshot':patched,'policy':'EVIDENCE_AT_OBSERVATION_ONLY_NO_ALERT_OVERRIDE'}
LEDGER.write_text(json.dumps(ledger,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','patched':patched,'latestSnapshot':latest,'secAsOfUTC':asof}))
