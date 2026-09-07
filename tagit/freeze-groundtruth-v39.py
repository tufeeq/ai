#!/usr/bin/env python3
"""Freeze the causal v3.4 row-level research dataset for reproducible challengers.

Contains derived features + future evaluation labels only. No raw Finviz Elite rows
and no raw Yahoo bar series are persisted.
"""
import hashlib, json, pathlib, runpy
from datetime import datetime, timezone

OUT=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json')
g=runpy.run_path('tagit/month-groundtruth-v34.py')
data=g['data']
keep=('si','ts','day','session','ticker','key','price','change','volume','changeRank','volumeRank','base','sequence','micro','mfeGT','maeGT','target','parity')
rows=[]
for x in data:
    rows.append({k:x.get(k) for k in keep})
rows.sort(key=lambda x:(x['ts'],x['ticker']))
canon=json.dumps(rows,sort_keys=True,separators=(',',':'),ensure_ascii=False)
sha=hashlib.sha256(canon.encode()).hexdigest()
by_split={
 'train':sum(x['day']<='2026-08-24' for x in rows),
 'calibration':sum('2026-08-25'<=x['day']<='2026-08-26' for x in rows),
 'holdout':sum(x['day']>='2026-08-27' for x in rows)}
pos={
 'train':sum(x['day']<='2026-08-24' and x['target'] for x in rows),
 'calibration':sum('2026-08-25'<=x['day']<='2026-08-26' and x['target'] for x in rows),
 'holdout':sum(x['day']>='2026-08-27' and x['target'] for x in rows)}
report={'schemaVersion':1,'method':'TAGIT_V39_FROZEN_CAUSAL_GROUNDTRUTH','frozenAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_DATASET_IMMUTABLE_BASELINE',
'source':'v3.4 field-requalified snapshots + fully closed Yahoo 5m features + future-only 60m labels','sourcePeriod':'2026-08-11..2026-09-04','rows':len(rows),'splitRows':by_split,'splitPositives':pos,'datasetSha256':sha,
'antiLeakage':['features contain only snapshot fields and fully closed 5m bars at/before observation','future 60m Yahoo bars contribute labels only','Finviz/Yahoo price parity <=7.5% inherited from v3.4'],
'publication':['derived features/labels only','no raw Finviz Elite rows','no raw Yahoo bar series'],'data':rows}
OUT.write_text(json.dumps(report,separators=(',',':'),ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='data'},indent=2))
