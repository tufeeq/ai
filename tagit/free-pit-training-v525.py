#!/usr/bin/env python3
"""TAGit v5.25 actionable recent-regime research validation.

Combines the two strongest validated research changes so far:
- v5.22 executable primary label: first regular open -> +20%, with fixed pre-hit MAE >= -8%.
- v5.23 causal recent-regime ensemble: long-history + recent-window models with disagreement abstention.

All configuration selection stays inside contiguous development folds. The historical tail has
already been consumed by prior research and remains comparison-only. No claim of untouched or
market-wide precision is allowed.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, pathlib
import numpy as np

P522=pathlib.Path('tagit/free-pit-training-v522.py')
spec=importlib.util.spec_from_file_location('v522',P522); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
P523=pathlib.Path('tagit/free-pit-training-v523.py')
spec2=importlib.util.spec_from_file_location('v523',P523); c=importlib.util.module_from_spec(spec2); spec2.loader.exec_module(c)
v=b.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v525-free-pit-training.json'; CASES=ROOT/'tagit-v525-free-pit-cases.json'


def evaluate_blocks(blocks):
    candidates=[]
    for window in (10,14,18,24):
      for rw in (.25,.40,.55,.70):
        scored=[]; audits=[]
        for fit_rows,val_rows in blocks:
            lm=v.fit(fit_rows); rm,nd,nr,np_=c.fit_recent(fit_rows,window)
            if rm is None: scored=[]; break
            sc=c.blend_score(lm,rm,val_rows,rw); scored.append(sc)
            audits.append({'recentWindowRequested':window,'recentDaysUsed':nd,'recentRows':nr,'recentPositives':np_})
        if len(scored)!=len(blocks): continue
        allr=[r for block in scored for r in block]
        qs=np.quantile([r['score'] for r in allr],[.84,.88,.91,.94,.96,.98])
        for thr in qs:
          for dm in (.05,.08,.12,.16,.22):
            for topn in (2,3,5):
                ms=[]
                for sc in scored:
                    sel=c.select(sc,float(thr),dm,topn); ms.append(v.v.metrics(sel,sc))
                supports=[m['count'] for m in ms]; days=[m['activeDays'] for m in ms]
                lows=[float(m['dayBlockLower90Pct'] or 0) for m in ms]
                wil=[float(m['wilsonLower90Pct'] or 0) for m in ms]
                prec=[float(m['precision20Pct'] or 0) for m in ms]
                t3=[float(m['top3DailyPrecisionPct'] or 0) for m in ms]
                recall=[float(m['winnerDayRecallPct'] or 0) for m in ms]
                # Stability dominates. Actionability adds a modest recall floor so very sparse configs cannot win.
                utility=8*min(lows)+4*min(wil)+1.5*min(prec)+.7*min(t3)+.25*min(recall)-1.3*float(np.std(prec))
                utility += .04*sum(min(x,35) for x in supports)
                if min(supports)<10 or min(days)<5: utility-=250
                candidates.append((utility,window,rw,float(thr),dm,topn,ms,audits))
    if not candidates: raise RuntimeError('no supported actionable recent-regime candidates')
    return max(candidates,key=lambda x:x[0])


def main():
    mode,syms,raw,errs,rows=b.fetch_rows()
    dates=sorted({r['day'] for r in rows})
    if len(dates)<40 or len(rows)<5000: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); dev_dates=dates[:cut]; research_dates=dates[cut:]
    seed=max(12,int(.45*len(dev_dates))); val_dates=dev_dates[seed:]
    bds=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    blocks=[]; fold_info=[]
    for bd in bds:
        first=bd[0]; fd={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[r for r in rows if r['day'] in fd]; val_rows=[r for r in rows if r['day'] in vd]
        blocks.append((fit_rows,val_rows)); fold_info.append({'fitDays':len(fd),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows)})
    _,window,rw,thr,dm,topn,fold_metrics,recent_audits=evaluate_blocks(blocks)

    dev=[r for r in rows if r['day'] in set(dev_dates)]; research=[r for r in rows if r['day'] in set(research_dates)]
    lm=v.fit(dev); rm,nd,nr,np_=c.fit_recent(dev,window)
    if rm is None: raise RuntimeError('selected recent window lacks final support')
    rs=c.blend_score(lm,rm,research,rw); rsel=c.select(rs,thr,dm,topn); research_metrics=v.v.metrics(rsel,rs)
    raw20=sum(int(r['rawHit20From0915']) for r in rows); act20=sum(int(r['hit20']) for r in rows)
    rejected=sum(1 for r in rows if r['rawHit20From0915'] and not r['hit20'])
    rep={
      'schemaVersion':'5.25-actionable-recent-regime-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['actionable first-open +20 label with fixed -8% pre-hit MAE floor','long-history plus recent-window causal ensemble','long-vs-recent disagreement abstention','v5.21 missing-volume protections retained','worst-block temporal selection'],
      'label':{'primary':'first regular open -> +20% with pre-hit MAE >= -8%','thresholdTuned':False},
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'rawPlus20From0915':raw20,'actionablePlus20':act20,'rawWinsRejectedByExecutionPath':rejected},
      'development':{'days':len(dev_dates),'folds':fold_info,'foldMetrics':fold_metrics,'recentAudits':recent_audits},
      'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'scoreThreshold':round(thr,6),'maxLongRecentDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':research_metrics,'finalRecentFit':{'days':nd,'rows':nr,'positives':np_},
      'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['features frozen at <=09:15 ET','regular open/path used only for outcome label','recent model uses only completed sessions before each validation block','configuration selected on development folds only','research tail excluded from selection and already consumed','missing pre-volume neutralized']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':fold_metrics,'selectedConfig':rep['selectedConfig']},indent=2)); print(json.dumps(rep,indent=2))

if __name__=='__main__': main()
