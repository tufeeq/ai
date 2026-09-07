#!/usr/bin/env python3
"""TAGit v3.8 event-level evaluation of the validated v3.5 selective challenger.

Measures what a user actually sees: first alert per ticker-day, plus a 90-minute
cooldown event stream. No thresholds are retuned here. Research-only.
"""
import json, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone

OUT=pathlib.Path('tag/data/tagit-v38-event-level.json')
g=runpy.run_path('tagit/selective-meta-v35.py')
hp=g['hp']; cfg=g['cfg']; apply=g['apply']; general=g['general']; clean=g['clean']; scode=g['scode']; stat_obs=g['stat']
alerts=sorted(apply(hp,cfg),key=lambda x:x['ts'])


def event_stat(xs):
    n=len(xs); tp=sum(general(x) for x in xs); ctp=sum(clean(x) for x in xs)
    return {'events':n,'tp10':tp,'precision10Pct':round(tp/n*100,2) if n else None,'cleanTP':ctp,'cleanPrecisionPct':round(ctp/n*100,2) if n else None,'tickerDays':len(set(x['key'] for x in xs))}

# First alert of each ticker-day.
first={}
for x in alerts:first.setdefault(x['key'],x)
first_events=sorted(first.values(),key=lambda x:x['ts'])

# Cooldown event stream: same ticker can re-arm only after 90 minutes.
cool=[]; last={}
for x in alerts:
    k=x['key']; prev=last.get(k)
    if prev is None or x['ts']-prev>=90*60000:
        cool.append(x); last[k]=x['ts']

sessions={}
for code,name in ((0,'pre'),(1,'regular'),(2,'after')):
    a=[x for x in alerts if scode(x['session'])==code]
    f=[x for x in first_events if scode(x['session'])==code]
    c=[x for x in cool if scode(x['session'])==code]
    sessions[name]={'observationAlerts':stat_obs(a,[x for x in hp if scode(x['session'])==code]),'firstTickerDayEvents':event_stat(f),'cooldown90mEvents':event_stat(c)}

report={'schemaVersion':1,'method':'TAGIT_V38_EVENT_LEVEL_EVALUATION','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
'configSource':'v3.5 thresholds unchanged; no v3.8 retuning','selectedConfig':{'topK':cfg[0],'minMeta':cfg[1],'maxDisagreement':cfg[2],'minVotes':cfg[3]},
'antiLeakage':['inherits v3.5/v3.4 holdout and fully-closed 5m contract','event collapsing occurs after frozen v3.5 scoring','no thresholds selected from holdout'],
'observationLevel':event_stat(alerts),'firstTickerDay':event_stat(first_events),'cooldown90m':event_stat(cool),'sessions':sessions}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
