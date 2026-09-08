#!/usr/bin/env python3
import argparse, hashlib, json, math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tag' / 'data'
OUT = DATA / 'realtime-training'
ACTIVE_SESSIONS = {'pre-market', 'regular', 'after-hours'}


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


def five_min_bucket(value):
    stamp = ts(value)
    if stamp is None:
        return str(value)
    bucket = int(stamp // 300) * 300
    return datetime.fromtimestamp(bucket, timezone.utc).isoformat()


def live_quote_ok(q, session):
    if not q or not finite(quote_price(q)):
        return False
    if session in ACTIVE_SESSIONS:
        if q.get('session') != session:
            return False
        age = q.get('quoteAgeMin')
        if not finite(age) or float(age) > 4.0:
            return False
    return True


def fallback_signal(symbol, q):
    ignition = q.get('ignitionScore') or 0
    accumulation = bool(q.get('liquidityAccumulation'))
    return {
        'symbol': symbol,
        'state': 'LIVE_ONLY',
        'candidateState': 'OBSERVE',
        'phase': 'IGNITION' if ignition >= 70 else ('ACCUMULATION' if accumulation else 'ANOMALY'),
        'score': q.get('earlyRegimeShiftScore'),
        'actionability': q.get('ignitionScore'),
        'precursorScore': q.get('accumulationScore'),
        'continuationScore': q.get('priceVelocity15mPct'),
        'tradabilityScore': 100 if finite(q.get('price')) else 0,
        'riskScore': None,
        'dataQualityScore': 90 if finite(q.get('quoteAgeMin')) and float(q.get('quoteAgeMin')) <= 3 else 75,
        'executionVerified': False,
        'featureFlags': {
            'rvol': 'UNKNOWN',
            'volumeVelocity': 'ACCELERATING' if finite(q.get('volumeAcceleration5m')) and float(q.get('volumeAcceleration5m')) >= 1.8 else 'NORMAL',
            'microMomentum': 'CONSISTENT_UP' if finite(q.get('priceVelocity5mPct')) and float(q.get('priceVelocity5mPct')) > 0 else 'MIXED',
            'float': 'AVAILABLE' if finite(q.get('floatM')) else 'UNKNOWN',
            'dilution': 'UNKNOWN',
        },
        'catalystShadow': {},
        'sourceEvidence': {'provider': 'live-quotes', 'timestamp': q.get('timestampUTC') or q.get('timestampET')},
    }


def feature_record(symbol, sig, q, capture_at, session, source_hashes, cohort_role):
    flags = sig.get('featureFlags') or {}
    src = sig.get('sourceEvidence') or {}
    return {
        'schemaVersion': 2,
        'symbol': symbol,
        'capturedAtUTC': capture_at,
        'captureBucketUTC': five_min_bucket(capture_at),
        'session': session,
        'cohortRole': cohort_role,
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
            'range15mPct': q.get('range15mPct'),
            'range30mPct': q.get('range30mPct'),
            'volume5m': q.get('volume5m'),
            'volume15m': q.get('volume15m'),
            'volumeAcceleration5m': q.get('volumeAcceleration5m'),
            'volumeAcceleration15m': q.get('volumeAcceleration15m'),
            'relativeVolume': q.get('relativeVolume'),
            'turnover5mPctFloat': q.get('turnover5mPctFloat'),
            'turnover15mPctFloat': q.get('turnover15mPctFloat'),
            'liquidityAccumulation': q.get('liquidityAccumulation'),
            'accumulationScore': q.get('accumulationScore'),
            'earlyRegimeShiftScore': q.get('earlyRegimeShiftScore'),
            'ignitionScore': q.get('ignitionScore'),
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
    bucket = five_min_bucket(capture_at)

    # Keep only symbols with a genuinely observable live price at feature-freeze time.
    eligible = {s:q for s,q in qmap.items() if live_quote_ok(q, session)}

    priority = []
    for row in (quotes.get('emergingCandidates') or []) + (quotes.get('accumulationCandidates') or []):
        s = str(row.get('ticker') or row.get('symbol') or '').upper()
        if s in eligible and s not in priority:
            priority.append(s)

    feed_live = [s for s in fitems if s in eligible and s not in priority]
    feed_live.sort(key=lambda s: (
        float(fitems[s].get('precursorScore') or 0),
        float(fitems[s].get('actionability') or 0),
        float(fitems[s].get('score') or 0),
    ), reverse=True)
    ranked = feed_live[:70]

    remaining = [s for s in eligible if s not in priority and s not in ranked]
    # Deterministic daily control sample so failures/quiet names remain represented without exploding file size.
    remaining.sort(key=lambda s: sha({'day': str(capture_at)[:10], 'symbol': s}))
    controls = remaining[:50]

    roles = {}
    for s in priority: roles[s] = 'PRIORITY_LIVE'
    for s in ranked: roles[s] = 'RANKED_SIGNAL'
    for s in controls: roles[s] = 'CONTROL'
    symbols = list(roles)

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
                r = json.loads(line)
                existing.add((r.get('captureBucketUTC') or five_min_bucket(r.get('capturedAtUTC')), r.get('symbol')))
            except Exception:
                pass

    added = 0
    with path.open('a') as fh:
        for symbol in symbols:
            if (bucket, symbol) in existing:
                continue
            q = eligible[symbol]
            sig = fitems.get(symbol) or ritems.get(symbol) or fallback_signal(symbol, q)
            rec = feature_record(symbol, sig, q, capture_at, session, source_hashes, roles[symbol])
            frozen = {k:v for k,v in rec.items() if k not in ('labels','featureSnapshotHash')}
            rec['featureSnapshotHash'] = sha(frozen)
            fh.write(json.dumps(rec, separators=(',', ':')) + '\n')
            added += 1

    print(json.dumps({
        'mode':'capture', 'file':str(path.relative_to(ROOT)), 'capturedAtUTC':capture_at,
        'captureBucketUTC':bucket, 'session':session, 'eligibleLive':len(eligible),
        'priority':len(priority), 'ranked':len(ranked), 'controls':len(controls),
        'symbols':len(symbols), 'added':added
    }, indent=2))


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
            try:
                rec=json.loads(line)
            except Exception:
                continue
            base_ts=ts(rec.get('capturedAtUTC'))
            base_price=(rec.get('quote') or {}).get('price')
            q=qmap.get(rec.get('symbol')) or {}
            px=quote_price(q)
            if not (finite(base_price) and finite(px) and base_ts and now_ts and now_ts>base_ts):
                rows.append(rec)
                continue
            elapsed=(now_ts-base_ts)/60.0
            for h in (30,60,120):
                key=str(h)
                if key in (rec.get('labels') or {}):
                    continue
                # Assign only at the first reasonably close observation after each horizon.
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
    total=trainable=invalid_price=0
    days=set(); states={}; candidate_states={}; roles={}
    horizon_counts={'30':0,'60':0,'120':0}
    hits={'30':{'5':0,'10':0,'20':0},'60':{'5':0,'10':0,'20':0},'120':{'5':0,'10':0,'20':0}}
    for path in OUT.glob('*.jsonl'):
        for line in path.read_text().splitlines():
            try:
                r=json.loads(line)
            except Exception:
                continue
            total+=1
            days.add(str(r.get('capturedAtUTC'))[:10])
            st=str((r.get('selection') or {}).get('state') or 'UNKNOWN'); states[st]=states.get(st,0)+1
            cs=str((r.get('selection') or {}).get('candidateState') or 'UNKNOWN'); candidate_states[cs]=candidate_states.get(cs,0)+1
            role=str(r.get('cohortRole') or 'LEGACY'); roles[role]=roles.get(role,0)+1
            if finite((r.get('quote') or {}).get('price')):
                trainable+=1
            else:
                invalid_price+=1
            labs=r.get('labels') or {}
            for h in ('30','60','120'):
                lab=labs.get(h)
                if not lab:
                    continue
                horizon_counts[h]+=1
                for target in ('5','10','20'):
                    hits[h][target]+=int(bool(lab.get('hit'+target)))

    rates={}
    for h,count in horizon_counts.items():
        rates[h]={target:(round(100*hits[h][target]/count,2) if count else None) for target in ('5','10','20')}

    report={
        'schemaVersion':2,
        'updatedAtUTC':iso_now(),
        'records':total,
        'trainableRecords':trainable,
        'invalidLegacyNoPrice':invalid_price,
        'activeDays':len(days),
        'states':states,
        'candidateStates':candidate_states,
        'cohortRoles':roles,
        'labeled':horizon_counts,
        'hitRatesPct':rates,
        'labeled30':horizon_counts['30'],
        'hit20_30m':hits['30']['20'],
        'precision20Pct':rates['30']['20'],
        'validity':'FORWARD_PIT_TRAINABLE' if trainable else 'NO_TRAINABLE_RECORDS',
        'claimScope':'forward point-in-time cohort only; hit rates are cohort diagnostics, not market-wide precision'
    }
    (DATA/'tagit-realtime-cohort-summary.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('mode', choices=['capture','label','summarize','all'], nargs='?', default='all')
    a=ap.parse_args()
    if a.mode in ('capture','all'): capture()
    if a.mode in ('label','all'): label()
    if a.mode in ('summarize','all'): summarize()
