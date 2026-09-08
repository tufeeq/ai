#!/usr/bin/env python3
"""TAGit v5.13 forward-only pre-open validation governance.

This module deliberately does NOT optimize a model. It closes adaptive-validation
loopholes: consumed historical holdouts cannot promote a model, and a forward
candidate is not considered frozen unless its executable model parameters are also
persisted and hash-addressable. Freezing thresholds alone is insufficient.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('tag/data')
V5122 = ROOT / 'tagit-v5122-preopen-fixed-cutoff.json'
V5123 = ROOT / 'tagit-v5123-preopen-fixed-cutoff.json'
OUT = ROOT / 'tagit-v513-forward-governance.json'
MANIFEST = ROOT / 'tagit-v513-frozen-candidate.json'
MODEL = ROOT / 'tagit-v513-frozen-model.json'


def readj(path):
    return json.loads(path.read_text(encoding='utf-8'))


def compact(r):
    h = r.get('holdout') or {}
    return {
        'schemaVersion': r.get('schemaVersion'),
        'selectedConfig': r.get('selectedConfig'),
        'support': h.get('independentTickerDays', h.get('count')),
        'tp': h.get('tp'),
        'precisionPct': h.get('precisionPct'),
        'wilsonLower90Pct': h.get('wilsonLower90Pct'),
        'dayBlockBootstrapLower90Pct': h.get('dayBlockBootstrapLower90Pct'),
        'activeDays': h.get('activeDays'),
        'medianLeadMin': h.get('medianLeadMin'),
        'top3DailyPrecisionPct': h.get('top3DailyPrecisionPct'),
        'medianRemainingUpsidePct': h.get('medianRemainingUpsidePct'),
        'winnerDayRecallPct': h.get('winnerDayRecallPct'),
        'universeIntegrity': bool(r.get('universeIntegrity')),
        'realDiscoveryPrecisionPct': r.get('realDiscoveryPrecisionPct'),
    }


def artifact_status():
    """Fail closed until an executable, immutable model artifact is committed."""
    if not MODEL.exists():
        return False, None, 'FROZEN_MODEL_ARTIFACT_MISSING'
    raw = MODEL.read_bytes()
    try:
        model = json.loads(raw.decode('utf-8'))
    except Exception:
        return False, hashlib.sha256(raw).hexdigest(), 'FROZEN_MODEL_ARTIFACT_UNPARSEABLE'
    required = {'schemaVersion', 'featureNames', 'classifier', 'upsideRegressor', 'trainingCutoffDate'}
    if not required.issubset(model):
        return False, hashlib.sha256(raw).hexdigest(), 'FROZEN_MODEL_ARTIFACT_INCOMPLETE'
    return True, hashlib.sha256(raw).hexdigest(), 'OK'


a = readj(V5122)
b = readj(V5123)
now = datetime.now(timezone.utc).isoformat()
bench_a, bench_b = compact(a), compact(b)
artifact_ok, artifact_sha256, artifact_reason = artifact_status()

# v5.12.2 remains the strongest consumed historical benchmark. Its selected CONFIG
# is frozen as a research reference, but it is NOT an executable forward candidate
# until the exact model parameters are frozen too.
manifest = {
    'schemaVersion': '5.13.3-frozen-preopen-candidate',
    'frozenAtUTC': now,
    'sourceVersion': '5.12.2',
    'cutoffET': '09:15',
    'objective': a.get('objective'),
    'selectedConfig': a.get('selectedConfig'),
    'historicalBenchmark': bench_a,
    'selectionDisclosure': 'candidate config chosen after observing consumed historical research benchmarks; historical holdout cannot confirm promotion',
    'modelStatus': 'FROZEN_EXECUTABLE_MODEL_READY' if artifact_ok else 'CONFIG_FROZEN_MODEL_ARTIFACT_MISSING',
    'modelArtifactPath': str(MODEL) if artifact_ok else None,
    'modelArtifactSha256': artifact_sha256,
    'predictionArtifactIntegrity': artifact_ok,
    'forwardScoringEligible': artifact_ok,
    'artifactReason': artifact_reason,
    'mayRetuneFromForwardOutcomes': False,
}

report = {
    'schemaVersion': '5.13.3-forward-governance',
    'generatedAtUTC': now,
    'status': 'READY_FOR_FORWARD_SCORING' if artifact_ok else 'CAPTURE_ONLY_MODEL_FREEZE_REQUIRED',
    'realDiscoveryPrecisionPct': None,
    'universeIntegrity': False,
    'predictionArtifactIntegrity': artifact_ok,
    'forwardScoringEligible': artifact_ok,
    'promotionEligible': False,
    'historicalHoldoutStatus': 'CONSUMED_FOR_RESEARCH_COMPARISON',
    'reason': ('forward scoring may begin with hash-addressed frozen model' if artifact_ok else
               'v5.12.2/v5.12.3 holdout is consumed and v5.13 had frozen thresholds but not executable model parameters; source capture may continue but predictions cannot count as frozen-candidate forward evidence'),
    'historicalBenchmarks': {'v5.12.2': bench_a, 'v5.12.3': bench_b},
    'frozenCandidate': {'version': '5.12.2', 'config': a.get('selectedConfig'), 'artifactSha256': artifact_sha256},
    'forwardGate': {
        'oneDecisionPerTickerDay': True,
        'fixedCutoffET': '09:15',
        'pointInTimeUniverseRequired': True,
        'pointInTimeContextRequired': True,
        'predictionFrozenBeforeOutcome': True,
        'frozenExecutableModelArtifactRequired': True,
        'modelArtifactSha256Required': True,
        'minimumIndependentTickerDays': 100,
        'minimumActiveDays': 20,
        'minimumUniverseArchiveDays': 20,
        'requireWilsonLower90Pct': True,
        'requireDayBlockBootstrapLower90Pct': True,
        'forwardConfirmationRequired': True,
        'historicalHoldoutMaySelectFutureModels': False,
        'ninetyPctClaimRule': 'only if precision >=90%, Wilson lower 90% >=80%, day-block lower 90% >=80%, support/day gates pass, point-in-time universe integrity and frozen prediction-artifact integrity pass, and an additional forward confirmation period independently confirms performance'
    },
    'antiLeakage': [
        'historical v5.12.x holdout is consumed and cannot promote later versions',
        'forward universe may be captured before a model artifact exists, but such captures are not scored retrospectively as if predictions were frozen',
        'exact executable model parameters and feature schema must be hash-addressed before a prediction can enter a confirmation tranche',
        'forward universe must be captured before labels exist',
        'float/short/news/filing context must be timestamped and available at decision time',
        'future regular-session bars are labels only',
        'no threshold, architecture, or model-parameter changes based on outcomes inside an active forward confirmation tranche',
        'new model versions require a new forward tranche after freeze'
    ]
}

OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
