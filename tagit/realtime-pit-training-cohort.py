#!/usr/bin/env python3
import argparse, hashlib, json, math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tag' / 'data'
OUT = DATA / 'realtime-training'


def load(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return default


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def ts(s):
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def finite(x):
    try:
        return x is not None and math.isfinite(float(x))
    except Exception:
        return False


def sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def quote_price(q):
    for k in ('price', 'preMarketPrice', 'regularMarketPrice', 'afterHoursPrice'):
        if finite(q.get(k)):
            return float(q[k])
    return None


def feature_record(symbol, sig, q, capture_at, session, source_hashes):
    flags = sig.get('featureFlags') or {}
    src = sig.get('sourceEvidence') or {}
    return {
        'schemaVersion': 1,
        'symbol': symbol,
        'capturedAtUTC': capture_at,
        'session': session,
        'featureTimestampUTC': q.get('timestampUTC') or q.get('timestampET') or src.get('timestamp') or capture_at,
        'featureSnapshotHash': None,
        'sourceHashes': source_hashes,
        'selection': {
            'state': sig.get('state'),
            'candidateState': sig.get('candidateState'),
            'phase': sig.get('phase'),
            'score': sig.get('score'),
            'actionability': sig.get('actionability'),
            'precursorScore': sig.get('precursorScore'),
            'continuationScore': sig.get('continuationScore'),
            'tradabilityScore': sig.get('tradabilityScore'),
            'riskScore': sig.get('riskScore'),
            'dataQualityScore': sig.get('dataQualityScore'),
            'executionVerified': bool(sig.get('executionVerified')),
        },
        'finviz': {
            'rvolFlag': flags.get('rvol'),
            'volumeVelocityFlag': flags.get('volumeVelocity'),
            'microMomentumFlag': flags.get('microMomentum'),
            'floatFlag': flags.get('float'),
            'dilutionFlag': flags.get('dilution'),
            'catalystType': (sig.get('catalystShadow') or {}).get('type'),
            'catalystMateriality': (sig.get('catalystShadow') or {}).get('materiality'),
            'catalystConfidence': (sig.get('catalystShadow') or {}).get('confidence'),
        },
        'quote': {
            'price': quote_price(q),
            'changePct': q.get('changePct'),
            'preMarketChangePct': q.get('preMarketChangePct'),
            'afterHoursChangePct': q.get('afterHoursChangePct'),
            'quoteAgeMin': q.get('quoteAgeMin'),
            'priceVelocity5mPct': q.get('priceVelocity5mPct'),
            'priceVelocity15mPct': q.get('priceVelocity15mPct'),
            'priceVelocity30mPct': q.get('priceVelocity30mPct'),
            'volume5m': q.get('volume5m'),
            'volume15m': q.get('volume15m'),
            'volumeAcceleration5m': q.get('volumeAcceleration5m'),
            'volumeAcceleration15m': q.get('volumeAcceleration15m'),
            'preMarketVolume': q.get('preMarketVolume'),
            'afterHoursVolume': q.get('afterHoursVolume'),
            'universeLane': q.get('universeLane'),
        },
        'labels': {},
        'labelPolicy': {
            'horizonsMin': [30, 60, 120],
            'targetReturnPct': [5, 10, 20],
            'featureFreeze': 'capturedAtUTC',
            'labelSource': 'subsequent live-quotes snapshots only',
            'noSameSnapshotOutcome': True,
        }
    }


def capture():
    quotes = load(DATA / 'live-quotes.json', {}) or {}
    feed = load(DATA / 'tagit-signal-feed.json', {}) or {}
    radar = load(DATA / 'tagit-view.json', {}) or {}
    qmap = quotes.get('quotes') or {}
    fitems = {str(x.get('symbol','')).upper(): x for x in (feed.get('items') or []) if x.get('symbol')}
    ritems = {str(x.get('symbol','')).upper(): x for x in (radar.get('items') or []) if x.get('symbol')}
    capture_at = quotes.get('updatedAtUTC') or feed.get('updatedAt') or iso_now()
    session = quotes.get('marketClockSession') or feed.get('session') or 'unknown'
    # Candidate universe is point-in-time and intentionally broad: all signal-feed names plus top radar names
    symbols = list(dict.fromkeys(list(fitems.keys()) + list(ritems.keys())[:100]))
    source_hashes = {
        'liveQuotes': sha(quotes),
        'signalFeed': sha(feed),
        'radar': sha(radar),
    }
    date = str(capture_at)[:10]
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{date}.jsonl'
    existing = set()
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                r = json.loads(line); existing.add((r.get('capturedAtUTC'), r.get('symbol')))
            except Exception: pass
    added = 0
    with path.open('a') as fh:
        for symbol in symbols:
            if (capture_at, symbol) in existing: continue
            q = qmap.get(symbol) or {}
            sig = fitems.get(symbol) or ritems.get(symbol) or {'symbol': symbol, 'state': 'RADAR'}
            rec = feature_record(symbol, sig, q, capture_at, session, source_hashes)
            frozen = {k:v for k,v in rec.items() if k not in ('labels','featureSnapshotHash')}
            rec['featureSnapshotHash'] = sha(frozen)
            fh.write(json.dumps(rec, separators=(',', ':')) + '\n')
            added += 1
    print(json.dumps({'mode':'capture','file':str(path.relative_to(ROOT)),'capturedAtUTC':capture_at,'session':session,'symbols':len(symbols),'added':added}, indent=2))


def label():
    quotes = load(DATA / 'live-quotes.json', {}) or {}
    now_at = quotes.get('updatedAtUTC') or iso_now()
    now_ts = ts(now_at)
    qmap = quotes.get('quotes') or {}
    updated = 0
    OUT.mkdir(parents=True, exist_ok=True)
    for path in sorted(OUT.glob('*.jsonl'))[-4:]:
        rows=[]; changed=False
        for line in path.read_text().splitlines():
            try: rec=json.loads(line)
            except Exception: continue
            base_ts=ts(rec.get('capturedAtUTC')); base_price=(rec.get('quote') or {}).get('price'); q=qmap.get(rec.get('symbol')) or {}; px=quote_price(q)
            if not (finite(base_price) and finite(px) and base_ts and now_ts and now_ts>base_ts):
                rows.append(rec); continue
            elapsed=(now_ts-base_ts)/60.0
            for h in (30,60,120):
                key=str(h)
                if key in (rec.get('labels') or {}): continue
                # Assign at first available observation at/after horizon, with tolerance to avoid grossly delayed labels.
                if elapsed >= h and elapsed <= h+20:
                    ret=(float(px)/float(base_price)-1)*100
                    rec.setdefault('labels',{})[key]={
                        'labeledAtUTC': now_at,
                        'elapsedMin': round(elapsed,2),
                        'price': px,
                        'returnPct': round(ret,4),
                        'hit5': ret>=5,
                        'hit10': ret>=10,
                        'hit20': ret>=20,
                        'sourceQuoteTimestamp': q.get('timestampUTC') or q.get('timestampET'),
                    }
                    changed=True; updated+=1
            rows.append(rec)
        if changed:
            path.write_text('\n'.join(json.dumps(r,separators=(',',':')) for r in rows)+'\n')
    print(json.dumps({'mode':'label','labeledAtUTC':now_at,'labelsAdded':updated}, indent=2))


def summarize():
    total=labeled30=hits20=0; days=set(); states={}
    for path in OUT.glob('*.jsonl'):
        for line in path.read_text().splitlines():
            try:r=json.loads(line)
            except Exception:continue
            total+=1; days.add(str(r.get('capturedAtUTC'))[:10]); st=str((r.get('selection') or {}).get('state') or 'UNKNOWN'); states[st]=states.get(st,0)+1
            lab=(r.get('labels') or {}).get('30')
            if lab:
                labeled30+=1; hits20+=int(bool(lab.get('hit20')))
    report={'schemaVersion':1,'updatedAtUTC':iso_now(),'records':total,'activeDays':len(days),'states':states,'labeled30':labeled30,'hit20_30m':hits20,'precision20Pct':round(100*hits20/labeled30,2) if labeled30 else None,'claimScope':'forward point-in-time cohort only; not market-wide precision'}
    (DATA/'tagit-realtime-cohort-summary.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('mode', choices=['capture','label','summarize','all'], nargs='?', default='all'); a=ap.parse_args()
    if a.mode in ('capture','all'): capture()
    if a.mode in ('label','all'): label()
    if a.mode in ('summarize','all'): summarize()
