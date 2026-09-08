#!/usr/bin/env python3
"""TAGit v5.21 feed-aware deterministic PIT validation.

Fixes a concrete v5.18-v5.20 feature bug: Yahoo extended-hours frequently reports pre-market
volume as zero. The previous rank01 implementation assigned different ranks to tied zeros based on
input order, creating spurious/non-deterministic cross-sectional volume signals. v5.21 makes ranks
tie-aware, sorts same-day rows deterministically, neutralizes missing pre-volume ratio features,
and adds explicit pre-volume-observed/day-coverage flags. Validation remains stability-first across
three chronological development folds; the final historical tail is already consumed and is only
reported as research comparison.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, os, pathlib
from collections import defaultdict
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v520.py')
spec=importlib.util.spec_from_file_location('v520',BASE); p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
q=p.q
v=p.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v521-free-pit-training.json'; CASES=ROOT/'tagit-v521-free-pit-cases.json'


def tie_rank01(vals):
    a=np.asarray(vals,float); n=len(a)
    if n<=1:return [0.5]*n
    order=np.argsort(a,kind='mergesort'); out=np.empty(n,float); i=0
    while i<n:
        j=i+1
        while j<n and a[order[j]]==a[order[i]]: j+=1
        avg=((i+j-1)/2)/(n-1)
        for k in range(i,j): out[order[k]]=avg
        i=j
    return out.tolist()


def augment_feed_aware(rows):
    byday=defaultdict(list)
    for r in rows: byday[r['day']].append(r)
    mem=defaultdict(lambda:{'n':0,'wins':0,'lastWin':None,'lastMfe':0.0,'lastMae':0.0,'lastHit10':0})
    out=[]
    for day in sorted(byday):
        g=sorted(byday[day],key=lambda r:r['symbol'])
        observed=[1.0 if float(r.get('preVol') or 0)>0 else 0.0 for r in g]
        coverage=float(np.mean(observed)) if observed else 0.0
        # Only rank true market-state features. Missing volume gets neutral rank rather than arbitrary order.
        basevals={0:[r['feat'][0] for r in g],3:[r['feat'][3] for r in g],7:[r['feat'][7] for r in g]}
        ranks={k:tie_rank01(vals) for k,vals in basevals.items()}
        volvals=[r['feat'][4] if observed[i] else 0.0 for i,r in enumerate(g)]
        vr=tie_rank01(volvals)
        ratio_vals=[r['feat'][10] if observed[i] else 0.0 for i,r in enumerate(g)]
        rr=tie_rank01(ratio_vals)
        day_regime=float(np.median([r['feat'][0] for r in g])) if g else 0.0
        frozen=[]
        for i,r in enumerate(g):
            m=mem[r['symbol']]
            prior_rate=(m['wins']+1.0)/(m['n']+6.0)
            days_since=999.0
            if m['lastWin']:
                days_since=(dt.date.fromisoformat(day)-dt.date.fromisoformat(m['lastWin'])).days
            feat=list(r['feat'])
            if not observed[i]:
                # Missing Yahoo pre-volume is unknown, not evidence of zero liquidity.
                feat[4]=0.0; feat[10]=0.0
            extra=[
                ranks[0][i],ranks[3][i],vr[i] if observed[i] else 0.5,ranks[7][i],rr[i] if observed[i] else 0.5,
                day_regime,math.log1p(m['n'])/5.0,prior_rate,min(days_since,90)/90.0,
                max(-2,min(4,m['lastMfe']/20.0)),max(-3,min(1,m['lastMae']/20.0)),float(m['lastHit10']),
                observed[i],coverage,
            ]
            z=dict(r); z['feat']=feat+extra
            z['feedAudit']={'preVolumeObserved':bool(observed[i]),'dayPreVolumeCoveragePct':round(100*coverage,2),'tieAwareRanks':True}
            z['memoryAudit']={'priorSessions':m['n'],'priorWins20':m['wins'],'priorWinRateSmoothed':prior_rate,'daysSincePriorWin':days_since}
            frozen.append(z)
        out.extend(frozen)
        for r in g:
            m=mem[r['symbol']]; m['n']+=1; m['wins']+=int(r['hit20']); m['lastMfe']=r['mfe']; m['lastMae']=r['mae']; m['lastHit10']=int(r['hit10'])
            if r['hit20']:m['lastWin']=day
    return out


def fetch_rows():
    mode,syms,raw,errs,_=p.fetch_rows()
    rows=[]
    for s,bars in raw.items():
        if bars: rows.extend(v.v.make_rows(s,bars))
    rows=augment_feed_aware(rows)
    return mode,syms,raw,errs,rows


def main():
    mode,syms,raw,errs,rows=fetch_rows()
    dates=sorted({r['day'] for r in rows})
    if len(dates)<40 or len(rows)<5000: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); dev_dates=dates[:cut]; research_dates=dates[cut:]
    seed=max(12,int(.45*len(dev_dates))); val_dates=dev_dates[seed:]
    blocks=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    scored_blocks=[]; fold_meta=[]
    for bd in blocks:
        first=bd[0]; fit_days={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[r for r in rows if r['day'] in fit_days]; val_rows=[r for r in rows if r['day'] in vd]
        scored,n_oof,n_pos=p.build_meta_from_fit(fit_rows,val_rows)
        scored_blocks.append(scored)
        fold_meta.append({'fitDays':len(fit_days),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows),'oofRows':n_oof,'oofPositives':n_pos})
    grid=p.candidate_grid(scored_blocks); _,mt,bt,dm,topn,fold_metrics=grid[0]
    dev=[r for r in rows if r['day'] in set(dev_dates)]; research=[r for r in rows if r['day'] in set(research_dates)]
    oof=q.expanding_oof(dev); meta=q.fit_meta(oof); base=v.fit(dev)
    rs=q.apply_meta(meta,v.score(base,research)); rsel=q.select_meta(rs,mt,bt,dm,topn); rm=v.v.metrics(rsel,rs)
    vol_obs=sum(1 for r in rows if r.get('feedAudit',{}).get('preVolumeObserved'))
    rep={
      'schemaVersion':'5.21-feed-aware-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['tie-aware deterministic cross-sectional ranks','neutral missing pre-volume features','explicit pre-volume-observed flag','same-day volume coverage feature','stability-first temporal validation retained'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows),'preVolumeObservedRows':vol_obs,'preVolumeObservedPct':round(100*vol_obs/len(rows),2)},
      'development':{'days':len(dev_dates),'rows':len(dev),'folds':fold_meta,'foldMetrics':fold_metrics},
      'selectedConfig':{'metaThreshold':round(mt,6),'baseThreshold':round(bt,6),'maxDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':rm,'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['09:15-only market features','prior-session memory only','same-day ranks use pre-open state only','ties receive equal ranks','missing pre-volume cannot create ordinal rank','each validation fold fit strictly on earlier days','configuration chosen from development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':fold_metrics,'selectedConfig':rep['selectedConfig']},indent=2))
    print(json.dumps(rep,indent=2))

if __name__=='__main__': main()
