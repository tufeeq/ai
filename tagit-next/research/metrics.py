"""Descriptive metrics. Unknown outcomes are retained, never replaced with zero."""
from collections import Counter, defaultdict
from math import isfinite
from random import Random
from statistics import mean
from zoneinfo import ZoneInfo
from .events import time


def quantiles(values):
    values=sorted(values)
    if not values:return None
    def q(p):
        pos=(len(values)-1)*p;lo=int(pos);hi=min(lo+1,len(values)-1)
        return values[lo]+(values[hi]-values[lo])*(pos-lo)
    return {str(p):q(p) for p in (0,.025,.25,.5,.75,.975,1)}


def summarize(rows,seed=20260924,iterations=5000):
    rows=list(rows); scored=[r for r in rows if r.get('net_pct') is not None]
    if any(not isfinite(r['net_pct']) for r in scored):raise ValueError('Nonfinite result')
    values=[r['net_pct'] for r in scored];wins=[v for v in values if v>0];losses=[v for v in values if v<0]
    groups=defaultdict(list);hours=defaultdict(list)
    for r in scored:
        groups[r['session']].append(r['net_pct'])
        hours[str(time(r['at']).astimezone(ZoneInfo('America/New_York')).hour)].append(r['net_pct'])
    ci=None
    if len(groups)>=2:
        rng=Random(seed);days=sorted(groups);samples=[]
        for _ in range(iterations):
            sample=[v for day in rng.choices(days,k=len(days)) for v in groups[day]]
            samples.append(mean(sample))
        q=quantiles(samples);ci=[q['0.025'],q['0.975']]
    return {'signals':len(rows),'evaluable':len(scored),'unevaluable':len(rows)-len(scored),
        'statuses':dict(sorted(Counter(r['status'] for r in rows).items())),
        'resolved_win_rate':len(wins)/len(values) if values else None,
        'mean_win_pct':mean(wins) if wins else None,'mean_loss_pct':mean(losses) if losses else None,
        'resolved_expectancy_pct':mean(values) if values else None,
        'all_signal_expectancy_pct':mean(values) if values and len(values)==len(rows) else None,
        'profit_factor_resolved':sum(wins)/-sum(losses) if losses else None,
        'resolved_session_bootstrap_ci95_pct':ci,'bootstrap_seed':seed,'bootstrap_iterations':iterations,
        'sessions_with_resolved_outcomes':len(groups),'small_cluster_warning':len(groups)<30,
        'bootstrap_scope':'Conditional on observed outcomes; not a missing-data correction or holdout test',
        'mae_pct':quantiles([r['mae_pct'] for r in scored if r.get('mae_pct') is not None]),
        'mfe_pct':quantiles([r['mfe_pct'] for r in scored if r.get('mfe_pct') is not None]),
        'hour_new_york':{h:{'n':len(v),'resolved_mean_pct':mean(v)} for h,v in sorted(hours.items())},
        'portfolio_max_drawdown_pct':None,
        'portfolio_limitation':'No capital allocation, concurrency or equity path; intratrade MAE is not portfolio drawdown'}


def bonferroni(p_values,family_size):
    """Family includes all attempted configurations, including failed/missing ones."""
    if not isinstance(family_size,int) or family_size<len(p_values) or family_size<1:
        raise ValueError('Invalid complete hypothesis family size')
    if any(p is not None and (not isfinite(p) or not 0<=p<=1) for p in p_values):
        raise ValueError('Invalid p value')
    return [min(1,p*family_size) if p is not None else None for p in p_values]


def portfolio_drawdown(equity):
    """Only for an explicit chronological marked-to-market capital path."""
    if not equity:return None
    peak=equity[0];worst=0
    if peak<=0 or any(not isfinite(v) or v<0 for v in equity):raise ValueError('Invalid equity path')
    for value in equity:
        peak=max(peak,value);worst=min(worst,(value/peak-1)*100)
    return worst
