#!/usr/bin/env python3
import json, math, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

# Reuse the point-in-time feature builder from v2.4, but DO NOT reuse its model scores.
# v2.5 anchors every percentile to prior TRAINING data only.
g=runpy.run_path('tagit/discovery-lab-v24.py')
early=g['early']; dates=g['dates']; feature_names=g['feature_names']; finite=g['finite']
OUT=pathlib.Path('tag/data/tagit-v25-hierarchical-discovery.json')

def empirical_pct(train_scores, values):
    a=np.sort(np.asarray(train_scores,dtype=float))
    if len(a)==0:return np.zeros(len(values))
    return np.searchsorted(a,np.asarray(values),side='right')/len(a)

def session_key(x):
    s=str(x.get('session') or '').lower()
    return 'pre' if 'pre' in s else ('regular' if s=='regular' else ('after' if 'after' in s else 'other'))

def anchored_pct(train, train_scores, test, test_scores):
    out=np.zeros(len(test),dtype=float)
    global_pct=empirical_pct(train_scores,test_scores)
    for i,x in enumerate(test):
        sk=session_key(x)
        ids=[j for j,z in enumerate(train) if session_key(z)==sk]
        if len(ids)>=500:
            out[i]=empirical_pct(np.asarray(train_scores)[ids],[test_scores[i]])[0]
        else: out[i]=global_pct[i]
    return out

def fit_predict(train,test,seed):
    # sessionCode is excluded from model inputs; session is used only for prior-data percentile anchoring.
    cols=list(range(len(feature_names)-1))
    X=np.array([[x['features'][i] for i in cols] for x in train],dtype=float)
    Xt=np.array([[x['features'][i] for i in cols] for x in test],dtype=float)
    y=np.array([1 if x['target'] else 0 for x in train],dtype=int)
    sc=StandardScaler().fit(X); Xs=sc.transform(X); Xts=sc.transform(Xt)
    pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);w=np.where(y==1,min(180,neg/pos),1.0)
    et=ExtraTreesClassifier(n_estimators=260,max_depth=9,min_samples_leaf=10,max_features=.75,class_weight='balanced_subsample',random_state=seed,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=150,max_leaf_nodes=15,learning_rate=.055,l2_regularization=4,min_samples_leaf=35,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=450,class_weight='balanced',C=.28,random_state=seed+2).fit(Xs,y)
    pet_tr=et.predict_proba(X)[:,1]; phg_tr=hg.predict_proba(X)[:,1]; plr_tr=lr.predict_proba(Xs)[:,1]
    pet=et.predict_proba(Xt)[:,1];phg=hg.predict_proba(Xt)[:,1];plr=lr.predict_proba(Xts)[:,1]
    petp=anchored_pct(train,pet_tr,test,pet);phgp=anchored_pct(train,phg_tr,test,phg);plrp=anchored_pct(train,plr_tr,test,plr)
    # Analog memory. Training analog rates exclude the point itself.
    k=min(61,len(train)); nn=NearestNeighbors(n_neighbors=k,metric='euclidean').fit(Xs)
    dtr,itr=nn.kneighbors(Xs); dt,it=nn.kneighbors(Xts)
    atr=[]
    for ds,ids in zip(dtr,itr):
        ds,ids=ds[1:],ids[1:]; ww=1/(ds+.35); atr.append(float((ww*y[ids]).sum()/max(1e-9,ww.sum())))
    at=[]
    for ds,ids in zip(dt,it):
        ww=1/(ds+.35); at.append(float((ww*y[ids]).sum()/max(1e-9,ww.sum())))
    atr=np.array(atr);at=np.array(at);atp=anchored_pct(train,atr,test,at)
    ensemble=.34*petp+.34*phgp+.20*plrp+.12*atp
    disagreement=np.std(np.vstack([petp,phgp,plrp]),axis=0)
    return [{'pET':float(a),'pHGB':float(b),'pLR':float(c),'analogRate':float(d),'ensemble':float(e),'disagreement':float(f)} for a,b,c,d,e,f in zip(petp,phgp,plrp,at,ensemble,disagreement)]

cal_day=dates[1]
train_cal=[x for x in early if x['day']<cal_day]; cal=[x for x in early if x['day']==cal_day]
train_hold=[x for x in early if x['day']<=cal_day]; hold=[x for x in early if x['day']>cal_day]
calp=[{**x,**p} for x,p in zip(cal,fit_predict(train_cal,cal,2501))]
holdp=[{**x,**p} for x,p in zip(hold,fit_predict(train_hold,hold,2511))]
pred=calp+holdp

# Snapshot-local rank and MARKET HEAT. No future snapshot enters either calculation.
by_snap=defaultdict(list)
for x in pred:by_snap[x['iso']].append(x)
for xs in by_snap.values():
    xs.sort(key=lambda z:z['ensemble'],reverse=True)
    for i,x in enumerate(xs,1):x['rank']=i
    ens=sorted([x['ensemble'] for x in xs],reverse=True)
    top3=sum(ens[:3])/max(1,len(ens[:3])); high=min(1,sum(1 for z in ens if z>=.90)/5)
    rvol=sum(1 for x in xs if x['features'][1]>=math.log1p(3))/max(1,len(xs))
    vv=sum(1 for x in xs if x['features'][2]>=math.log1p(1.5))/max(1,len(xs))
    m5=sum(1 for x in xs if x['features'][6]>=.5)/max(1,len(xs))
    quiet=sum(1 for x in xs if x['features'][13]>=1 and x['features'][1]>=math.log1p(2))/max(1,len(xs))
    heat=max(0,min(1,.34*top3+.22*high+.12*min(1,rvol*8)+.12*min(1,vv*8)+.10*min(1,m5*8)+.10*min(1,quiet*8)))
    for x in xs:x['marketHeat']=heat

# Persistence gate: same ticker/day was already highly ranked recently and is not fading badly.
by_key=defaultdict(list)
for x in sorted(pred,key=lambda z:z['ts']):
    prevs=by_key[x['key']]
    p=prevs[-1] if prevs else None
    if p and 0<(x['ts']-p['ts'])/60000<=90:
        x['persistent']=p.get('rank',999)<=10 and p['ensemble']>=.78 and x['ensemble']>=p['ensemble']-.08
        x['ensembleSlope']=x['ensemble']-p['ensemble']
    else:x['persistent']=False;x['ensembleSlope']=None
    prevs.append(x)

def stat(xs):
    n=len(xs);tp=sum(1 for x in xs if x['target'])
    return {'count':n,'tp':tp,'precision10_60mPct':round(tp/n*100,2) if n else None,
            'recallObsPct':None,'uniqueEvents':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target'])),
            'hit5_30mPct':round(sum(1 for x in xs if x['hit5'])/n*100,2) if n else None,'hit20_dayPct':round(sum(1 for x in xs if x['hit20'])/n*100,2) if n else None}

def with_recall(sel,univ):
    s=stat(sel);den=sum(1 for x in univ if x['target']);s['recallObsPct']=round(s['tp']/den*100,2) if den else None;return s

# Search only on Aug-26. September remains untouched.
configs=[]
for k in [1,2,3,5,8]:
 for e in [.82,.86,.90,.93,.95,.97,.98,.99]:
  for d in [.08,.12,.18,.25,.35]:
   for a in [0,.005,.01,.02,.04]:
    for h in [.45,.55,.65,.75,.82]:
     for p in [False,True]:configs.append((k,e,d,a,h,p))

def apply(xs,c):
    k,e,d,a,h,p=c
    return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d and x['analogRate']>=a and x['marketHeat']>=h and (x['persistent'] if p else True)]

def utility(s):
    n=s['count'];tp=s['tp'];pr=(s['precision10_60mPct'] or 0)/100
    support=min(1,n/25)*min(1,tp/5)
    return pr*100*support + tp*1.5 + min(n,50)*.04

rows=[]
for c in configs:
    s=with_recall(apply(calp,c),calp);rows.append({'cfg':c,'cal':s,'utility':utility(s),'credible90':s['count']>=20 and s['tp']>=5 and (s['precision10_60mPct'] or 0)>=90})
rows.sort(key=lambda z:(z['credible90'],z['utility']),reverse=True)
chosen=rows[0];cfg=chosen['cfg'];cal_sel=apply(calp,cfg);hold_sel=apply(holdp,cfg)

def best_frontier(min_n,min_tp):
    z=[r for r in rows if r['cal']['count']>=min_n and r['cal']['tp']>=min_tp]
    if not z:return None
    r=max(z,key=lambda r:(r['cal']['precision10_60mPct'] or 0,r['cal']['tp']))
    return {'config':r['cfg'],'calibration':r['cal'],'holdout':with_recall(apply(holdp,r['cfg']),holdp)}

# Explicit lanes. RADAR is recall-oriented; DISCOVER uses market heat; ALERT is calibrated abstention.
def radar(xs):return [x for x in xs if x['rank']<=15 and x['ensemble']>=.70]
def discover(xs):return [x for x in xs if x['rank']<=5 and x['ensemble']>=.88 and x['marketHeat']>=.55]

def by_day(xs,selector):
    out={}
    for day in sorted(set(x['day'] for x in xs)):
        u=[x for x in xs if x['day']==day];out[day]={'eligible':len(u),'positives':sum(1 for x in u if x['target']),**with_recall(selector(u),u)}
    return out

report={'schemaVersion':1,'method':'TAGIT_V25_LEAK_FREE_HIERARCHICAL_RARE_EVENT_DISCOVERY','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'objective':'+10% MFE within 60 minutes while current day change remains below +10%',
 'antiLeakageRules':['Model training uses earlier dates only.','Model percentiles are anchored to TRAINING-score distributions only; test-day future distribution is never used.','Session conditioning uses training rows from the same session only.','Market heat is computed from the current snapshot only.','Persistence uses prior observations of the same ticker/day only.','Aug-26 selects thresholds; September is untouched holdout.'],
 'coverage':{'dates':dates,'calibrationDay':cal_day,'trainCalibration':len(train_cal),'calibration':len(calp),'trainHoldout':len(train_hold),'holdoutSeptember':len(holdp),'calibrationPositives':sum(x['target'] for x in calp),'holdoutPositives':sum(x['target'] for x in holdp)},
 'architecture':{'level0':'MARKET_HEAT gate suppresses cold snapshots','level1':'three-model + analog rare-event ensemble','level2':'snapshot-local rank + disagreement','level3':'ticker persistence / non-fading trajectory','lanes':['RADAR','DISCOVER','ALERT/ABSTAIN']},
 'chosenAlert':{'config':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2],'minAnalogRate':cfg[3],'minMarketHeat':cfg[4],'requirePersistence':cfg[5]},'credible90OnCalibration':chosen['credible90'],'calibration':with_recall(cal_sel,calp),'holdoutSeptember':with_recall(hold_sel,holdp)},
 'frontiers':{'bestAny':best_frontier(1,1),'bestMin10Alerts3TP':best_frontier(10,3),'bestMin20Alerts5TP':best_frontier(20,5),'bestMin30Alerts5TP':best_frontier(30,5)},
 'lanes':{'calibration':{'radar':with_recall(radar(calp),calp),'discover':with_recall(discover(calp),calp),'alert':with_recall(cal_sel,calp)},'holdoutSeptember':{'radar':with_recall(radar(holdp),holdp),'discover':with_recall(discover(holdp),holdp),'alert':with_recall(hold_sel,holdp)}},
 'byDay':{'radar':by_day(pred,radar),'discover':by_day(pred,discover),'alert':by_day(pred,lambda xs:apply(xs,cfg))},
 'baselineV06':{'promotionPrecision10_60mPct':5.88,'promotionRecallObservationPct':2.46,'promotionRecallTickerDayPct':5.61},
 'decisionPolicy':{'claim90OnlyIf':'precision >=90% AND >=20 calibration alerts AND >=5 calibration TPs, then must survive untouched holdout','ifNotMet':'do not manufacture 90%; keep ALERT abstaining and continue shadow learning on rich live fields'},
 'limitations':['107 sampled snapshots are sparse and not one-minute bars.','September holdout has very few true +10%/60m events, so precision intervals are wide.','Historical replay cannot credit rich live-only fields: 1m/2m/3m, trades, ATR, bid/ask, structured catalyst semantics, SEC event direction.']}
OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'coverage':report['coverage'],'chosenAlert':report['chosenAlert'],'frontiers':report['frontiers'],'lanes':report['lanes']},indent=2))
