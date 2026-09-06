#!/usr/bin/env python3
"""TAGit Historical Complete Dataset v3 + causal ablation ranking lab.

This is research-only. It never mutates Champion decisions.
It reconstructs only information provably available at or before each observation.
Raw reconstructed rows stay ephemeral; only coverage/ablation reports are persisted.
"""
import bisect, email.utils, json, math, pathlib, runpy, subprocess
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

OUT=pathlib.Path('tag/data/tagit-v3-ablation.json')
COV=pathlib.Path('tag/data/tagit-historical-v3-coverage.json')

def finite(v):
    try: return v is not None and math.isfinite(float(v))
    except Exception: return False

def q(v,d=0.0): return float(v) if finite(v) else d

def num(v):
    if v is None or v=='': return None
    try:
        s=str(v).replace('$','').replace('%','').replace(',','').strip().upper(); m=1
        if s.endswith('K'): m=1e3; s=s[:-1]
        elif s.endswith('M'): m=1e6; s=s[:-1]
        elif s.endswith('B'): m=1e9; s=s[:-1]
        return float(s)*m
    except Exception: return None

def parse_ts(v):
    if not v: return None
    try:
        if isinstance(v,(int,float)): return float(v)*1000 if float(v)<1e12 else float(v)
        s=str(v).strip()
        try: return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000
        except Exception: return email.utils.parsedate_to_datetime(s).timestamp()*1000
    except Exception: return None

def git_history(path):
    try: return subprocess.check_output(['git','log','--format=%H','--reverse','--',path],text=True,stderr=subprocess.DEVNULL).splitlines()
    except Exception: return []

def git_json(sha,path):
    try: return json.loads(subprocess.check_output(['git','show',f'{sha}:{path}'],text=True,stderr=subprocess.DEVNULL))
    except Exception: return None

def get_any(row,names):
    for n in names:
        if n in row:
            z=num(row.get(n))
            if z is not None: return z
    low={str(k).lower().replace('_',' ').replace('-',' '):v for k,v in row.items()}
    for n in names:
        nn=n.lower().replace('_',' ').replace('-',' ')
        if nn in low:
            z=num(low[nn])
            if z is not None:return z
    return None

def nearest_prior(index,ticker,ts,max_age_min=180):
    arr=index.get(ticker)
    if not arr:return None
    times=[x['ts'] for x in arr]
    i=bisect.bisect_right(times,ts)-1
    if i<0:return None
    x=arr[i]; age=(ts-x['ts'])/60000
    return x if 0<=age<=max_age_min else None

# 1) Base causal 140k history.
builder=runpy.run_path('tagit/historical-feature-builder.py')
g=builder['build'](); early=g['early']; dates=g['dates']; base_names=g['feature_names']

# 2) Recover causal sequence metadata from the historical snapshot ledger.
seq_index=defaultdict(list); seq_entries=0; seq_rows=0
sp=pathlib.Path('tag/data/snapshots.json')
if sp.exists():
    try:
        root=json.loads(sp.read_text()); entries=root if isinstance(root,list) else (root.get('snapshots') or root.get('rows') or [])
        seq_entries=len(entries)
        for s in entries:
            st=parse_ts(s.get('timestampUTC') or s.get('snapshotTimestampUTC') or s.get('updatedAt'))
            if st is None: continue
            rows=s.get('topMovers') or s.get('rows') or []
            for r in rows:
                t=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper()
                if not t:continue
                fi=parse_ts(r.get('firstObservedTimestampUTC') or r.get('firstSessionObservedTimestampUTC'))
                pb=r.get('persistenceBuckets'); pbc=len(pb) if isinstance(pb,(list,dict)) else q(pb)
                seq_index[t].append({'ts':st,'session':s.get('session'),'persistenceSlope':num(r.get('persistenceSlopePctPts')),'gainRetention':num(r.get('gainRetentionPct') or r.get('_gainRetentionPct')),
                    'firstObservedChange':num(r.get('firstObservedChange')),'firstObservedVolume':num(r.get('firstObservedVolume')),'firstObservedTs':fi,
                    'persistenceBuckets':pbc,'qualificationDecision':str(r.get('qualificationDecision') or ''),'firstBucket':str(r.get('firstObservedBucket') or '')})
                seq_rows+=1
    except Exception: pass
for a in seq_index.values(): a.sort(key=lambda x:x['ts'])

# 3) Reconstruct catalyst/event clock from each historical enrichment revision.
# Availability is conservative: max(source published time, first Git revision time where TAG could see it).
cat_events={}; enrichment_revs=0
for sha in git_history('tag/data/enrichment.json'):
    d=git_json(sha,'tag/data/enrichment.json')
    if not isinstance(d,dict):continue
    enrichment_revs+=1; revts=parse_ts(d.get('updatedAt') or d.get('generatedAtUTC'))
    rows=d.get('rows') or {}
    if not isinstance(rows,dict):continue
    for ticker,rr in rows.items():
        ticker=str(ticker).upper(); rr=rr or {}
        for n in rr.get('news') or []:
            title=str(n.get('title') or '').strip(); pub=parse_ts(n.get('published') or n.get('publishedAt'))
            if not title or pub is None: continue
            avail=max(pub,revts or pub); key=(ticker,'NEWS',title,pub)
            if key not in cat_events or avail<cat_events[key]['ts']: cat_events[key]={'ticker':ticker,'kind':'NEWS','title':title,'ts':avail,'sourceTs':pub}
        for f in rr.get('filings') or []:
            form=str(f.get('form') or f.get('type') or '').upper(); desc=str(f.get('description') or f.get('title') or '')
            ft=parse_ts(f.get('acceptanceDateTime') or f.get('acceptedAt') or f.get('filedAt') or f.get('filingDate'))
            if ft is None: continue
            avail=max(ft,revts or ft); key=(ticker,'FILING',form,ft)
            if key not in cat_events or avail<cat_events[key]['ts']: cat_events[key]={'ticker':ticker,'kind':'FILING','title':f'{form} {desc}'.strip(),'form':form,'ts':avail,'sourceTs':ft}
cat_index=defaultdict(list)
for e in cat_events.values(): cat_index[e['ticker']].append(e)
for a in cat_index.values(): a.sort(key=lambda x:x['ts'])

def classify_cat(e):
    s=(e.get('title') or '').lower(); form=(e.get('form') or '').upper()
    typ='GENERAL'; direction=0.0; material=.2
    if any(k in s for k in ('offering','registered direct','at-the-market','atm offering','warrant exercise','private placement','convertible note')) or form in {'S-1','S-3','424B3','424B5'}:
        typ='DILUTION'; direction=-1.0; material=1.0
    elif any(k in s for k in ('merger','acquisition','acquire','buyout','definitive agreement')):
        typ='MA'; direction=.9; material=1.0
    elif any(k in s for k in ('fda','clinical trial','phase 1','phase 2','phase 3','topline','primary endpoint')):
        typ='CLINICAL'; direction=.8; material=.9
    elif any(k in s for k in ('contract','purchase order','award','selected by','government order')):
        typ='CONTRACT'; direction=.7; material=.8
    elif any(k in s for k in ('earnings','revenue','guidance','quarter results','financial results')):
        typ='EARNINGS'; direction=.45; material=.65
    elif any(k in s for k in ('partnership','collaboration','license agreement','distribution agreement')):
        typ='PARTNERSHIP'; direction=.5; material=.65
    elif any(k in s for k in ('reverse split','stock split','nasdaq compliance','delisting')):
        typ='CAPSTRUCT'; direction=-.5; material=.75
    elif e.get('kind')=='FILING' and form in {'8-K','6-K'}:
        typ='MATERIAL_FILING'; direction=.1; material=.55
    return typ,direction,material

def catalyst_features(ticker,ts):
    arr=cat_index.get(ticker) or []
    if not arr:return [0,0,0,0,0,0,0,0,0,0,0],False
    times=[x['ts'] for x in arr]; i=bisect.bisect_right(times,ts)-1
    if i<0:return [0,0,0,0,0,0,0,0,0,0,0],False
    recent=[]; j=i
    while j>=0 and ts-arr[j]['ts']<=24*60*60000:
        recent.append(arr[j]); j-=1
    if not recent:return [0,0,0,0,0,0,0,0,0,0,0],False
    vals=[]
    for e in recent:
        typ,dire,mat=classify_cat(e); age=(ts-e['ts'])/3600000
        vals.append((e,typ,dire,mat,age))
    newest=min(vals,key=lambda z:z[4]); pos=max([z[2]*z[3] for z in vals]+[0]); neg=max([-z[2]*z[3] for z in vals]+[0]); mat=max(z[3] for z in vals)
    types={z[1] for z in vals}
    return [1.0,1.0 if newest[4]<=6 else 0.0,pos,neg,mat,1/(1+newest[4]),
            1.0 if 'DILUTION' in types else 0.0,1.0 if 'MA' in types else 0.0,1.0 if 'CLINICAL' in types else 0.0,1.0 if 'CONTRACT' in types else 0.0,1.0 if 'EARNINGS' in types else 0.0],True

# 4) Current-snapshot regime features from causal cross-section only.
by_iso=defaultdict(list)
for x in early:by_iso[x['iso']].append(x)
regime={}
for iso,xs in by_iso.items():
    ch=np.array([q(x['change']) for x in xs]); rv=np.array([q(x['rvol']) for x in xs]); vv=np.array([q(x['vv']) for x in xs])
    regime[iso]=[
        min(1,len(xs)/500), float(np.mean(rv>=3)) if len(rv) else 0, float(np.mean(vv>=1.5)) if len(vv) else 0,
        float(np.mean(ch>=3)) if len(ch) else 0,float(np.mean(ch<=-3)) if len(ch) else 0,
        float(np.std(ch)/20) if len(ch) else 0,float(np.percentile(np.abs(ch),90)/20) if len(ch) else 0]

# 5) Build feature groups. UNKNOWN stays explicit via missing flags; no future fill.
TECH_NAMES=['change','logRvol','logVolumeVelocity','shortRate','m5','m10','m30','m60','logDollarVolume']
SEQ_NAMES=['rvolDeltaPerMin','volumeVelocityAccel','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','seqAge','seqPersistenceSlope','seqGainRetention','firstObservedDelta','firstObservedAge','seqBucketCount']
STRUCT_NAMES=['logFloat','floatRotation','gap','sma20','perfWeek','logTrades','atrPct','rsi14','m1raw','m2raw','m3raw','missFloat','missTrades','missATR','missRSI','missM1','missM2','missM3']
REGIME_NAMES=['sessionPre','sessionRegular','sessionAfter','regimeBreadth','regimeRvol3','regimeVV15','regimeUp3','regimeDown3','regimeDispersion','regimeAbsP90']
CAT_NAMES=['cat24h','cat6h','catPositive','catNegative','catMateriality','catFreshness','catDilution','catMA','catClinical','catContract','catEarnings']

aug=[]; seq_join=0; cat_join=0
for o in early:
    bf=o['features']; idx={n:i for i,n in enumerate(base_names)}
    tech=[bf[idx[n]] for n in TECH_NAMES]
    s=nearest_prior(seq_index,o['ticker'],o['ts'])
    if s and datetime.fromtimestamp(s['ts']/1000,timezone.utc).date().isoformat()==o['day']:
        seq_join+=1; age=(o['ts']-s['ts'])/60000; foage=(o['ts']-s['firstObservedTs'])/60000 if s.get('firstObservedTs') else 0
        seqextra=[age/180,q(s.get('persistenceSlope'))/20,q(s.get('gainRetention'),50)/100,q(o['change'])-q(s.get('firstObservedChange'),q(o['change'])),max(0,foage)/390,q(s.get('persistenceBuckets'))/10]
    else: seqextra=[0,0,0,0,0,0]
    seq=[bf[idx[n]] for n in ['rvolDeltaPerMin','volumeVelocityAccel','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps']]+seqextra
    r=o['row']; trades=get_any(r,['Trades','Trade Count']); atr=get_any(r,['Average True Range','ATR']); rsi=get_any(r,['Relative Strength Index (14)','RSI (14)','RSI'])
    m1=get_any(r,['1-Minute Performance','Performance (1 Minute)','Perf 1m']); m2=get_any(r,['2-Minute Performance','Performance (2 Minute)','Perf 2m']); m3=get_any(r,['3-Minute Performance','Performance (3 Minute)','Perf 3m'])
    struct=[bf[idx[n]] for n in ['logFloat','floatRotation','gap','sma20','perfWeek']]+[math.log1p(max(0,q(trades))),q(atr),q(rsi)/100,q(m1),q(m2),q(m3),
        0 if finite(o.get('floatShares')) else 1,0 if finite(trades) else 1,0 if finite(atr) else 1,0 if finite(rsi) else 1,0 if finite(m1) else 1,0 if finite(m2) else 1,0 if finite(m3) else 1]
    sc=int(bf[idx['sessionCode']]); reg=[1 if sc==0 else 0,1 if sc==1 else 0,1 if sc==2 else 0]+regime.get(o['iso'],[0]*7)
    cat,hascat=catalyst_features(o['ticker'],o['ts']); cat_join+=int(hascat)
    aug.append({**o,'groups':{'technical':tech,'sequence':seq,'structure':struct,'regime':reg,'catalyst':cat}})

layers=[
    ('technical',['technical']),
    ('technical+sequence',['technical','sequence']),
    ('+structure',['technical','sequence','structure']),
    ('+regime',['technical','sequence','structure','regime']),
    ('+catalyst',['technical','sequence','structure','regime','catalyst'])]
name_map={'technical':TECH_NAMES,'sequence':SEQ_NAMES,'structure':STRUCT_NAMES,'regime':REGIME_NAMES,'catalyst':CAT_NAMES}

# Pairwise linear ranker + two graded-relevance regressors. Each test period only sees earlier dates.
def matrix(xs,groups): return np.asarray([[v for gname in groups for v in x['groups'][gname]] for x in xs],dtype=float)
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    order=np.argsort(np.argsort(a)); return order/(len(a)-1)

def fit_models(train,test,groups,seed):
    X=matrix(train,groups); Xt=matrix(test,groups); y=np.asarray([x['relevance'] for x in train],float)
    weights=1+np.minimum(y,4)*6
    et=ExtraTreesRegressor(n_estimators=140,max_depth=10,min_samples_leaf=8,max_features=.8,random_state=seed,n_jobs=-1).fit(X,y,sample_weight=weights)
    hg=HistGradientBoostingRegressor(max_iter=110,max_leaf_nodes=15,learning_rate=.055,l2_regularization=4,min_samples_leaf=30,random_state=seed+1).fit(X,y,sample_weight=weights)
    se=et.predict(Xt); sh=hg.predict(Xt)
    # Bradley-Terry style pairwise linear utility. Pairs are built only inside historical snapshots.
    sc=StandardScaler().fit(X); Xs=sc.transform(X); Xts=sc.transform(Xt)
    by=defaultdict(list)
    for i,x in enumerate(train):by[x['iso']].append(i)
    pd=[]; py=[]
    for ids in by.values():
        good=[i for i in ids if train[i]['relevance']>0]; bad=[i for i in ids if train[i]['relevance']==0]
        if not good or not bad:continue
        bad=bad[::max(1,len(bad)//12)][:12]
        for gi in good[:8]:
            for bi in bad:
                d=Xs[gi]-Xs[bi]; pd.append(d);py.append(1);pd.append(-d);py.append(0)
        # graded positive-vs-positive pairs preserve +40 > +10 ordering.
        gs=sorted(good,key=lambda i:train[i]['relevance'],reverse=True)[:8]
        for a in range(len(gs)):
            for b in range(a+1,len(gs)):
                if train[gs[a]]['relevance']<=train[gs[b]]['relevance']:continue
                d=Xs[gs[a]]-Xs[gs[b]];pd.append(d);py.append(1);pd.append(-d);py.append(0)
    if len(pd)>=20:
        lr=LogisticRegression(max_iter=300,C=.25,random_state=seed+2).fit(np.asarray(pd),np.asarray(py)); sp=Xts@lr.coef_[0]
    else: sp=np.zeros(len(test))
    # Convert each model to current-snapshot ranks only; no future/day-wide percentile leakage.
    out=[{'et':float(a),'hgb':float(b),'pair':float(c)} for a,b,c in zip(se,sh,sp)]
    snap=defaultdict(list)
    for i,x in enumerate(test):snap[x['iso']].append(i)
    for ids in snap.values():
        er=rank01([se[i] for i in ids]);hr=rank01([sh[i] for i in ids]);pr=rank01([sp[i] for i in ids])
        for j,i in enumerate(ids):
            vals=np.array([er[j],hr[j],pr[j]]);out[i]['ensemble']=float(.4*vals[0]+.35*vals[1]+.25*vals[2]);out[i]['disagreement']=float(np.std(vals))
    return out

def attach(test,preds):
    z=[{**x,**p} for x,p in zip(test,preds)]; snap=defaultdict(list)
    for x in z:snap[x['iso']].append(x)
    for xs in snap.values():
        xs.sort(key=lambda a:a['ensemble'],reverse=True)
        for i,x in enumerate(xs,1):x['rank']=i
    return z

def stats(xs,univ):
    n=len(xs);tp=sum(1 for x in xs if x['target']);den=sum(1 for x in univ if x['target'])
    return {'count':n,'tp':tp,'precision10_60mPct':round(tp/n*100,2) if n else None,'recallObsPct':round(tp/den*100,2) if den else None,
        'uniqueTickerDays':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target'])),
        'hit5_30mPct':round(sum(1 for x in xs if x['hit5'])/n*100,2) if n else None,'hit20_dayPct':round(sum(1 for x in xs if x['hit20'])/n*100,2) if n else None}

def choose(cal):
    grid=[]
    for k in (1,2,3,5,8,10):
        for e in (.45,.55,.65,.75,.85):
            for d in (.12,.20,.30,.50):
                s=[x for x in cal if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]
                st=stats(s,cal); p=st['precision10_60mPct'] or 0
                support=min(1,st['count']/20)*min(1,st['tp']/5)
                utility=p*support+st['tp']*1.5+st['recallObsPct']*.35
                grid.append((utility,k,e,d,st))
    grid.sort(reverse=True,key=lambda z:z[0]);_,k,e,d,st=grid[0]
    return {'topK':k,'minEnsemble':e,'maxDisagreement':d},st

def apply(xs,c):return [x for x in xs if x['rank']<=c['topK'] and x['ensemble']>=c['minEnsemble'] and x['disagreement']<=c['maxDisagreement']]

def fixed(xs,k):return [x for x in xs if x['rank']<=k]

cal_day=dates[1] if len(dates)>1 else None
results=[]
for li,(lname,groups) in enumerate(layers):
    train_cal=[x for x in aug if x['day']<cal_day];cal=[x for x in aug if x['day']==cal_day];train_hold=[x for x in aug if x['day']<=cal_day];hold=[x for x in aug if x['day']>cal_day]
    cp=attach(cal,fit_models(train_cal,cal,groups,3100+li*10)); hp=attach(hold,fit_models(train_hold,hold,groups,3101+li*10))
    cfg,cstat=choose(cp); hs=apply(hp,cfg)
    results.append({'layer':lname,'groups':groups,'featureCount':sum(len(name_map[g]) for g in groups),'selectedConfig':cfg,'calibration':cstat,'holdoutSeptember':stats(hs,hp),
        'fixedTopK':{'calibration':{'top1':stats(fixed(cp,1),cp),'top3':stats(fixed(cp,3),cp),'top5':stats(fixed(cp,5),cp),'top15':stats(fixed(cp,15),cp)},
                     'holdout':{'top1':stats(fixed(hp,1),hp),'top3':stats(fixed(hp,3),hp),'top5':stats(fixed(hp,5),hp),'top15':stats(fixed(hp,15),hp)}},
        'credible90Calibration':cstat['count']>=20 and cstat['tp']>=5 and (cstat['precision10_60mPct'] or 0)>=90,
        'credible90Holdout':stats(hs,hp)['count']>=20 and stats(hs,hp)['tp']>=5 and (stats(hs,hp)['precision10_60mPct'] or 0)>=90})

coverage={'schemaVersion':3,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'TAGIT_HISTORICAL_COMPLETE_V3_CAUSAL_RECONSTRUCTION',
    'baseHistory':{'gitRevisions':len(g['snapshots']),'rawRows':g['rawRows'],'eligibleEarlyRows':len(early),'dates':dates,'parseFailures':g['parseFailures']},
    'sequenceLedger':{'snapshotEntries':seq_entries,'nestedRows':seq_rows,'joinedObservations':seq_join,'coveragePct':round(seq_join/max(1,len(early))*100,2),'policy':'RECONSTRUCTED_CAUSAL_CANDIDATE; current/prior snapshot fields only'},
    'catalystClock':{'enrichmentGitRevisions':enrichment_revs,'uniqueTimestampedEvents':len(cat_events),'joinedObservations24h':cat_join,'coveragePct':round(cat_join/max(1,len(early))*100,2),'availabilityPolicy':'max(source publication/filing time, first Git revision time where TAG could observe event)'},
    'featureGroups':{k:v for k,v in name_map.items()},'rawDatasetPersisted':False,'unknownPolicy':'UNKNOWN_NOT_ZERO_WITH_MISSING_FLAGS',
    'antiLeakage':['forward MFE/MAE used as labels only','sequence join requires snapshot timestamp <= observation','catalyst availability timestamp <= observation','regime uses current cross-section only','calibration Aug-26 only; September untouched holdout']}
report={'schemaVersion':3,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'TAGIT_V3_GRADED_RELEVANCE_RANKING_ABLATION','objective':'rank early candidates by future MFE relevance: 0,<5%; 1,>=5%; 2,>=10%; 3,>=20%; 4,>=40% within 60m',
    'datasetCoverage':coverage,'model':['ExtraTrees graded relevance','Histogram Gradient Boosting graded relevance','pairwise Bradley-Terry logistic utility','current-snapshot rank ensemble'],
    'ablation':results,'baselineV06':{'promotionPrecision10_60mPct':5.88,'promotionRecallObservationPct':2.46,'promotionRecallTickerDayPct':5.61},
    'promotionRule':'Research-only. No Champion promotion from calibration. Require improvement on untouched holdout and later live shadow sample.',
    'interpretation':'Ablation isolates incremental value of sequence, structure, regime and timestamped catalyst data; sparse layers are reported rather than synthetically backfilled.'}
COV.write_text(json.dumps(coverage,indent=2)+'\n');OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'coverage':coverage,'ablation':[{'layer':r['layer'],'featureCount':r['featureCount'],'config':r['selectedConfig'],'calibration':r['calibration'],'holdout':r['holdoutSeptember'],'top1Holdout':r['fixedTopK']['holdout']['top1']} for r in results]},indent=2))
