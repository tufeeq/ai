#!/usr/bin/env python3
import json,pathlib,datetime,collections
P=pathlib.Path('tag/data/snapshots.json');O=pathlib.Path('tag/data/tagit-snapshot-store-audit.json')
d=json.loads(P.read_text())
items=d if isinstance(d,list) else (d.get('snapshots') or d.get('items') or d.get('data') or [])
report={'generatedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rootType':type(d).__name__,'rootKeys':list(d.keys())[:50] if isinstance(d,dict) else None,'entries':len(items),'samples':[],'timestampFields':{},'rowContainerCounts':{},'totalNestedRows':0,'earliest':None,'latest':None}
times=[];fields=collections.Counter();nested=collections.Counter();sessions=collections.Counter();days=collections.Counter();training=collections.Counter()
for i,x in enumerate(items):
    if not isinstance(x,dict):continue
    sessions[str(x.get('session'))]+=1; training[str(x.get('trainingEligible'))]+=1
    for k in ('timestampUTC','snapshotTimestampUTC','updatedAt','timestampET','asOf','time'):
        if x.get(k):report['timestampFields'][k]=report['timestampFields'].get(k,0)+1
    ts=x.get('timestampUTC') or x.get('snapshotTimestampUTC') or x.get('updatedAt') or x.get('asOf')
    if ts:times.append(str(ts));days[str(ts)[:10]]+=1
    rc=None;rows=[]
    for k in ('topMovers','rows','data','items','symbols'):
        if isinstance(x.get(k),list):rc=k;rows=x[k];break
    report['rowContainerCounts'][str(rc)]=report['rowContainerCounts'].get(str(rc),0)+1
    report['totalNestedRows']+=len(rows)
    for r in rows:
        if not isinstance(r,dict):continue
        for k,v in r.items():
            if v not in (None,'',[],{}):fields[k]+=1
            if isinstance(v,dict):
                for sk,sv in v.items():
                    if sv not in (None,'',[],{}):nested[f'{k}.{sk}']+=1
            elif isinstance(v,list) and v and isinstance(v[0],dict):
                for z in v:
                    for sk,sv in z.items():
                        if sv not in (None,'',[],{}):nested[f'{k}[].{sk}']+=1
    if len(report['samples'])<8:
        report['samples'].append({'index':i,'keys':list(x.keys())[:80],'timestamp':ts,'session':x.get('session'),'trainingEligible':x.get('trainingEligible'),'rowContainer':rc,'rowCount':len(rows),'rowKeys':list(rows[0].keys())[:140] if rows and isinstance(rows[0],dict) else []})
if times:report['earliest']=min(times);report['latest']=max(times)
N=max(1,report['totalNestedRows'])
report['sessions']=dict(sessions);report['snapshotsByDay']=dict(days);report['trainingEligible']=dict(training)
report['rowFieldCoverage']=[{'field':k,'count':v,'pct':round(v/N*100,2)} for k,v in fields.most_common()]
report['nestedFieldCoverage']=[{'field':k,'count':v,'pctOfRows':round(v/N*100,2)} for k,v in nested.most_common()]
report['candidateTransitionFields']=[z for z in report['rowFieldCoverage'] if any(w in z['field'].lower() for w in ('persist','velocity','delta','relative','float','volume','retention','range','score','signal','rank','change','price'))]
O.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'entries':report['entries'],'rows':report['totalNestedRows'],'sessions':report['sessions'],'days':report['snapshotsByDay'],'topFields':report['rowFieldCoverage'][:50],'transitionFields':report['candidateTransitionFields'][:80]},indent=2))
