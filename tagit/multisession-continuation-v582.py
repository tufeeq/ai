#!/usr/bin/env python3
"""TAGit v5.8.2 stability-selected multi-session continuation validator.

Builds on the purged v5.8.1 learner, but does NOT choose a configuration on one
aggregate calibration block. Candidate configurations are scored on two
chronological calibration sub-blocks and must be stable across both. The
untouched holdout is evaluated only after the configuration is frozen.

Adds event/day-aware uncertainty, top-3 daily precision and winner-day recall.
Historical mover-conditioned universe remains explicitly non-market-wide.
"""
from pathlib import Path
import json, math
from collections import defaultdict
import numpy as np

# v5.8.1 executes the base learner with purged split boundaries and leaves the
# trained models, enriched calibration/holdout rows, candidate configs and
# selection functions available in this namespace.
exec(compile(Path('tagit/multisession-continuation-v581.py').read_text(encoding='utf-8'),
             'tagit/multisession-continuation-v581.py::v582', 'exec'), globals(), globals())

OUT582=Path('tag/data/tagit-v582-multisession-stability.json')


def _wilson(tp,n,z=1.645):
    if n < 1: return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100


def _day_bootstrap_lower(sel, seed=5820, reps=2500):
    if not sel: return None
    by=defaultdict(list)
    for x in sel: by[x['day']].append(x)
    days=sorted(by)
    if len(days) < 5: return None
    rng=np.random.default_rng(seed)
    vals=[]
    for _ in range(reps):
        sampled=rng.choice(days, size=len(days), replace=True)
        tp=n=0
        for d in sampled:
            g=by[str(d)]; n += len(g); tp += sum(bool(x['next1Explode20']) for x in g)
        if n: vals.append(100*tp/n)
    return round(float(np.quantile(vals,.05)),2) if vals else None


def _robust_stat(sel, universe):
    n=len(sel); tp=sum(bool(x['next1Explode20']) for x in sel)
    by=defaultdict(list)
    for x in sel: by[x['day']].append(x)
    top3=[]
    for d,g in by.items(): top3.extend(sorted(g,key=lambda z:z['carryScore'],reverse=True)[:3])
    t3n=len(top3); t3tp=sum(bool(x['next1Explode20']) for x in top3)
    winner_days={x['day'] for x in universe if x['next1Explode20']}
    caught_days={x['day'] for x in sel if x['next1Explode20']}
    gains=[float(x['next2MaxGainPct']) for x in sel]
    return {
        'count':n,
        'tpNext1':tp,
        'next1Precision20Pct':round(100*tp/n,2) if n else None,
        'wilsonLower90Next1Pct':round(_wilson(tp,n),2) if n else None,
        'dayBlockBootstrapLower90Pct':_day_bootstrap_lower(sel),
        'activeDays':len(by),
        'top3DailyCount':t3n,
        'top3DailyPrecision20Pct':round(100*t3tp/t3n,2) if t3n else None,
        'winnerDays':len(winner_days),
        'capturedWinnerDays':len(caught_days),
        'winnerDayRecallPct':round(100*len(caught_days)/len(winner_days),2) if winner_days else None,
        'medianNext2MaxGainPct':round(float(np.median(gains)),2) if gains else None,
        'p75Next2MaxGainPct':round(float(np.quantile(gains,.75)),2) if gains else None,
    }

# Split calibration chronologically into two internal stability blocks.
cal_days=sorted({x['day'] for x in cp})
mid=max(1,len(cal_days)//2)
cal_a_days=set(cal_days[:mid]); cal_b_days=set(cal_days[mid:])
cal_a=[x for x in cp if x['day'] in cal_a_days]
cal_b=[x for x in cp if x['day'] in cal_b_days]

ranked=[]
for _,candidate_cfg,_ in configs:
    sa=select(cal_a,candidate_cfg); sb=select(cal_b,candidate_cfg); sf=select(cp,candidate_cfg)
    a=_robust_stat(sa,cal_a); b=_robust_stat(sb,cal_b); f=_robust_stat(sf,cp)
    na,nb=a['count'],b['count']
    loa=a['wilsonLower90Next1Pct'] or 0; lob=b['wilsonLower90Next1Pct'] or 0
    pa=a['next1Precision20Pct'] or 0; pb=b['next1Precision20Pct'] or 0
    # Stability first. A configuration that only works in one regime is penalized.
    utility=min(loa,lob)*220 + min(pa,pb)*35 + (f['wilsonLower90Next1Pct'] or 0)*30
    utility += min(na,100)+min(nb,100) - abs(pa-pb)*35
    if na < 30 or nb < 30: utility -= 8000
    if a['activeDays'] < 10 or b['activeDays'] < 10: utility -= 5000
    ranked.append((utility,candidate_cfg,a,b,f))
ranked.sort(key=lambda z:z[0], reverse=True)
_,stable_cfg,cal_a_stat,cal_b_stat,cal_full_stat=ranked[0]

# Holdout is touched only here, after stable_cfg has been frozen from calibration.
hold_sel=select(hp,stable_cfg)
hold_stat=_robust_stat(hold_sel,hp)

report={
  'schemaVersion':'5.8.2-stability-selected-multisession',
  'status':'COMPLETE',
  'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
  'selectedConfig':{
    'minCarryScore':stable_cfg[0],
    'minPNext1Explode20':stable_cfg[1],
    'minPNext2Explode20':stable_cfg[2],
    'minPredNext2MaxGainPct':stable_cfg[3],
    'maxDisagreement':stable_cfg[4],
  },
  'calibrationStability':{
    'blockA':cal_a_stat,
    'blockB':cal_b_stat,
    'full':cal_full_stat,
    'blockADateRange':[min(cal_a_days) if cal_a_days else None,max(cal_a_days) if cal_a_days else None],
    'blockBDateRange':[min(cal_b_days) if cal_b_days else None,max(cal_b_days) if cal_b_days else None],
  },
  'holdout':hold_stat,
  'universeIntegrity':{
    'marketWidePointInTimeUniverse':False,
    'realDiscoveryPrecisionClaimAllowed':False,
    'reason':'historical training/evaluation universe includes mover-conditioned symbols; precision is conditional holdout precision, not market-wide discovery precision',
  },
  'antiLeakage':[
    'features use current/prior completed sessions only',
    'future sessions are labels only',
    'train/calibration label horizons are purged at split boundaries',
    'configuration selected only from two chronological calibration sub-blocks',
    'untouched chronological holdout evaluated after stable configuration freeze',
    'day-block bootstrap resamples active dates rather than pretending all observations are IID',
  ],
  'claimGate':{
    'adequateIndependentSupport':bool(hold_stat['count']>=100 and hold_stat['activeDays']>=20),
    'credible90Claim':False,
    'forwardConfirmationRequired':True,
  },
  'mainBottleneck':'separating robust carryover ignition from false continuation across regimes while historical universe remains mover-conditioned',
}
OUT582.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
