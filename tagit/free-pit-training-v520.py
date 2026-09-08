#!/usr/bin/env python3
"""TAGit v5.20 stability-first blocked temporal validation.

Research-only successor to v5.19. The historical 20% tail has already been inspected by prior
versions, so it is explicitly treated as CONSUMED_RESEARCH_HOLDOUT, never untouched evidence.
Configuration selection is performed only on three contiguous temporal validation blocks inside
the first 80% development period. Objective maximizes worst-block uncertainty/support, not pooled
calibration precision. This directly targets calibration-to-holdout regime drift.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, os, pathlib
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v519.py')
spec=importlib.util.spec_from_file_location('v519',BASE); q=importlib.util.module_from_spec(spec); spec.loader.exec_module(q)
v=q.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v520-free-pit-training.json'; CASES=ROOT/'tagit-v520-free-pit-cases.json'


def fetch_rows():
    key=os.getenv('APCA_API_KEY_ID',''); secret=os.getenv('APCA_API_SECRET_KEY','')
    mode='ALPACA_FREE_IEX' if key and secret else 'NASDAQ_PLUS_YAHOO_RECENT_BOOTSTRAP'
    syms=v.v.public_universe(int(os.getenv('TAGIT_MAX_SYMBOLS','650')))
    raw={}; errs={}
    if mode.startswith('ALPACA'):
        end=dt.datetime.now(v.v.UTC); start=end-dt.timedelta(days=int(os.getenv('TAGIT_HISTORY_DAYS','730')))
        fn=lambda s:v.v.alpaca_bars(s,start.isoformat().replace('+00:00','Z'),end.isoformat().replace('+00:00','Z'),key,secret)
    else:
        fn=v.v.yahoo_bars
    with ThreadPoolExecutor(max_workers=10) as ex:
        fut={ex.submit(fn,s):s for s in syms}
        for f in as_completed(fut):
            s=fut[f]
            try: raw[s]=f.result()
            except Exception as e: errs[s]=f'{type(e).__name__}:{e}'
    rows=[]
    for s,bars in raw.items():
        if bars: rows.extend(v.v.make_rows(s,bars))
    rows=v.augment(rows)
    return mode,syms,raw,errs,rows


def build_meta_from_fit(fit_rows, val_rows):
    # Meta learner is always trained from expanding OOF predictions generated only within fit_rows.
    oof=q.expanding_oof(fit_rows)
    meta=q.fit_meta(oof)
    base=v.fit(fit_rows)
    scored=q.apply_meta(meta,v.score(base,val_rows))
    return scored,len(oof),sum(int(r['hit20']) for r in oof)


def candidate_grid(scored_blocks):
    allrows=[r for b in scored_blocks for r in b]
    mq=np.quantile([r['metaScore'] for r in allrows],[.70,.78,.84,.90,.94])
    bq=np.quantile([r['score'] for r in allrows],[.55,.68,.80])
    out=[]
    for mt in mq:
      for bt in bq:
       for dm in (.08,.12,.18):
        for topn in (2,3,5):
          ms=[]; selected=[]
          for block in scored_blocks:
            sel=q.select_meta(block,float(mt),float(bt),dm,topn)
            m=v.v.metrics(sel,block); ms.append(m); selected.append(sel)
          supports=[m['count'] for m in ms]; days=[m['activeDays'] for m in ms]
          lows=[float(m['dayBlockLower90Pct'] or 0) for m in ms]
          wil=[float(m['wilsonLower90Pct'] or 0) for m in ms]
          prec=[float(m['precision20Pct'] or 0) for m in ms]
          top3=[float(m['top3DailyPrecisionPct'] or 0) for m in ms]
          # Stability first: worst block dominates; pooled-looking spikes cannot win.
          score=8*min(lows)+4*min(wil)+1.2*min(prec)+0.6*min(top3)+0.05*sum(min(x,30) for x in supports)
          if min(supports)<8 or min(days)<4: score-=250
          dispersion=np.std(prec) if len(prec)>1 else 0
          score-=1.5*dispersion
          out.append((score,float(mt),float(bt),dm,topn,ms))
    return sorted(out,key=lambda x:x[0],reverse=True)


def main():
    mode,syms,raw,errs,rows=fetch_rows()
    dates=sorted({r['day'] for r in rows})
    if len(dates)<40 or len(rows)<5000: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')

    # Last 20% is a consumed research comparison tail. Never use for selection.
    cut=max(1,int(.80*len(dates)))
    dev_dates=dates[:cut]; research_dates=dates[cut:]
    # Three contiguous validation blocks in latter half of development; each fit uses strictly earlier dates.
    seed=max(12,int(.45*len(dev_dates)))
    val_dates=dev_dates[seed:]
    blocks=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    scored_blocks=[]; fold_meta=[]
    for bd in blocks:
        first=bd[0]; fit_days={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[r for r in rows if r['day'] in fit_days]; val_rows=[r for r in rows if r['day'] in vd]
        if len(fit_rows)<3000 or len(val_rows)<300: raise RuntimeError('insufficient temporal fold support')
        scored,n_oof,n_pos=build_meta_from_fit(fit_rows,val_rows)
        scored_blocks.append(scored)
        fold_meta.append({'fitDays':len(fit_days),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows),'oofRows':n_oof,'oofPositives':n_pos})

    grid=candidate_grid(scored_blocks)
    _,mt,bt,dm,topn,fold_metrics=grid[0]

    # Refit using all development data only. Research tail is scored after freeze.
    dev=[r for r in rows if r['day'] in set(dev_dates)]
    research=[r for r in rows if r['day'] in set(research_dates)]
    oof=q.expanding_oof(dev); meta=q.fit_meta(oof); base=v.fit(dev)
    rs=q.apply_meta(meta,v.score(base,research)); rsel=q.select_meta(rs,mt,bt,dm,topn); rm=v.v.metrics(rsel,rs)

    rep={
      'schemaVersion':'5.20-stability-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY',
      'holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['three contiguous temporal validation blocks','worst-block uncertainty objective','support floor per validation block','precision-dispersion penalty','no configuration selection from research tail'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows)},
      'development':{'days':len(dev_dates),'rows':len(dev),'folds':fold_meta,'foldMetrics':fold_metrics},
      'selectedConfig':{'metaThreshold':round(mt,6),'baseThreshold':round(bt,6),'maxDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':rm,
      'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['09:15-only market features','prior-session memory only','each validation fold fit strictly on earlier days','configuration chosen from development folds only','research tail excluded from selection','historical tail explicitly marked consumed and cannot support promotion']
    }
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2));
    CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':fold_metrics,'selectedConfig':rep['selectedConfig']},indent=2))
    print(json.dumps(rep,indent=2))

if __name__=='__main__': main()
