#!/usr/bin/env python3
"""Build a single authoritative TAGit model-governance decision.

This script does not promote models. It reconciles the current reference
champion with shadow / forward-evidence challengers and makes any future
promotion an explicit manual decision after independent evidence is ready.
"""
import json
import pathlib
from datetime import datetime, timezone

V06 = pathlib.Path('tag/data/tagit-v06-walkforward.json')
V25 = pathlib.Path('tag/data/tagit-v25-model-meta.json')
V49 = pathlib.Path('tag/data/tagit-v49-policy-readiness.json')
OUT = pathlib.Path('tag/data/tagit-model-governance.json')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


v06 = read(V06)
v25 = read(V25)
v49 = read(V49)

# Hard safety contracts: research challengers cannot silently replace the
# reference champion merely because a historical backtest looks attractive.
assert v25.get('policy') == 'SHADOW_ONLY_UNTIL_OUT_OF_SAMPLE_PROMOTION'
assert v49.get('policy') == 'RESEARCH_READINESS_ONLY_NO_LIVE_OVERRIDE'
assert v49.get('autoPromotion') is False

promotion = v06.get('promotion') or {}
v25_hist = v25.get('historicalBenchmark') or {}
v25_cal = v25_hist.get('calibration') or {}
v25_holdout = v25_hist.get('holdoutSeptember') or {}
v49_current = v49.get('current') or {}
v49_status = v49.get('status') or 'NOT_READY'

manual_review_ready = v49_status == 'VALIDATED_SHADOW_CANDIDATE'

decision = {
    'schemaVersion': '1.0-model-governance',
    'generatedAtUTC': datetime.now(timezone.utc).isoformat(),
    'decision': 'KEEP_V06_CHAMPION_PENDING_MANUAL_REVIEW' if manual_review_ready else 'KEEP_V06_CHAMPION',
    'currentChampion': {
        'id': 'TAGit-v0.6',
        'role': 'REFERENCE_CHAMPION',
        'source': str(V06),
        'precision10_60mPct': promotion.get('precision10_60mPct'),
        'recallObservationPct': promotion.get('recallObservationPct'),
        'uniqueEvents': promotion.get('uniqueEvents'),
        'truePositives': promotion.get('truePositives'),
    },
    'challengers': [
        {
            'id': 'TAGit-v2.5',
            'role': 'SHADOW',
            'source': str(V25),
            'policy': v25.get('policy'),
            'credible90': bool(v25_hist.get('credible90')),
            'calibration': {
                'count': v25_cal.get('count'),
                'precision10_60mPct': v25_cal.get('precision10_60mPct'),
                'recallObsPct': v25_cal.get('recallObsPct'),
            },
            'holdout': {
                'count': v25_holdout.get('count'),
                'precision10_60mPct': v25_holdout.get('precision10_60mPct'),
                'recallObsPct': v25_holdout.get('recallObsPct'),
            },
            'promotionEligible': False,
            'reason': 'Insufficient independent credibility; model metadata explicitly remains shadow-only.',
        },
        {
            'id': 'TAGit-v4.9',
            'role': 'FORWARD_EVIDENCE_CHALLENGER',
            'source': str(V49),
            'status': v49_status,
            'minimumEvidence': v49.get('minimumEvidence'),
            'currentEvidence': v49_current,
            'promotionEligible': False,
            'manualReviewReady': manual_review_ready,
            'reason': (
                'Independent forward validation produced a validated shadow candidate; explicit manual review is still required.'
                if manual_review_ready else
                'Forward evidence has not yet produced a validated shadow candidate.'
            ),
        },
    ],
    'promotionPolicy': {
        'automaticPromotion': False,
        'manualPromotionRequired': True,
        'historicalBacktestAloneCanPromote': False,
        'forwardResearchStatusRequired': 'VALIDATED_SHADOW_CANDIDATE',
        'currentForwardResearchStatus': v49_status,
        'manualReviewReady': manual_review_ready,
        'rule': 'No challenger may replace TAGit-v0.6 without independent forward validation and an explicit manual promotion commit.',
    },
}

# A generated governance report is authoritative only if it still has exactly
# one reference champion and automatic promotion remains impossible.
assert decision['currentChampion']['id'] == 'TAGit-v0.6'
assert decision['promotionPolicy']['automaticPromotion'] is False
assert all(x.get('promotionEligible') is False for x in decision['challengers'])

OUT.write_text(json.dumps(decision, indent=2) + '\n', encoding='utf-8')
print(json.dumps({
    'decision': decision['decision'],
    'champion': decision['currentChampion']['id'],
    'v49Status': v49_status,
    'manualReviewReady': manual_review_ready,
}))
