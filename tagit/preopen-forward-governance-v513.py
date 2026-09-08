#!/usr/bin/env python3
"""TAGit v5.13 forward-only pre-open validation governance.

This module deliberately does NOT optimize a model. It closes an adaptive-validation
loophole: once multiple model versions have been compared on the same historical
holdout, that period is consumed for research and may no longer be called untouched
for promotion decisions.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('tag/data')
V5122 = ROOT / 'tagit-v5122-preopen-fixed-cutoff.json'
V5123 = ROOT / 'tagit-v5123-preopen-fixed-cutoff.json'
OUT = ROOT / 'tagit-v513-forward-governance.json'
MANIFEST = ROOT / 'tagit-v513-frozen-candidate.json'


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


a = readj(V5122)
b = readj(V5123)
now = datetime.now(timezone.utc).isoformat()
bench_a, bench_b = compact(a), compact(b)

# v5.12.2 is frozen as the forward candidate because it is the stronger historical
# pre-open benchmark. This selection is explicitly acknowledged as having used the
# consumed research period; only NEW forward observations can confirm it.
manifest = {
    'schemaVersion': '5.13-frozen-preopen-candidate',
    'frozenAtUTC': now,
    'sourceVersion': '5.12.2',
    'cutoffET': '09:15',
    'objective': a.get('objective'),
    'selectedConfig': a.get('selectedConfig'),
    'historicalBenchmark': bench_a,
    'selectionDisclosure': 'candidate chosen after observing consumed historical research benchmarks; historical holdout cannot confirm promotion',
    'modelStatus': 'FROZEN_FOR_FORWARD_CONFIRMATION_ONLY',
    'mayRetuneFromForwardOutcomes': False,
}

report = {
    'schemaVersion': '5.13-forward-governance',
    'generatedAtUTC': now,
    'status': 'READY_FOR_FORWARD_ACCUMULATION',
    'realDiscoveryPrecisionPct': None,
    'universeIntegrity': False,
    'promotionEligible': False,
    'historicalHoldoutStatus': 'CONSUMED_FOR_RESEARCH_COMPARISON',
    'reason': 'v5.12.2 and v5.12.3 were both inspected on the same chronological holdout; cross-version adaptation makes that period ineligible as an untouched promotion holdout',
    'historicalBenchmarks': {'v5.12.2': bench_a, 'v5.12.3': bench_b},
    'frozenCandidate': {'version': '5.12.2', 'config': a.get('selectedConfig')},
    'forwardGate': {
        'oneDecisionPerTickerDay': True,
        'fixedCutoffET': '09:15',
        'pointInTimeUniverseRequired': True,
        'pointInTimeContextRequired': True,
        'predictionFrozenBeforeOutcome': True,
        'minimumIndependentTickerDays': 100,
        'minimumActiveDays': 20,
        'minimumUniverseArchiveDays': 20,
        'requireWilsonLower90Pct': True,
        'requireDayBlockBootstrapLower90Pct': True,
        'forwardConfirmationRequired': True,
        'historicalHoldoutMaySelectFutureModels': False,
        'ninetyPctClaimRule': 'only if precision >=90%, Wilson lower 90% >=80%, day-block lower 90% >=80%, support/day gates pass, universe integrity passes, and an additional forward confirmation period independently confirms performance'
    },
    'antiLeakage': [
        'historical v5.12.x holdout is consumed and cannot promote later versions',
        'forward universe must be captured before labels exist',
        'float/short/news/filing context must be timestamped and available at decision time',
        'future regular-session bars are labels only',
        'no threshold or architecture changes based on outcomes inside an active forward confirmation tranche',
        'new model versions require a new forward tranche after freeze'
    ]
}

OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
