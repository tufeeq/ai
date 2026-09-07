#!/usr/bin/env python3
"""TAGit v5.10 point-in-time forward context ledger.

Captures only information present in repository snapshots at run time. It never rewrites
past observations and is intentionally NOT used to backfill historical features.
This creates leakage-safe future training data for float/short/catalyst/context models.
"""
import json, pathlib
from datetime import datetime, timezone

ROOT=pathlib.Path('tag/data')
DISCOVERY=ROOT/'discovery.json'
ENRICH=ROOT/'enrichment.json'
LEDGER=ROOT/'tagit-forward-context-ledger.json'


def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def fnum(v):
    try:
        if v is None:return None
        s=str(v).replace('%','').replace(',','').strip()
        return float(s) if s else None
    except Exception:return None

def iso(v):
    if not v:return None
    try:
        s=str(v).replace('Z','+00:00')
        dt=datetime.fromisoformat(s)
        if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:return None

def news_before(rows,cutoff):
    out=[]
    for n in rows or []:
        # RFC822 timestamps from Google RSS are preserved as raw evidence; no historical inference.
        out.append({'title':n.get('title'),'published':n.get('published'),'source':n.get('source'),'url':n.get('url')})
    return out[:12]

disc=readj(DISCOVERY,{})
enr=readj(ENRICH,{})
now=datetime.now(timezone.utc).isoformat()
snapshot=iso(disc.get('snapshotTimestampUTC')) or iso(disc.get('updatedAt')) or now
rows={}
for r in disc.get('rows') or []:
    s=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
    if not s:continue
    rows[s]={
        'symbol':s,
        'snapshotTimestampUTC':snapshot,
        'price':fnum(r.get('Price')),
        'changePct':fnum(r.get('Change')),
        'volume':fnum(r.get('Volume')),
        'avgVolume':fnum(r.get('Avg Volume')),
        'relativeVolume':fnum(r.get('Rel Volume')),
        'marketCap':fnum(r.get('Market Cap')),
        'float':fnum(r.get('Float')),
        'outstanding':fnum(r.get('Outstanding')),
        'shortFloatPct':fnum(r.get('Short Float')),
        'sector':r.get('Sector'),'industry':r.get('Industry'),'country':r.get('Country'),
        'firstObservedTimestampUTC':iso(r.get('_firstObservedTimestampUTC')),
        'originClass':r.get('_originClass'),
        'discoveryLanes':r.get('_discoveryLanes') or [],
        'news':[], 'filings':[], 'contextSourceStatus':{}
    }
for s,z in (enr.get('rows') or {}).items():
    s=str(s).upper().strip()
    if s not in rows:continue
    rows[s]['news']=news_before(z.get('news'),snapshot)
    rows[s]['filings']=[{k:f.get(k) for k in ('form','filingDate','reportDate','accessionNumber','primaryDocument')} for f in (z.get('filings') or [])[:12]]
    rows[s]['contextSourceStatus']={'errors':z.get('errors') or [],'identityAvailable':bool(z.get('identity')),'shortDataAvailable':bool(z.get('shortData'))}

ledger=readj(LEDGER,{'schemaVersion':'5.10-forward-context-ledger','policy':'APPEND_ONLY_POINT_IN_TIME_NO_BACKFILL','snapshots':[]})
if ledger.get('policy')!='APPEND_ONLY_POINT_IN_TIME_NO_BACKFILL':
    raise RuntimeError('Refusing to modify ledger with incompatible policy')
# Idempotent by snapshot timestamp. Never replace an existing historical snapshot.
existing={str(x.get('snapshotTimestampUTC')) for x in ledger.get('snapshots') or []}
if snapshot not in existing:
    ledger.setdefault('snapshots',[]).append({'capturedAtUTC':now,'snapshotTimestampUTC':snapshot,'sourceDiscoveryUpdatedAt':disc.get('updatedAt'),'sourceEnrichmentUpdatedAt':enr.get('updatedAt'),'symbols':rows})
ledger['snapshots']=sorted(ledger.get('snapshots') or [],key=lambda x:str(x.get('snapshotTimestampUTC')))
ledger['latestCaptureUTC']=now
ledger['snapshotCount']=len(ledger['snapshots'])
ledger['symbolObservationCount']=sum(len(x.get('symbols') or {}) for x in ledger['snapshots'])
LEDGER.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'snapshotTimestampUTC':snapshot,'symbols':len(rows),'snapshotCount':ledger['snapshotCount'],'symbolObservationCount':ledger['symbolObservationCount']},indent=2))
