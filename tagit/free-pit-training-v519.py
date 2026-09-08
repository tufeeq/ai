#!/usr/bin/env python3
"""TAGit v5.19 leakage-safe expanding-OOF hard-negative abstention.

Builds on v5.18 but avoids adding more raw complexity. A second-stage meta model is trained
ONLY on expanding-window out-of-fold predictions inside the training period. It learns which
high-scoring base predictions are historically false positives using only pre-open state,
ensemble disagreement, cross-sectional ranks, regime proxy and prior-only memory.
Calibration chooses abstention threshold/top-N; sealed chronological holdout remains untouched.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, os, pathlib
from collections import defaultdict
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

BASE=pathlib.Path('tagit/free-pit-training-v518.py')
spec=importlib.util.spec_from_file_location('v518',BASE); v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v519-free-pit-training.json'; CASES=ROOT/'tagit-v519-free-pit-cases.json'

def meta_vec(r):
    f=r['feat']
    # All inputs are knowable by 09:15 except base score/disagreement, themselves generated
    # causally from models fit on earlier training days.
    idx=[12,13,14,15,16,17,18,19,20,21,22,23]
    return [float(r['score']),float(r['disagreement'])]+[float(f[i]) for i in idx]

def expanding_oof(train):
    days=sorted({r['day'] for r in train})
    if len(days)<12: raise RuntimeError('need >=12 training days for expanding OOF meta learner')
    # First half seeds base model; subsequent contiguous blocks create genuinely out-of-fold predictions.
    seed=max(6,len(days)//2); remain=days[seed:]; folds=np.array_split(np.array(remain,dtype=object),3)
    oof=[]
    for fold in folds:
        fd=[str(x) for x in fold.tolist() if str(x)]
        if not fd: continue
        first=fd[0]; fit_days={d for d in days if d<first}
        fit_rows=[r for r in train if r['day'] in fit_days]
        val_rows=[r for r in train if r['day'] in set(fd)]
        if len(fit_rows)<500 or not val_rows: continue
        m=v.fit(fit_rows); oof.extend(v.score(m,val_rows))
    if len(oof)<500 or sum(int(r['hit20']) for r in oof)<10:
        raise RuntimeError(f'insufficient OOF meta support rows={len(oof)} positives={sum(int(r["hit20"]) for r in oof)}')
    return oof

def fit_meta(oof):
    X=np.asarray([meta_vec(r) for r in oof],float); y=np.asarray([int(r['hit20']) for r in oof],int)
    sc=StandardScaler().fit(X); xs=sc.transform(X)
    # Mild regularization; class balancing helps rare +20% events without changing decision threshold.
    lr=LogisticRegression(max_iter=1400,C=.08,class_weight='balanced',random_state=5191).fit(xs,y)
    return sc,lr

def apply_meta(meta,rows):
    if not rows:return []
    sc,lr=meta; X=np.asarray([meta_vec(r) for r in rows],float)
    p=lr.predict_proba(sc.transform(X))[:,1]
    return [dict(r,metaScore=float(q)) for r,q in zip(rows,p)]

def select_meta(rows,meta_thr,base_thr,dismax,topn):
    by=defaultdict(list)
    for r in rows:
        if r['metaScore']>=meta_thr and r['score']>=base_thr and r['disagreement']<=dismax:
            by[r['day']].append(r)
    out=[]
    for d,g in by.items():
        out+=sorted(g,key=lambda x:(x['metaScore'],x['score']),reverse=True)[:topn]
    return out

def main():
    key=os.getenv('APCA_API_KEY_ID',''); secret=os.getenv('APCA_API_SECRET_KEY','')
    mode='ALPACA_FREE_IEX' if key and secret else 'NASDAQ_PLUS_YAHOO_RECENT_BOOTSTRAP'
    syms=v.v.public_universe(int(os.getenv('TAGIT_MAX_SYMBOLS','650')))
    raw={}; errs={}
    if mode.startswith('ALPACA'):
        end=dt.datetime.now(v.v.UTC); start=end-dt.timedelta(days=int(os.getenv('TAGIT_HISTORY_DAYS','730')))
        fn=lambda s:v.v.alpaca_bars(s,start.isoformat().replace('+00:00','Z'),end.isoformat().replace('+00:00','Z'),key,secret)
    else: fn=v.v.yahoo_bars
    from concurrent.futures import ThreadPoolExecutor,as_completed
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
    dates=sorted({r['day'] for r in rows})
    if len(dates)<20 or len(rows)<500: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    a=max(1,int(.60*len(dates))); b=max(a+1,int(.80*len(dates)))
    td,cd,hd=set(dates[:a]),set(dates[a:b]),set(dates[b:])
    train=[r for r in rows if r['day'] in td]; cal=[r for r in rows if r['day'] in cd]; hold=[r for r in rows if r['day'] in hd]

    oof=expanding_oof(train); meta=fit_meta(oof)
    base=v.fit(train); cs=apply_meta(meta,v.score(base,cal)); hs=apply_meta(meta,v.score(base,hold))

    configs=[]
    mq=np.quantile([r['metaScore'] for r in cs],[.70,.78,.84,.88,.91,.94,.96])
    bq=np.quantile([r['score'] for r in cs],[.55,.65,.75,.82])
    for mt in mq:
      for bt in bq:
       for dm in (.06,.10,.14,.18):
        for topn in (3,5,8):
          sel=select_meta(cs,float(mt),float(bt),dm,topn); m=v.v.metrics(sel,cs)
          n=m['count']; lo=m['dayBlockLower90Pct'] or 0; p=m['precision20Pct'] or 0; t3=m['top3DailyPrecisionPct'] or 0
          utility=5.0*lo+1.2*p+.8*t3+min(n,90)*.05
          if n<30 or m['activeDays']<8: utility-=140
          configs.append((utility,float(mt),float(bt),dm,topn,m))
    configs.sort(reverse=True,key=lambda x:x[0]); _,mt,bt,dm,topn,cm=configs[0]
    hsel=select_meta(hs,mt,bt,dm,topn); hm=v.v.metrics(hsel,hs)

    rep={'schemaVersion':'5.19-free-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'change':['expanding-window OOF base predictions inside train only','hard-negative meta learner','calibration-only abstention threshold','meta ranking for simultaneous opportunities'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows),'oofMetaRows':len(oof),'oofMetaPositives':sum(int(r['hit20']) for r in oof)},
      'splits':{'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd)},
      'selectedConfig':{'metaThreshold':round(mt,6),'baseThreshold':round(bt,6),'maxDisagreement':dm,'topNPerDay':topn},
      'calibration':cm,'holdout':hm,'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['09:15-only market features','memory prior sessions only','OOF meta predictions generated by models fit only on earlier training dates','meta learner fit training OOF only','configuration selected calibration only','sealed holdout scored once after selection']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedHoldout':hsel,'selectedCalibration':select_meta(cs,mt,bt,dm,topn)},indent=2))
    print(json.dumps(rep,indent=2))
if __name__=='__main__': main()
