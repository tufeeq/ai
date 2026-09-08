#!/usr/bin/env python3
"""TAGit forward-only point-in-time freeze ledger.

Creates one immutable daily universe snapshot only during 08:55-09:15 America/New_York.
The source snapshot must be from the same ET session, fresh, pre-market, and every row must
have been observed before the 09:15 decision cutoff. Each snapshot is cryptographically bound
to the already-frozen model/training provenance. Snapshots are hash chained and never
overwritten. This lane is evaluation-only: no outcome, calibration, threshold or future-session
data is accepted here.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
UTC = dt.timezone.utc
ROOT = pathlib.Path('tag/data/forward')
SRC = pathlib.Path('tag/data/discovery.json')
FREEZE_REPORT = pathlib.Path('tag/data/tagit-v514-freeze-report.json')
CUT = dt.time(9, 15)
START = dt.time(8, 55)
MAX_SOURCE_AGE_MIN = 45.0


def iso(value):
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(UTC)
    except Exception:
        return None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def previous_hash(day):
    if not ROOT.exists():
        return None
    files = sorted(p for p in ROOT.glob('*.json') if p.stem < day and p.name != 'ledger.json')
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text()).get('snapshotHash')
    except Exception:
        return None


def load_model_provenance(path, day):
    if not path.exists():
        raise SystemExit(f'missing frozen-model report: {path}')
    report = json.loads(path.read_text())
    if report.get('status') != 'FROZEN_FORWARD_MODEL_CREATED':
        raise SystemExit('forward freeze refused: frozen-model report is not READY')
    cutoff = str(report.get('trainingCutoffDate') or '')
    if not cutoff or cutoff >= day:
        raise SystemExit(f'forward freeze refused: target day {day} is not strictly after training cutoff {cutoff or "UNKNOWN"}')
    required = ('modelPath', 'modelPayloadSha256', 'trainingDataSha256', 'featurePipelineSourceSha256')
    missing = [k for k in required if not report.get(k)]
    if missing:
        raise SystemExit(f'forward freeze refused: model provenance missing {missing}')
    config = report.get('selectedConfig')
    if not isinstance(config, dict) or not config:
        raise SystemExit('forward freeze refused: frozen selectedConfig missing')
    return {
        'freezeReportSchema': report.get('schemaVersion'),
        'modelPath': report['modelPath'],
        'modelPayloadSha256': report['modelPayloadSha256'],
        'trainingDataSha256': report['trainingDataSha256'],
        'featurePipelineSourceSha256': report['featurePipelineSourceSha256'],
        'trainingCutoffDate': cutoff,
        'selectedConfig': config,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--audit-only', action='store_true')
    ap.add_argument('--source', default=str(SRC))
    ap.add_argument('--freeze-report', default=str(FREEZE_REPORT))
    ap.add_argument('--max-source-age-min', type=float, default=MAX_SOURCE_AGE_MIN)
    args = ap.parse_args()

    source_path = pathlib.Path(args.source)
    freeze_path = pathlib.Path(args.freeze_report)
    now = dt.datetime.now(UTC)
    local = now.astimezone(NY)
    day = local.date().isoformat()
    cutoff_utc = dt.datetime.combine(local.date(), CUT, NY).astimezone(UTC)
    window = START <= local.time().replace(tzinfo=None) <= CUT

    if not source_path.exists():
        raise SystemExit(f'missing discovery source: {source_path}')
    src = json.loads(source_path.read_text())
    rows = src.get('rows') or []
    src_ts = iso(src.get('snapshotTimestampUTC') or src.get('updatedAt'))
    src_local = src_ts.astimezone(NY) if src_ts else None
    source_age_min = ((now - src_ts).total_seconds() / 60.0) if src_ts else None
    source_session = str(src.get('session') or '').strip().lower()

    audit = {
        'nowUTC': now.isoformat(),
        'nowET': local.isoformat(),
        'windowOpen': window,
        'sourceTimestampUTC': src_ts.isoformat() if src_ts else None,
        'sourceDateET': src_local.date().isoformat() if src_local else None,
        'sourceAgeMin': round(source_age_min, 2) if source_age_min is not None else None,
        'sourceSession': source_session or None,
        'sourceCount': len(rows),
        'frozenModelReport': str(freeze_path),
    }
    if args.audit_only:
        try:
            audit['modelProvenance'] = load_model_provenance(freeze_path, day)
        except SystemExit as exc:
            audit['modelProvenanceError'] = str(exc)
        print(json.dumps(audit, indent=2))
        return

    if not window:
        raise SystemExit(f'freeze refused outside 08:55-09:15 ET: {local.isoformat()}')
    if src_ts is None:
        raise SystemExit('forward freeze refused: source timestamp missing or timezone-invalid')
    if src_local.date() != local.date():
        raise SystemExit(f'forward freeze refused: stale cross-day source ({src_local.date()} != {local.date()})')
    if src_ts > cutoff_utc:
        raise SystemExit('forward freeze refused: source timestamp after decision cutoff')
    if source_age_min < -1:
        raise SystemExit('forward freeze refused: source timestamp is in the future')
    if source_age_min > args.max_source_age_min:
        raise SystemExit(f'forward freeze refused: source is {source_age_min:.1f} minutes old (max {args.max_source_age_min:.1f})')
    if source_session != 'pre-market':
        raise SystemExit(f'forward freeze refused: source session must be pre-market, got {source_session or "UNKNOWN"}')
    if not isinstance(rows, list) or not rows:
        raise SystemExit('forward freeze refused: discovery universe is empty')

    provenance = load_model_provenance(freeze_path, day)
    bad = []
    frozen = []
    seen = set()
    duplicates = []
    for row in rows:
        symbol = str(row.get('Ticker') or '').strip().upper()
        if not symbol:
            bad.append('?')
            continue
        if symbol in seen:
            duplicates.append(symbol)
            continue
        seen.add(symbol)
        first_seen = iso(row.get('_firstObservedTimestampUTC') or row.get('_snapshotTimestampUTC'))
        if first_seen is None or first_seen > cutoff_utc:
            bad.append(symbol)
            continue
        frozen.append({
            'symbol': symbol,
            'firstObservedUTC': first_seen.isoformat(),
            'price': row.get('Price'),
            'change': row.get('Change'),
            'volume': row.get('Volume'),
            'avgVolume': row.get('Avg Volume'),
            'relativeVolume': row.get('Rel Volume'),
            'float': row.get('Float'),
            'shortFloat': row.get('Short Float'),
            'lanes': row.get('_discoveryLanes') or [],
            'signals': row.get('_signals') or [],
        })

    if duplicates:
        raise SystemExit(f'forward freeze refused: duplicate symbols in source: {duplicates[:20]}')
    frozen.sort(key=lambda x: x['symbol'])
    if not frozen:
        raise SystemExit('forward freeze refused: no causally eligible symbols')

    out = ROOT / f'{day}.json'
    if out.exists():
        raise SystemExit(f'immutable snapshot already exists: {out}')

    payload = {
        'schemaVersion': 'forward-freeze-v2-model-bound',
        'evaluationOnly': True,
        'trainingEligible': False,
        'dayET': day,
        'decisionCutoffET': '09:15:00',
        'frozenAtUTC': now.isoformat(),
        'frozenAtET': local.isoformat(),
        'source': {
            'path': str(source_path),
            'timestampUTC': src_ts.isoformat(),
            'dateET': src_local.date().isoformat(),
            'session': source_session,
            'ageMinAtFreeze': round(source_age_min, 3),
            'declaredCount': src.get('count'),
        },
        'modelProvenance': provenance,
        'eligibleCount': len(frozen),
        'rejectedLateOrUnknownCount': len(bad),
        'rejectedSymbols': bad[:50],
        'previousSnapshotHash': previous_hash(day),
        'universe': frozen,
        'antiLeakage': [
            'freeze occurs only 08:55-09:15 ET',
            'source must be same ET date, pre-market, and <=45 minutes old',
            'row first-observed timestamp must be <=09:15 ET',
            'target session must be strictly after frozen-model training cutoff',
            'snapshot is bound to exact model/training/pipeline hashes and selected config',
            'duplicate symbols and empty universes fail closed',
            'no outcomes/calibration accepted',
            'snapshot immutable and daily snapshots hash chained',
        ],
    }
    payload['snapshotHash'] = sha(payload)
    ROOT.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({
        'status': 'FROZEN',
        'path': str(out),
        'eligibleCount': len(frozen),
        'rejected': len(bad),
        'modelPayloadSha256': provenance['modelPayloadSha256'],
        'sourceAgeMin': round(source_age_min, 2),
        'snapshotHash': payload['snapshotHash'],
    }, indent=2))


if __name__ == '__main__':
    main()
