#!/usr/bin/env python3
import json, math, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

# v2.4 builds the strictly causal historical feature table. We ignore its predictions.
g=runpy.run_path('tagit/discovery-lab-v24.py')
early=g['early']; dates=g['dates']; feature_names=g['feature_names']
OUT=pathlib.Path('tag/data/tagit-v25-fast.json')

def sess(x):
 s=str(x.get('session') or '').lower(); return 'pre' if 'pre' in s else ('regular' if s=='regular' else ('after' if 'after' in s else 'other'))
def pct(anchor,vals):
 a=np.sort(np.asarray(anchor,float)); return np.searchsorted(a,np.asarray(vals,float),side='right')/max(1,len(a))
def anchored(train,train_scores,test,test_scores):
 out=pct(train_scores,test_scores)
 for sk in ('pre','regular','after'):
  ti=[i for i,x in enumerate(train) if sess(x)==sk]; vi=[i for i,x in enumerate(test) if sess(x)==sk]
  if len(ti)>=500 and vi:
   z=pct(np.asarray(train_scores)[ti],np.asarray(test_scores)[vi])
   for j,v in zip(vi,z):out[j]=v
 return out

def model(train,test,seed):
 cols=list(range(len(feature_names)-1)) # never feed sessionCode directly
 X=np.asarray([[x['features'][i] for i in cols] for x in train],float); Xt=np.asarray([[x['features'][i] for i in cols] for x in test],float)
 y=np.asarray([int(x['target']) for x in train]); sc=StandardScaler().fit(X);Xs=sc.transform(X);Xts=sc.transform(Xt)
 et=ExtraTreesClassifier(n_estimators=220,max_depth=9,min_samples_leaf=10,max_features=.8,class_weight='balanced_subsample',random_state=seed,n_jobs=-1).fit(X,y)
 tr=et.predict_proba(X)[:,1];te=et.predict_proba(Xt)[:,1];ep=anchored(train,tr,test,te)
 k=min(41,len(train));nn=NearestNeighbors(n_neighbors=k).fit(Xs);dtr,itr=nn.kneighbors(Xs);dt,it=nn.kneighbors(Xts)
 atr=[]
 for ds,ids in zip(dtr,itr):
  ds,ids=ds[1:],ids[1:];w=1/(ds+.4);atr.append(float((w*y[ids]).sum()/max(1e-9,w.sum())))
 av=[]
 for ds,ids in zip(dt,it):
  w=1/(ds+.4);av.append(float((w*y[ids]).sum()/max(1e-9,w.sum())))
 ap=anchored(train,np.asarray(atr),test,np.asarray(av)); ens=.78*ep+.22*ap
 return [{'ensemble':float(e),'analogRate':float(a)} for e,a in zip(ens,av)]

cal_day=dates[1];train_cal=[x for x in early if x['day']<cal_day];cal=[x for x in early if x['day']==cal_day];train_hold=[x for x in early if x['day']<=cal_day];hold=[x for x in early if x['day']>cal_day]
calp=[{**x,**p} for x,p in zip(cal,model(train_cal,cal,2551))];holdp=[{**x,**p} for x,p in zip(hold,model(train_hold,hold,2552))];pred=calp+holdp

# Current-snapshot market heat + ranks only.
by_snap=defaultdict(list)
for x in pred:by_snap[x['iso']].append(x)
for xs in by_snap.values():
 xs.sort(key=lambda z:z['ensemble'],reverse=True)
 for i,x in enumerate(xs,1):x['rank']=i
 top=[x['ensemble'] for x in xs[:5]];top5=sum(top)/max(1,len(top));
 rvol=sum(1 for x in xs if x['features'][1]>=math.log1p(3))/max(1,len(xs));vv=sum(1 for x in xs if x['features'][2]>=math.log1p(1.5))/max(1,len(xs));mom=sum(1 for x in xs if x['features'][6]>=.5)/max(1,len(xs));quiet=sum(1 for x in xs if x['features'][13]>=1 and x['features'][1]>=math.log1p(2))/max(1,len(xs))
 heat=max(0,min(1,.46*top5+.16*min(1,rvol*8)+.14*min(1,vv*8)+.12*min(1,mom*8)+.12*min(1,quiet*8)))
 for x in xs:x['marketHeat']=heat

# Persistence: prior observation already top-ranked and current score not collapsing.
by_key=defaultdict(list)
for x in sorted(pred,key=lambda z:z['ts']):
 p=by_key[x['key']][-1] if by_key[x['key']] else None
 x['persistent']=bool(p and 0<(x['ts']-p['ts'])/60000<=90 and p.get('rank',999)<=10 and p['ensemble']>=.72 and x['ensemble']>=p['ensemble']-.06)
 by_key[x['key']].append(x)

def stat(xs,univ=None):
 n=len(xs);tp=sum(x['target'] for x in xs);den=sum(x['target'] for x in (univ or xs));return {'count':n,'tp':tp,'precision10_60mPct':round(tp/n*100,2) if n else None,'recallObsPct':round(tp/den*100,2) if den else None,'uniqueEvents':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target'])),'hit5_30mPct':round(sum(x['hit5'] for x in xs)/n*100,2) if n else None,'hit20_dayPct':round(sum(x['hit20'] for x in xs)/n*100,2) if n else None}

def apply(xs,c):
 k,e,a,h,p=c;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['analogRate']>=a and x['marketHeat']>=h and (x['persistent'] if p else True)]

# Compact Pareto grid: enough to map precision/coverage without brute-force gaming.
configs=[]
for k in (1,2,3,5,8):
 for e in (.80,.86,.90,.94,.97,.99):
  for a in (0,.005,.015,.03):
   for h in (.45,.58,.70,.80):
    for p in (False,True):configs.append((k,e,a,h,p))
rows=[]
for c in configs:
 s=stat(apply(calp,c),calp);support=min(1,s['count']/20)*min(1,s['tp']/5);score=(s['precision10_60mPct'] or 0)*support+s['tp']*1.5
 rows.append({'cfg':c,'cal':s,'score':score,'credible90':s['count']>=20 and s['tp']>=5 and (s['precision10_60mPct'] or 0)>=90})
rows.sort(key=lambda z:(z['credible90'],z['score']),reverse=True);chosen=rows[0];cfg=chosen['cfg']

def frontier(n,tp):
 z=[r for r in rows if r['cal']['count']>=n and r['cal']['tp']>=tp]
 if not z:return None
 r=max(z,key=lambda q:(q['cal']['precision10_60mPct'] or 0,q['cal']['tp']));return {'config':r['cfg'],'calibration':r['cal'],'holdout':stat(apply(holdp,r['cfg']),holdp)}
def radar(xs):return [x for x in xs if x['rank']<=15 and x['ensemble']>=.65]
def discover(xs):return [x for x in xs if x['rank']<=5 and x['ensemble']>=.85 and x['marketHeat']>=.55]
def byday(xs,fn):
 out={}
 for d in sorted(set(x['day'] for x in xs)):
  u=[x for x in xs if x['day']==d];out[d]={'eligible':len(u),'positives':sum(x['target'] for x in u),**stat(fn(u),u)}
 return out
report={'schemaVersion':1,'method':'TAGIT_V25_FAST_LEAK_FREE_PARETO_HIERARCHICAL','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'objective':'+10% MFE within 60m, discovered while day change <10%',
'antiLeakageRules':['training dates strictly precede scoring date','test score percentiles anchored to training score distributions only','session used only to choose historical anchors','market heat current snapshot only','persistence prior same-ticker observations only','thresholds selected on Aug-26; September untouched'],
'coverage':{'dates':dates,'trainCalibration':len(train_cal),'calibration':len(calp),'calibrationPositives':sum(x['target'] for x in calp),'trainHoldout':len(train_hold),'holdoutSeptember':len(holdp),'holdoutPositives':sum(x['target'] for x in holdp)},
'chosenAlert':{'config':{'topK':cfg[0],'minEnsemble':cfg[1],'minAnalogRate':cfg[2],'minMarketHeat':cfg[3],'requirePersistence':cfg[4]},'credible90OnCalibration':chosen['credible90'],'calibration':stat(apply(calp,cfg),calp),'holdoutSeptember':stat(apply(holdp,cfg),holdp)},
'frontiers':{'bestAny':frontier(1,1),'min10_3tp':frontier(10,3),'min20_5tp':frontier(20,5),'min30_5tp':frontier(30,5)},
'lanes':{'calibration':{'radar':stat(radar(calp),calp),'discover':stat(discover(calp),calp),'alert':stat(apply(calp,cfg),calp)},'holdoutSeptember':{'radar':stat(radar(holdp),holdp),'discover':stat(discover(holdp),holdp),'alert':stat(apply(holdp,cfg),holdp)}},
'byDay':{'radar':byday(pred,radar),'discover':byday(pred,discover),'alert':byday(pred,lambda xs:apply(xs,cfg))},
'baselineV06':{'promotionPrecision10_60mPct':5.88,'promotionRecallObservationPct':2.46,'promotionRecallTickerDayPct':5.61},
'interpretationRule':'90% is accepted only with >=20 alerts, >=5 true positives on calibration and survival on untouched holdout; otherwise ALERT abstains and 90% is not claimed.'}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'coverage':report['coverage'],'chosenAlert':report['chosenAlert'],'frontiers':report['frontiers'],'lanes':report['lanes']},indent=2))
