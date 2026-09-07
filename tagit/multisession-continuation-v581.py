#!/usr/bin/env python3
"""TAGit v5.8.1 Purged Multi-Session Continuation.

Runs the v5.8 learner with two strict research corrections:
1) multi-session outcome horizons may not cross train->calibration or calibration->holdout boundaries;
2) outputs are written separately so the original v5.8 evidence is never silently overwritten.

This wrapper deliberately transforms only the audited split/output clauses of v5.8, then executes
that frozen learner. Any source drift that prevents an exact replacement fails closed.
"""
from pathlib import Path
import json

SRC=Path('tagit/multisession-continuation-v58.py')
src=SRC.read_text(encoding='utf-8')

# Preserve original learner but isolate evidence files.
repls={
    "OUT=ROOT/'tagit-v58-multisession-continuation.json'":"OUT=ROOT/'tagit-v581-multisession-continuation.json'",
    "LIB=ROOT/'tagit-v58-multisession-case-library.json'":"LIB=ROOT/'tagit-v581-multisession-case-library.json'",
    "WATCH=ROOT/'tagit-v58-carryover-watch.json'":"WATCH=ROOT/'tagit-v581-carryover-watch.json'",
}
for old,new in repls.items():
    if old not in src: raise RuntimeError(f'v5.8 source drift: missing {old}')
    src=src.replace(old,new,1)

old="""dates=sorted({x['day'] for x in rows});ia=max(1,int(.70*len(dates)));ib=max(ia+1,int(.85*len(dates)))
td=set(dates[:ia]);cd=set(dates[ia:ib]);hd=set(dates[ib:])
train=[x for x in rows if x['day'] in td];cal=[x for x in rows if x['day'] in cd];hold=[x for x in rows if x['day'] in hd]
"""
new="""dates=sorted({x['day'] for x in rows});ia=max(1,int(.70*len(dates)));ib=max(ia+1,int(.85*len(dates)))
cal_start=dates[ia] if ia<len(dates) else '9999-12-31'
hold_start=dates[ib] if ib<len(dates) else '9999-12-31'
td=set(dates[:ia]);cd=set(dates[ia:ib]);hd=set(dates[ib:])
def label_end(x): return str(x.get('secondDay') or x.get('nextDay') or x['day'])
raw_train=[x for x in rows if x['day'] in td]
raw_cal=[x for x in rows if x['day'] in cd]
train=[x for x in raw_train if label_end(x)<cal_start]
cal=[x for x in raw_cal if label_end(x)<hold_start]
hold=[x for x in rows if x['day'] in hd]
train_boundary_purged=len(raw_train)-len(train)
cal_boundary_purged=len(raw_cal)-len(cal)
"""
if old not in src:
    raise RuntimeError('v5.8 source drift: audited split block not found')
src=src.replace(old,new,1)

# Execute the audited learner in this namespace so purge counters remain inspectable.
exec(compile(src, str(SRC)+'::v581-purged', 'exec'), globals(), globals())

out=Path('tag/data/tagit-v581-multisession-continuation.json')
if not out.exists(): raise RuntimeError('v5.8.1 output missing')
r=json.loads(out.read_text(encoding='utf-8'))
r['schemaVersion']='5.8.1-purged-multisession-continuation'
r['validationHardening']={
    'calibrationStart': globals().get('cal_start'),
    'holdoutStart': globals().get('hold_start'),
    'trainBoundaryPurgedRows': int(globals().get('train_boundary_purged',0)),
    'calibrationBoundaryPurgedRows': int(globals().get('cal_boundary_purged',0)),
    'rule':'every train/calibration multi-session label horizon ends strictly before the next split boundary',
}
a=list(r.get('antiLeakage') or [])
a.append('multi-session label horizons end strictly before the next split boundary')
r['antiLeakage']=list(dict.fromkeys(a))
r['policy']='RESEARCH_ONLY_NO_CHAMPION_OVERRIDE'
out.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':r.get('status'),'validationHardening':r['validationHardening'],'calibration':r.get('calibration'),'holdout':r.get('holdout')},ensure_ascii=False,indent=2))
