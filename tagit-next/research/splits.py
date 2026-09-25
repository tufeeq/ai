"""Chronological split validation. No holdout loader exists in Phase 1."""
from .events import time
from math import isfinite


def validate_windows(windows):
    previous_end=None
    for w in windows:
        a,b,c,d=map(time,(w['train_start'],w['train_end'],w['validation_start'],w['validation_end']))
        if not a<b<=c<d:raise ValueError('Overlapping or invalid window')
        if previous_end and c<previous_end:raise ValueError('Validation windows overlap')
        previous_end=d
    return True


def purge(rows,start,end):
    """Keep labels wholly within a half-open fold; remove boundary-crossing labels."""
    start,end=time(start),time(end)
    return [r for r in rows if start<=time(r['at'])<=time(r['label_end'])<end]


def claim_blockers(evidence):
    required=('independent_holdout','holdout_opened_once','pit_universe_complete',
              'delisted_included','costs_measured','scanner_fidelity_verified',
              'walk_forward_stable','concentration_checked','multiple_testing_accounted')
    reasons=[k for k in required if evidence.get(k) is not True]
    if evidence.get('history_months',0)<12:reasons.append('history_below_12_months')
    if evidence.get('evaluable',0)<500:reasons.append('holdout_below_500')
    ci=evidence.get('ci95')
    if not ci or len(ci)!=2 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and isfinite(v) for v in ci) or not 0<ci[0]<=ci[1]:
        reasons.append('positive_ci_not_established')
    if evidence.get('unresolved',1)!=0:reasons.append('unresolved_outcomes_need_sensitivity')
    return reasons
