#!/usr/bin/env python3
import json,pathlib,datetime
P=pathlib.Path('tag/data/snapshots.json');O=pathlib.Path('tag/data/tagit-snapshot-store-audit.json')
d=json.loads(P.read_text())
items=d if isinstance(d,list) else (d.get('snapshots') or d.get('items') or d.get('data') or [])
report={'generatedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rootType':type(d).__name__,'rootKeys':list(d.keys())[:50] if isinstance(d,dict) else None,'entries':len(items),'samples':[],'timestampFields':{},'rowContainerCounts':{},'totalNestedRows':0,'earliest':None,'latest':None}
times=[]
for i,x in enumerate(items):
    if not isinstance(x,dict):continue
    for k in ('timestampUTC','snapshotTimestampUTC','updatedAt','timestampET','asOf','time'):
        if x.get(k):report['timestampFields'][k]=report['timestampFields'].get(k,0)+1
    ts=x.get('timestampUTC') or x.get('snapshotTimestampUTC') or x.get('updatedAt') or x.get('asOf')
    if ts:times.append(str(ts))
    rc=None;rows=[]
    for k in ('topMovers','rows','data','items','symbols'):
        if isinstance(x.get(k),list):rc=k;rows=x[k];break
    report['rowContainerCounts'][str(rc)]=report['rowContainerCounts'].get(str(rc),0)+1
    report['totalNestedRows']+=len(rows)
    if len(report['samples'])<5:
        report['samples'].append({'index':i,'keys':list(x.keys())[:80],'timestamp':ts,'session':x.get('session'),'rowContainer':rc,'rowCount':len(rows),'rowKeys':list(rows[0].keys())[:100] if rows and isinstance(rows[0],dict) else []})
if times:report['earliest']=min(times);report['latest']=max(times)
O.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
