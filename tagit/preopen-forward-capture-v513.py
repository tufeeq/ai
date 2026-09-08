#!/usr/bin/env python3
"""Capture an append-only point-in-time pre-open universe/context snapshot.

The collector refuses stale source snapshots and refuses to write outside the
09:05-09:25 ET capture window unless --dry-run is used. It never creates labels.
"""
import argparse, json, math
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('tag/data')
DISC=ROOT/'discovery.json'
ENR=ROOT/'enrichment.json'
LEDGER=ROOT/'tagit-v513-preopen-forward-ledger.json'
NY=ZoneInfo('America/New_York')


def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def parse_dt(s):
    if not s:return None
    try:return datetime.fromisoformat(str(s).replace('Z','+00:00'))
    except Exception:return None

def num(v):
    if v is None:return None
    try:
        s=str(v).replace('%','').replace(',','').strip()
        return float(s) if s else None
    except Exception:return None

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dry-run',action='store_true'); args=ap.parse_args()
    now=datetime.now(timezone.utc); et=now.astimezone(NY); minute=et.hour*60+et.minute
    d=readj(DISC,{}); e=readj(ENR,{})
    snap=parse_dt(d.get('snapshotTimestampUTC') or d.get('updatedAt'))
    age_min=(now-snap.astimezone(timezone.utc)).total_seconds()/60 if snap else None
    within=545<=minute<=565  # 09:05-09:25 ET
    fresh=age_min is not None and -2<=age_min<=35
    status='ELIGIBLE' if within and fresh else ('OUTSIDE_CAPTURE_WINDOW' if not within else 'STALE_DISCOVERY_SOURCE')
    rows=[]; erows=e.get('rows') or {}
    for r in d.get('rows') or []:
        sym=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
        if not sym:continue
        x=erows.get(sym) or {}
        news=[]
        for n in x.get('news') or []:
            pd=parse_dt(n.get('published'))
            if pd and pd.astimezone(timezone.utc)<=now:
                news.append({'title':n.get('title'),'published':n.get('published'),'source':n.get('source')})
        filings=[]
        for f in x.get('filings') or []:
            fd=parse_dt(f.get('filedAtUTC') or f.get('timestampUTC') or f.get('filed'))
            if fd is None or fd.astimezone(timezone.utc)<=now:
                filings.append({k:f.get(k) for k in ('form','filed','filedAtUTC','accessionNumber') if k in f})
        rows.append({
            'ticker':sym,'price':num(r.get('Price')),'changePct':num(r.get('Change')),
            'volume':num(r.get('Volume')),'avgVolume':num(r.get('Avg Volume')),'relativeVolume':num(r.get('Rel Volume')),
            'floatM':num(r.get('Float')),'outstandingM':num(r.get('Outstanding')),'shortFloatPct':num(r.get('Short Float')),
            'firstObservedUTC':r.get('_firstObservedTimestampUTC'),'firstObservedChangePct':num(r.get('_firstObservedChange')),
            'originClass':r.get('_originClass'),'lanes':r.get('_discoveryLanes') or [],
            'newsKnownAtCapture':news[:8],'filingsKnownAtCapture':filings[:8],
            'contextErrors':x.get('errors') or []
        })
    entry={'captureId':f"{et.date().isoformat()}|09:15|{now.strftime('%Y%m%dT%H%M%SZ')}",
           'capturedAtUTC':now.isoformat(),'capturedAtET':et.isoformat(),'targetCutoffET':'09:15',
           'sourceSnapshotUTC':snap.isoformat() if snap else None,'sourceAgeMinutes':round(age_min,2) if age_min is not None else None,
           'status':status,'universeCount':len(rows),'rows':rows if status=='ELIGIBLE' else [],
           'labelsPresent':False,'pointInTime':bool(status=='ELIGIBLE')}
    ledger=readj(LEDGER,{'schemaVersion':'5.13-forward-ledger','policy':'APPEND_ONLY_POINT_IN_TIME_NO_LABELS_AT_CAPTURE','captures':[]})
    print(json.dumps({**entry,'rows':f'<{len(entry["rows"])} rows>'},ensure_ascii=False,indent=2))
    if args.dry_run:return
    if status!='ELIGIBLE':
        raise SystemExit(f'capture refused: {status}; sourceAgeMinutes={age_min}')
    seen={c.get('captureId') for c in ledger.get('captures') or []}
    if entry['captureId'] not in seen:ledger.setdefault('captures',[]).append(entry)
    LEDGER.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':main()
