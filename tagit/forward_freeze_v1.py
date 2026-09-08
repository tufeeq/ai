#!/usr/bin/env python3
"""TAGit forward-only point-in-time freeze ledger.

Creates one immutable daily universe snapshot only during 08:55-09:15 America/New_York.
The source snapshot and every row must have been observed before the 09:15 decision cutoff.
Snapshots are hash chained and never overwritten. This lane is evaluation-only: no outcome,
calibration, threshold or future-session data is accepted here.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, pathlib, sys
from zoneinfo import ZoneInfo

NY=ZoneInfo('America/New_York'); UTC=dt.timezone.utc
ROOT=pathlib.Path('tag/data/forward')
SRC=pathlib.Path('tag/data/discovery.json')
CUT=dt.time(9,15); START=dt.time(8,55)


def iso(x):
    if not x:return None
    try:return dt.datetime.fromisoformat(str(x).replace('Z','+00:00')).astimezone(UTC)
    except Exception:return None

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def sha(x):return hashlib.sha256(canonical(x).encode()).hexdigest()

def previous_hash(day):
    if not ROOT.exists():return None
    files=sorted(p for p in ROOT.glob('*.json') if p.stem<day)
    if not files:return None
    try:return json.loads(files[-1].read_text()).get('snapshotHash')
    except Exception:return None

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--audit-only',action='store_true'); a=ap.parse_args()
    now=dt.datetime.now(UTC); local=now.astimezone(NY); day=local.date().isoformat()
    if not SRC.exists():raise SystemExit('missing discovery source')
    src=json.loads(SRC.read_text()); rows=src.get('rows') or []
    src_ts=iso(src.get('snapshotTimestampUTC') or src.get('updatedAt'))
    cutoff=dt.datetime.combine(local.date(),CUT,NY).astimezone(UTC)
    window=START<=local.time().replace(tzinfo=None)<=CUT
    audit={'nowUTC':now.isoformat(),'nowET':local.isoformat(),'windowOpen':window,'sourceTimestampUTC':src_ts.isoformat() if src_ts else None,'sourceCount':len(rows)}
    if a.audit_only:
        print(json.dumps(audit,indent=2)); return
    if not window:raise SystemExit(f'freeze refused outside 08:55-09:15 ET: {local.isoformat()}')
    if src_ts is None or src_ts>cutoff:raise SystemExit('source timestamp missing or after decision cutoff')
    bad=[]; frozen=[]
    for r in rows:
        t=iso(r.get('_firstObservedTimestampUTC') or r.get('_snapshotTimestampUTC'))
        if t is None or t>cutoff:
            bad.append(str(r.get('Ticker') or '?')); continue
        frozen.append({
            'symbol':str(r.get('Ticker') or '').upper(),
            'firstObservedUTC':t.isoformat(),
            'price':r.get('Price'),'change':r.get('Change'),'volume':r.get('Volume'),
            'avgVolume':r.get('Avg Volume'),'relativeVolume':r.get('Rel Volume'),
            'float':r.get('Float'),'shortFloat':r.get('Short Float'),
            'lanes':r.get('_discoveryLanes') or [],'signals':r.get('_signals') or []
        })
    frozen=[x for x in frozen if x['symbol']]; frozen.sort(key=lambda x:x['symbol'])
    if not frozen:raise SystemExit('no causally eligible symbols')
    out=ROOT/f'{day}.json'
    if out.exists():raise SystemExit(f'immutable snapshot already exists: {out}')
    payload={
      'schemaVersion':'forward-freeze-v1','evaluationOnly':True,'trainingEligible':False,
      'dayET':day,'decisionCutoffET':'09:15:00','frozenAtUTC':now.isoformat(),'frozenAtET':local.isoformat(),
      'sourcePath':str(SRC),'sourceTimestampUTC':src_ts.isoformat(),'sourceDeclaredCount':src.get('count'),
      'eligibleCount':len(frozen),'rejectedLateOrUnknownCount':len(bad),'rejectedSymbols':bad[:50],
      'previousSnapshotHash':previous_hash(day),'universe':frozen,
      'antiLeakage':['freeze occurs <=09:15 ET','row first-observed timestamp must be <=09:15 ET','no outcomes/calibration accepted','snapshot immutable','daily snapshot hash chained']
    }
    payload['snapshotHash']=sha(payload)
    ROOT.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'status':'FROZEN','path':str(out),'eligibleCount':len(frozen),'rejected':len(bad),'snapshotHash':payload['snapshotHash']},indent=2))
if __name__=='__main__':main()
