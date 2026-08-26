#!/usr/bin/env python3
import argparse, datetime as dt, json
from pathlib import Path


def load(p):
    q = Path(p)
    if not q.exists() or not q.stat().st_size:
        return {}
    return json.loads(q.read_text(encoding='utf-8'))


def num(v):
    try:
        return float(str(v).replace('%', '').replace(',', '').replace('$', '').strip())
    except Exception:
        return None


def stronger_risk(upstream, peak, give):
    """Never weaken upstream memory; only strengthen from causal peak invariants."""
    severity = {
        'NONE': 0,
        'LATE_PEAK_MEMORY': 1,
        'RUNNER_RESET_DISTRIBUTION': 2,
        'EXHAUSTION_PEAK': 3,
    }
    upstream = upstream or 'NONE'
    derived = 'NONE'
    if peak is not None and peak >= 50:
        derived = 'EXHAUSTION_PEAK'
    elif peak is not None and peak >= 25:
        derived = 'RUNNER_RESET_DISTRIBUTION' if give is not None and give >= 8 else 'LATE_PEAK_MEMORY'
    return derived if severity.get(derived, 0) > severity.get(upstream, 0) else upstream


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--v7', default='tag/data/tagx-authoritative-peak-v7-challenger.json')
    ap.add_argument('--out', default='tag/data/tagx-actionability-v8-challenger.json')
    a = ap.parse_args()
    v7 = load(a.v7)
    if v7.get('schemaVersion') != 7:
        raise SystemExit('v7 unavailable')

    out = []
    actionable = 0
    blocked = 0
    invariant_corrections = 0

    for x in v7.get('currentTop20') or []:
        origin = num(x.get('proactiveFirstChangePct'))
        cur = num(x.get('changePct'))
        raw_peak = num(x.get('sessionPeakChangePct'))

        # Causal invariant: a session peak observed through "now" cannot be below
        # the current observation. This guards asynchronous standard/fast writers.
        observed = [v for v in (raw_peak, cur) if v is not None]
        peak = max(observed) if observed else None
        rebased = raw_peak is not None and cur is not None and cur > raw_peak
        invariant_corrections += int(rebased)

        give = max(0.0, peak - cur) if peak is not None and cur is not None else None
        retention = (cur / peak) if cur is not None and peak and peak > 0 else None
        risk = stronger_risk(x.get('peakMemoryRisk') or 'NONE', peak, give)

        score = 45
        up, down = [], []
        if origin is not None:
            if origin < 5:
                score += 22
                up.append('origin<5')
            elif origin < 10:
                score += 14
                up.append('origin<10')
            elif origin >= 20:
                score -= 28
                down.append('late-origin')
        if cur is not None and 2 <= cur < 15:
            score += 12
            up.append('current-early-zone')
        if peak is not None and peak < 25:
            score += 8
            up.append('peak<25')
        if retention is not None and .65 <= retention <= 1.0 and peak is not None and 8 <= peak < 25:
            score += 12
            up.append('healthy-retention')
        if give is not None and give >= 8:
            score -= 24
            down.append('giveback>=8pt')
        if peak is not None and peak >= 25:
            score -= 28
            down.append('late-peak')
        if peak is not None and peak >= 50:
            score -= 22
            down.append('exhaustion-peak')
        if risk != 'NONE':
            score -= 12
            down.append(risk)
        if rebased:
            down.append('peak-rebased-to-current-invariant')

        score = max(0, min(100, round(score)))
        is_actionable = (
            score >= 70
            and risk == 'NONE'
            and cur is not None
            and cur < 25
            and (origin is None or origin < 10)
        )
        critic = 'PASS' if is_actionable else 'REJECT'
        actionable += int(is_actionable)
        blocked += int(not is_actionable)

        out.append({
            **x,
            'rawSessionPeakChangePct': raw_peak,
            'effectiveSessionPeakChangePct': round(peak, 4) if peak is not None else None,
            'peakGivebackPts': round(give, 4) if give is not None else None,
            'retentionRatio': round(retention, 4) if retention is not None else None,
            'peakInvariantCorrected': rebased,
            'peakMemoryRisk': risk,
            'actionabilityScore': score,
            'critic': critic,
            'actionableEarly': is_actionable,
            'trace': {'up': up, 'down': down},
        })

    payload = {
        'schemaVersion': 8,
        'sessionDateET': v7.get('sessionDateET'),
        'updatedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
        'status': 'CHALLENGER_ONLY',
        'trainingEligible': False,
        'groundTruthEligible': False,
        'source': 'tagx-authoritative-peak-v7-challenger.json',
        'actionableEarlyCount': actionable,
        'criticRejectedCount': blocked,
        'peakInvariantCorrectionCount': invariant_corrections,
        'currentTop20': out,
        'policy': 'Peak-aware actionability with causal peak invariants. Effective peak=max(stored peak,current observation); giveback is never negative; retention cannot exceed 1 for positive current/peak. Never promotes late/exhausted runners. Thresholds remain challenger-only until multi-session evidence.',
    }
    Path(a.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({
        'top20': len(out),
        'actionableEarly': actionable,
        'criticRejected': blocked,
        'peakInvariantCorrections': invariant_corrections,
    }))


if __name__ == '__main__':
    main()
