#!/usr/bin/env python3
"""TAGit v5.14: create an executable forward-only pre-open model artifact.

Important validation semantics:
- v5.12.x historical holdout is already consumed research evidence.
- This script does NOT report a new historical holdout metric.
- It reuses the v5.12.2 causal feature/label pipeline, then refits on ALL available
  consumed historical rows solely to create a new model for a FRESH forward tranche.
- The executable model, feature schema, pipeline hash, training cutoff, and data
  fingerprint are frozen before any forward outcome can be counted.
"""
import base64
import hashlib
import json
import pickle
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('tag/data')
SRC5122 = Path('tagit/preopen-fixed-cutoff-v5122.py')
OUT = ROOT / 'tagit-v514-frozen-model.json'
REPORT = ROOT / 'tagit-v514-freeze-report.json'

wrapper = SRC5122.read_text(encoding='utf-8')
anchor = 'exec(compile(src,"tagit/preopen-fixed-cutoff-v5122.generated.py","exec"),{"__name__":"__main__"})'
if anchor not in wrapper:
    raise RuntimeError('v5.14 could not find v5.12.2 generated-source execution anchor')
# Run only the source-construction portion first, so we can hash the exact generated
# causal pipeline and execute it in a namespace whose trained objects remain available.
probe = wrapper.replace(anchor, "globals()['_V514_GENERATED_SRC']=src", 1)
ns = {'__name__': '__main__'}
exec(compile(probe, str(SRC5122), 'exec'), ns)
generated = ns.get('_V514_GENERATED_SRC')
if not generated:
    raise RuntimeError('v5.14 failed to materialize v5.12.2 generated source')

env = {'__name__': '__main__'}
exec(compile(generated, 'tagit/preopen-fixed-cutoff-v5122.generated.py', 'exec'), env)
rows = env.get('rows') or []
fit_cls = env.get('fit_cls')
fit_reg = env.get('fit_reg')
features = env.get('FEATURES') or []
cfg = env.get('cfg')
if len(rows) < 300 or fit_cls is None or fit_reg is None or not features or cfg is None:
    report = {
        'schemaVersion': '5.14-freeze-report',
        'generatedAtUTC': datetime.now(timezone.utc).isoformat(),
        'status': 'INSUFFICIENT_DATA',
        'rows': len(rows),
        'reason': 'causal historical population/model objects unavailable; no forward artifact written',
        'historicalPrecisionClaimed': False,
    }
    REPORT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    raise SystemExit(0)

# Historical validation is consumed. A forward-only model may therefore train on all
# historical rows available up to this cutoff, but its evidence starts only AFTER freeze.
mc = fit_cls(rows, seed=5140)
mr = fit_reg(rows)
if mc is None or mr is None:
    raise RuntimeError('v5.14 full-history refit failed')

# Stable fingerprint of the exact labeled training examples used for this forward-only refit.
def row_digest(r):
    obj = {
        'key': r.get('key'), 'day': r.get('day'), 'feat': r.get('feat'),
        'action10': bool(r.get('action10')), 'remainingUpsidePct': r.get('remainingUpsidePct'),
        'hardNeg': bool(r.get('hardNeg')),
    }
    return json.dumps(obj, sort_keys=True, separators=(',', ':'))
h = hashlib.sha256()
for r in sorted(rows, key=lambda x: (x.get('day',''), x.get('symbol',''))):
    h.update(row_digest(r).encode('utf-8')); h.update(b'\n')
training_fp = h.hexdigest()
pipeline_sha = hashlib.sha256(generated.encode('utf-8')).hexdigest()

payload = pickle.dumps({'classifierEnsemble': mc, 'upsideRegressorEnsemble': mr}, protocol=5)
model_sha = hashlib.sha256(payload).hexdigest()
cutoff = max(str(r.get('day')) for r in rows if r.get('day'))
selected = {'minScore': float(cfg[0]), 'maxDisagreement': float(cfg[1]), 'minPredUpside': float(cfg[2])}
artifact = {
    'schemaVersion': '5.14-forward-only-frozen-model',
    'frozenAtUTC': datetime.now(timezone.utc).isoformat(),
    'sourcePipelineVersion': '5.12.2',
    'validationStatus': 'FORWARD_ONLY_NO_FRESH_HISTORICAL_HOLDOUT_CLAIM',
    'featureNames': features,
    'selectedConfig': selected,
    'trainingCutoffDate': cutoff,
    'trainingIndependentTickerDays': len(rows),
    'trainingActiveDays': len({r.get('day') for r in rows}),
    'trainingPositiveCount': sum(bool(r.get('action10')) for r in rows),
    'trainingHardNegativeCount': sum(bool(r.get('hardNeg')) for r in rows),
    'trainingDataSha256': training_fp,
    'featurePipelineSourceSha256': pipeline_sha,
    'classifier': {'encoding': 'pickle-base64', 'ensemble': ['StandardScaler','ExtraTreesClassifier','HistGradientBoostingClassifier','LogisticRegression']},
    'upsideRegressor': {'encoding': 'pickle-base64', 'ensemble': ['ExtraTreesRegressor','HistGradientBoostingRegressor']},
    'modelPayloadSha256': model_sha,
    'modelPayloadBase64': base64.b64encode(payload).decode('ascii'),
    'historicalHoldoutConsumed': True,
    'realDiscoveryPrecisionPct': None,
    'universeIntegrity': False,
    'forwardEvidenceStartsAfterFrozenAtUTC': True,
    'mayRetuneFromForwardOutcomes': False,
}
OUT.write_text(json.dumps(artifact, indent=2) + '\n', encoding='utf-8')
report = {
    'schemaVersion': '5.14-freeze-report',
    'generatedAtUTC': datetime.now(timezone.utc).isoformat(),
    'status': 'FROZEN_FORWARD_MODEL_CREATED',
    'modelPath': str(OUT),
    'modelPayloadSha256': model_sha,
    'trainingDataSha256': training_fp,
    'featurePipelineSourceSha256': pipeline_sha,
    'trainingIndependentTickerDays': len(rows),
    'trainingActiveDays': len({r.get('day') for r in rows}),
    'trainingCutoffDate': cutoff,
    'selectedConfig': selected,
    'historicalPrecisionClaimed': False,
    'nextStep': 'open a fresh point-in-time forward tranche; never score pre-freeze captures retrospectively',
}
REPORT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
