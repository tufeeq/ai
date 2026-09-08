#!/usr/bin/env python3
"""Audit TAGit forward-only evidence before any real-precision claim.

This validator is deliberately conservative. It verifies immutable snapshot hashes,
hash-chain continuity, frozen model provenance, chronological separation from training,
and cohort scope. It never infers market-wide precision from mover-conditioned discovery
snapshots and never uses forward outcomes for tuning.
"""
from __future__ import annotations
import hashlib, json, pathlib, datetime as dt

ROOT = pathlib.Path('tag/data/forward')
OUT = pathlib.Path('tag/data/tagit-forward-claim-integrity.json')


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(v):
    return hashlib.sha256(canonical(v).encode()).hexdigest()


def main():
    files = sorted(p for p in ROOT.glob('*.json') if p.name != 'ledger.json') if ROOT.exists() else []
    errors, warnings, days = [], [], []
    previous_hash = None
    model_hashes, training_hashes, pipeline_hashes = set(), set(), set()
    total_symbols = 0
    for p in files:
        try:
            x = json.loads(p.read_text())
        except Exception as exc:
            errors.append(f'{p}: invalid JSON: {exc}')
            continue
        day = str(x.get('dayET') or p.stem)
        stored_hash = x.get('snapshotHash')
        body = dict(x); body.pop('snapshotHash', None)
        actual_hash = digest(body)
        if stored_hash != actual_hash:
            errors.append(f'{day}: snapshot hash mismatch')
        if x.get('previousSnapshotHash') != previous_hash:
            if previous_hash is not None:
                errors.append(f'{day}: hash-chain discontinuity')
        previous_hash = stored_hash
        if x.get('evaluationOnly') is not True or x.get('trainingEligible') is not False:
            errors.append(f'{day}: snapshot not evaluation-only/training-ineligible')
        prov = x.get('modelProvenance') or {}
        cutoff = str(prov.get('trainingCutoffDate') or '')
        if not cutoff or cutoff >= day:
            errors.append(f'{day}: not strictly after training cutoff {cutoff or "UNKNOWN"}')
        for key, dest in [('modelPayloadSha256', model_hashes), ('trainingDataSha256', training_hashes), ('featurePipelineSourceSha256', pipeline_hashes)]:
            v = prov.get(key)
            if not v: errors.append(f'{day}: missing {key}')
            else: dest.add(v)
        universe = x.get('universe') or []
        syms = [str(r.get('symbol') or '').upper() for r in universe]
        if not universe: errors.append(f'{day}: empty frozen universe')
        if len(syms) != len(set(syms)): errors.append(f'{day}: duplicate symbols')
        total_symbols += len(universe)
        days.append({'dayET': day, 'eligibleCount': len(universe), 'snapshotHash': stored_hash})

    if len(model_hashes) > 1:
        warnings.append('multiple frozen model payloads appear across forward days; precision must be stratified by model hash')
    if len(training_hashes) > 1 or len(pipeline_hashes) > 1:
        warnings.append('training/pipeline provenance changed across forward days; do not pool without explicit version strata')

    # Current forward source is discovery.json, which is mover-conditioned, not a full
    # exchange-level point-in-time universe. Therefore only cohort-level forward evidence
    # can be claimed until an independent market-wide PIT universe capture exists.
    integrity = {
        'schemaVersion': 'forward-claim-integrity-v1',
        'generatedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
        'status': 'PASS' if not errors else 'FAIL',
        'snapshotDays': len(days),
        'totalFrozenSymbolDays': total_symbols,
        'hashChainValid': not any('hash' in e for e in errors),
        'chronologicalSeparationValid': not any('training cutoff' in e for e in errors),
        'evaluationOnlyValid': not any('evaluation-only' in e for e in errors),
        'modelProvenanceStable': len(model_hashes) <= 1 and len(training_hashes) <= 1 and len(pipeline_hashes) <= 1,
        'marketWidePointInTimeUniverse': False,
        'survivorshipSafeMarketWideUniverse': False,
        'claimScopeAllowed': 'FROZEN_DISCOVERY_COHORT_ONLY' if not errors else 'NONE',
        'realDiscoveryPrecisionPct': None,
        'credible90Claim': False,
        'minimumClaimRequirements': {
            'untouchedChronologicalForwardCohort': True,
            'adequateIndependentTickerDaySupport': False,
            'adequateActiveDaySupport': False,
            'dayBlockUncertainty': False,
            'marketWidePointInTimeUniverse': False,
            'survivorshipSafeUniverse': False,
            'independentForwardOutcomeConfirmation': False,
        },
        'errors': errors,
        'warnings': warnings,
        'days': days[-10:],
        'policy': [
            'forward snapshots are evaluation-only and may never enter training/tuning',
            'precision must be computed on independent ticker-day decisions after label maturity',
            'uncertainty must include Wilson and day-block resampling across active days',
            'mover-conditioned discovery cohorts cannot support a market-wide precision claim',
            '90% is forbidden unless untouched chronological evidence, adequate support, PIT universe integrity and independent forward confirmation all pass',
        ],
    }
    OUT.write_text(json.dumps(integrity, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: integrity[k] for k in ('status','snapshotDays','totalFrozenSymbolDays','claimScopeAllowed','realDiscoveryPrecisionPct','credible90Claim')}, indent=2))
    if errors:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
