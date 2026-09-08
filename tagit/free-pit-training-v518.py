#!/usr/bin/env python3
"""TAGit v5.18 leakage-safe extension of v5.17.
Adds only information knowable by 09:15 ET:
1) cross-sectional pre-open ranks within the same day,
2) cumulative symbol success/failure memory from PRIOR completed sessions only,
3) prior-session continuation context.
No holdout feedback is used for configuration selection.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, os, pathlib, random
from collections import defaultdict
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

BASE_PATH=pathlib.Path('tagit/free-pit-training-v517.py')
spec=importlib.util.spec_from_file_location('v517', BASE_PATH); v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v518-free-pit-training.json'; CASES=ROOT/'tagit-v518-free-pit-cases.json'

def rank01(vals):
    n=len(vals)
    if n<=1:return [0.5]*n
    order=np.argsort(np.asarray(vals,float),kind='mergesort'); out=np.empty(n,float)
    for rk,idx in enumerate(order): out[idx]=rk/(n-1)
    return out.tolist()

def augment(rows):
    # Sequential cumulative memory: update only AFTER features for a completed day are frozen.
    byday=defaultdict(list)
    for r in rows: byday[r['day']].append(r)
    mem=defaultdict(lambda:{'n':0,'wins':0,'lastWin':None,'lastMfe':0.0,'lastMae':0.0,'lastHit10':0})
    out=[]
    for day in sorted(byday):
        g=byday[day]
        # day-relative ranks use only 09:15 features, never outcomes
        keys=[0,3,4,7,10]  # preRet, preRange, logPreVol, gap, preVolVsPrev
        ranks={k:rank01([r['feat'][k] for r in g]) for k in keys}
        day_prets=[r['feat'][0] for r in g]
        day_regime=float(np.median(day_prets)) if day_prets else 0.0
        frozen=[]
        for i,r in enumerate(g):
            m=mem[r['symbol']]
            prior_rate=(m['wins']+1.0)/(m['n']+6.0) # Bayesian shrinkage, prior only
            days_since=999.0
            if m['lastWin']:
                days_since=(dt.date.fromisoformat(day)-dt.date.fromisoformat(m['lastWin'])).days
            extra=[
                ranks[0][i],ranks[3][i],ranks[4][i],ranks[7][i],ranks[10][i],
                day_regime,
                math.log1p(m['n'])/5.0,
                prior_rate,
                min(days_since,90)/90.0,
                max(-2,min(4,m['lastMfe']/20.0)),
                max(-3,min(1,m['lastMae']/20.0)),
                float(m['lastHit10']),
            ]
            q=dict(r); q['feat']=list(r['feat'])+extra
            q['memoryAudit']={'priorSessions':m['n'],'priorWins20':m['wins'],'priorWinRateSmoothed':prior_rate,'daysSincePriorWin':days_since}
            frozen.append(q)
        out.extend(frozen)
        # only now reveal today's outcomes to memory for future dates
        for r in g:
            m=mem[r['symbol']]; m['n']+=1; m['wins']+=int(r['hit20']); m['lastMfe']=r['mfe']; m['lastMae']=r['mae']; m['lastHit10']=int(r['hit10'])
            if r['hit20']:m['lastWin']=day
    return out

def fit(train):
    X=np.asarray([r['feat'] for r in train],float); y=np.asarray([int(r['hit20']) for r in train],int)
    pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); cw=min(35,neg/pos)
    w=np.asarray([cw if yy else 1.0 for yy in y])
    sc=StandardScaler().fit(X); xs=sc.transform(X)
    et=ExtraTreesClassifier(n_estimators=500,max_depth=12,min_samples_leaf=10,max_features=.65,class_weight='balanced_subsample',n_jobs=-1,random_state=5181).fit(X,y,sample_weight=w)
    hg=HistGradientBoostingClassifier(max_iter=260,max_leaf_nodes=15,learning_rate=.028,l2_regularization=22,min_samples_leaf=35,random_state=5182).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1200,C=.045,class_weight='balanced',random_state=5183).fit(xs,y,sample_weight=w)
    return sc,et,hg,lr

def score(models,rr):
    if not rr:return []
    sc,et,hg,lr=models; X=np.asarray([r['feat'] for r in rr],float); xs=sc.transform(X)
    ps=np.vstack([et.predict_proba(X)[:,1],hg.predict_proba(X)[:,1],lr.predict_proba(xs)[:,1]])
    mean=.50*ps[0]+.35*ps[1]+.15*ps[2]; dis=np.std(ps,axis=0)
    return [dict(r,score=float(a),disagreement=float(d)) for r,a,d in zip(rr,mean,dis)]

def main():
    key=os.getenv('APCA_API_KEY_ID','');secret=os.getenv('APCA_API_SECRET_KEY','')
    mode='ALPACA_FREE_IEX' if key and secret else 'NASDAQ_PLUS_YAHOO_RECENT_BOOTSTRAP'
    syms=v.public_universe(int(os.getenv('TAGIT_MAX_SYMBOLS','650')))
    raw={};errs={}
    if mode.startswith('ALPACA'):
        end=dt.datetime.now(v.UTC); start=end-dt.timedelta(days=int(os.getenv('TAGIT_HISTORY_DAYS','730')))
        fn=lambda s:v.alpaca_bars(s,start.isoformat().replace('+00:00','Z'),end.isoformat().replace('+00:00','Z'),key,secret)
    else: fn=v.yahoo_bars
    from concurrent.futures import ThreadPoolExecutor,as_completed
    with ThreadPoolExecutor(max_workers=10) as ex:
        fut={ex.submit(fn,s):s for s in syms}
        for f in as_completed(fut):
            s=fut[f]
            try:raw[s]=f.result()
            except Exception as e:errs[s]=f'{type(e).__name__}:{e}'
    rows=[]
    for s,b in raw.items():
        if b:rows.extend(v.make_rows(s,b))
    rows=augment(rows)
    dates=sorted({r['day'] for r in rows})
    if len(dates)<20 or len(rows)<500:raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    a=max(1,int(.60*len(dates))); b=max(a+1,int(.80*len(dates)))
    td,cd,hd=set(dates[:a]),set(dates[a:b]),set(dates[b:])
    train=[r for r in rows if r['day'] in td]; cal=[r for r in rows if r['day'] in cd]; hold=[r for r in rows if r['day'] in hd]
    models=fit(train); cs=score(models,cal); hs=score(models,hold)
    configs=[]
    qs=np.quantile([r['score'] for r in cs],[.82,.87,.90,.93,.95,.97,.98])
    for thr in qs:
      for dm in (.06,.10,.14,.18,.24):
       for topn in (3,5,8):
        sel=v.select(cs,float(thr),dm,topn); m=v.metrics(sel,cs)
        n=m['count']; lo=m['dayBlockLower90Pct'] or 0; p=m['precision20Pct'] or 0; top=m['top3DailyPrecisionPct'] or 0
        # calibration-only objective rewards stability/actionability and penalizes sparse configs
        utility=4.5*lo+1.0*p+.6*top+min(n,100)*.06
        if n<36 or m['activeDays']<8:utility-=120
        configs.append((utility,float(thr),dm,topn,m))
    configs.sort(reverse=True,key=lambda x:x[0]);_,thr,dm,topn,cm=configs[0]
    hsel=v.select(hs,thr,dm,topn); hm=v.metrics(hsel,hs)
    rep={'schemaVersion':'5.18-free-pit','generatedAtUTC':dt.datetime.now(v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
         'change':['same-day cross-sectional pre-open ranks','prior-only cumulative success/failure memory','prior-session continuation context','stronger regularization'],
         'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows)},
         'splits':{'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd)},
         'selectedConfig':{'scoreThreshold':round(thr,6),'maxDisagreement':dm,'topNPerDay':topn},'calibration':cm,'holdout':hm,
         'realDiscoveryPrecisionPct':None,'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
         'antiLeakage':['09:15-only market features','memory computed from prior completed sessions only','day ranks use same-day pre-open features only','chronological 60/20/20','model fit train only','configuration selected calibration only','holdout never used in tuning']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedHoldout':hsel,'selectedCalibration':v.select(cs,thr,dm,topn)},indent=2))
    print(json.dumps(rep,indent=2))
if __name__=='__main__':main()
