#!/usr/bin/env python3
import json
import pathlib

DATA = pathlib.Path('tag/data/finviz.json')
HIST = pathlib.Path('tag/data/snapshots.json')


def norm(v):
    return '' if v is None else str(v).strip()


def main():
    if not DATA.exists() or not HIST.exists():
        return
    payload = json.loads(DATA.read_text(encoding='utf-8'))
    hist = json.loads(HIST.read_text(encoding='utf-8'))

    if payload.get('session') != 'after-hours':
        return

    bucket = payload.get('sessionBucket') or ''
    day = str(payload.get('snapshotTimestampET', ''))[:10]
    try:
        bucket_n = int(bucket.replace('AH', ''))
    except Exception:
        bucket_n = 0

    state = 'UNVERIFIED_EXTENDED_HOURS_FIELDS'
    evidence = {
        'method': 'CROSS_BUCKET_CHANGE_VOLUME_FREEZE_TEST',
        'currentBucket': bucket,
        'previousBucket': None,
        'commonTickersTested': 0,
        'identicalChangeAndVolumeCount': 0,
        'freezeRatio': None,
        'threshold': 0.80,
        'minimumCommonTickers': 10,
    }

    if bucket_n > 1:
        prev_bucket = f'AH{bucket_n - 1}'
        evidence['previousBucket'] = prev_bucket
        prev = next((
            s for s in reversed(hist)
            if str(s.get('timestampET', ''))[:10] == day
            and s.get('session') == 'after-hours'
            and s.get('sessionBucket') == prev_bucket
        ), None)
        if prev:
            prev_map = {(m.get('Ticker') or '').upper(): m for m in prev.get('topMovers', [])}
            current = payload.get('rows') or payload.get('data') or []
            tested = []
            same = 0
            for m in current[:40]:
                t = (m.get('Ticker') or '').upper()
                p = prev_map.get(t)
                if not p:
                    continue
                tested.append(t)
                if norm(m.get('Change')) == norm(p.get('Change')) and norm(m.get('Volume')) == norm(p.get('Volume')):
                    same += 1
                if len(tested) >= 25:
                    break
            ratio = (same / len(tested)) if tested else None
            evidence['commonTickersTested'] = len(tested)
            evidence['identicalChangeAndVolumeCount'] = same
            evidence['freezeRatio'] = round(ratio, 4) if ratio is not None else None
            if len(tested) >= 10 and ratio is not None and ratio >= 0.80:
                state = 'SOURCE_FIELD_FREEZE_SUSPECTED'
            elif len(tested) >= 10:
                state = 'CROSS_BUCKET_FIELDS_MOVING'
            else:
                state = 'INSUFFICIENT_CROSS_BUCKET_SAMPLE'

    payload['extendedHoursFieldIntegrityState'] = state
    payload['extendedHoursFieldIntegrityEvidence'] = evidence
    payload['afterHoursVolumeParticipationEligible'] = False
    payload['extendedHoursVolumeTakeoverEligible'] = False

    # TAG5 may store regular-session fields in Finviz during AH. Never allow those
    # values to masquerade as AH persistence until an AH-native field source is verified.
    block = state in {
        'UNVERIFIED_EXTENDED_HOURS_FIELDS',
        'SOURCE_FIELD_FREEZE_SUSPECTED',
        'INSUFFICIENT_CROSS_BUCKET_SAMPLE',
    }
    if block:
        payload['persistenceTrainingEligible'] = False
        reasons = payload.setdefault('trainingBlockReasons', [])
        if 'EXTENDED_HOURS_FIELD_INTEGRITY_BLOCK' not in reasons:
            reasons.append('EXTENDED_HOURS_FIELD_INTEGRITY_BLOCK')
        for r in payload.get('rows', []):
            r['_persistenceTrainingEligible'] = False
            r['_gainRetentionPct'] = None
            r['_persistenceSlopePctPts'] = None
            r['_persistenceTrend'] = 'BLOCKED_EXTENDED_HOURS_FIELD_INTEGRITY'
            r['_extendedHoursMetricsState'] = state
        for r in payload.get('data', []):
            r['_persistenceTrainingEligible'] = False
            r['_gainRetentionPct'] = None
            r['_persistenceSlopePctPts'] = None
            r['_persistenceTrend'] = 'BLOCKED_EXTENDED_HOURS_FIELD_INTEGRITY'
            r['_extendedHoursMetricsState'] = state

        # Update the compact current-bucket snapshot so later buckets cannot learn
        # from invalidated AH values.
        for s in reversed(hist):
            if str(s.get('timestampET', ''))[:10] == day and s.get('session') == 'after-hours' and s.get('sessionBucket') == bucket:
                s['extendedHoursFieldIntegrityState'] = state
                s['extendedHoursFieldIntegrityEvidence'] = evidence
                s['persistenceTrainingEligible'] = False
                s['afterHoursVolumeParticipationEligible'] = False
                s['extendedHoursVolumeTakeoverEligible'] = False
                reasons = s.setdefault('trainingBlockReasons', [])
                if 'EXTENDED_HOURS_FIELD_INTEGRITY_BLOCK' not in reasons:
                    reasons.append('EXTENDED_HOURS_FIELD_INTEGRITY_BLOCK')
                for m in s.get('topMovers', []):
                    m['gainRetentionPct'] = None
                    m['persistenceSlopePctPts'] = None
                    m['persistenceTrend'] = 'BLOCKED_EXTENDED_HOURS_FIELD_INTEGRITY'
                    m['extendedHoursMetricsState'] = state
                break

    DATA.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    HIST.write_text(json.dumps(hist, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'state': state, 'evidence': evidence}, ensure_ascii=False))


if __name__ == '__main__':
    main()
