#!/usr/bin/env python3
import json, math, statistics, subprocess, pathlib
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import NearestNeighbors

DATA_PATH='tag/data/discovery-fast.json'
OUT_PATH=pathlib.Path('tag/data/tagit-v24-discovery-lab.json')

def git(*args):
    return subprocess.check_output(['git',*args],text=True,stderr=subprocess.DEVNULL,max_buffer=None)

def clamp(x,a=0,b=100): return max(a,min(b,x))
def finite(v):
    try: return v is not None and math.isfinite(float(v))
    except: return False

def num(v):
    if v is None or v=='': return None
    try:
        s=str(v).replace('$','').replace('%','').replace(',','').strip().upper(); m=1
        if s.endswith('K'): m=1e3; s=s[:-1]
        elif s.endswith('M'): m=1e6; s=s[:-1]
        elif s.endswith('B'): m=1e9; s=s[:-1]
        return float(s)*m
    except: return None

def avg_volume(v):
    if v is None or v=='': return None
    s=str(v).strip().upper(); n=num(v)
    if n is None:return None
    return n if s.endswith(('K','M','B')) else n*1000

def ret(a,b): return (a/b-1)*100 if a and b else None

def prior(arr,i,target,minf=.3,maxf=2.5):
    best=None; err=1e18
    for j in range(i-1,-1,-1):
        d=(arr[i]['ts']-arr[j]['ts'])/60000
        if d>target*maxf: break
        if d<target*minf: continue
        e=abs(d-target)
        if e<err: best=arr[j];err=e
    return best

def forward_returns(arr,i,max_min):
    c=arr[i]; out=[]
    for j in range(i+1,len(arr)):
        d=(arr[j]['ts']-c['ts'])/60000
        if d>max_min: break
        out.append(ret(arr[j]['price'],c['price']))
    return out

def safe_log(v): return math.log1p(max(0,v)) if finite(v) else 0.0

def q(v,default=0): return float(v) if finite(v) else default

def session_code(s):
    s=str(s or '').lower()
    return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))

# Load point-in-time Git snapshots.
revs=subprocess.check_output(['git','log','--format=%H','--reverse','--',DATA_PATH],text=True).splitlines()
snaps=[];seen=set();parse_fail=0
for sha in revs:
    try:
        raw=subprocess.check_output(['git','show',f'{sha}:{DATA_PATH}'],text=True,stderr=subprocess.DEVNULL)
        d=json.loads(raw); iso=d.get('snapshotTimestampUTC') or d.get('updatedAt')
        if not iso or iso in seen: continue
        seen.add(iso); ts=datetime.fromisoformat(iso.replace('Z','+00:00')).timestamp()*1000
        rows=d.get('rows') or d.get('data') or []
        snaps.append({'sha':sha,'iso':iso,'ts':ts,'day':iso[:10],'session':d.get('session') or 'unknown','rows':rows})
    except Exception: parse_fail+=1
snaps.sort(key=lambda x:x['ts'])

by_td=defaultdict(list); by_snap=defaultdict(list); raw_rows=0
for snap in snaps:
    for r in snap['rows']:
        ticker=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper(); price=num(r.get('Price'))
        if not ticker or not price or price<=0: continue
        raw_rows+=1
        o={'ticker':ticker,'key':f"{ticker}|{snap['day']}",'day':snap['day'],'iso':snap['iso'],'ts':snap['ts'],'session':snap['session'],'price':price,
           'volume':num(r.get('Volume')) or 0,'change':num(r.get('Change')) or 0,'rvol':num(r.get('Relative Volume') or r.get('Rel Volume')),
           'avgVolume':avg_volume(r.get('Average Volume')),'gap':num(r.get('Gap')),'sma20':num(r.get('20-Day Simple Moving Average')),
           'perfWeek':num(r.get('Performance (Week)')),'floatShares':num(r.get('Shares Float')),'row':r}
        by_td[o['key']].append(o);by_snap[snap['iso']].append(o)
for a in by_td.values():a.sort(key=lambda x:x['ts'])

obs=[]
for key,a in by_td.items():
    for i,o in enumerate(a):
        p5,p10,p30,p60=[prior(a,i,t) for t in (5,10,30,60)]
        m5=ret(o['price'],p5['price']) if p5 else None; m10=ret(o['price'],p10['price']) if p10 else None
        m30=ret(o['price'],p30['price']) if p30 else None; m60=ret(o['price'],p60['price']) if p60 else None
        prev=a[i-1] if i else None; dt=None; short=None; vv=None; rdelta=None; vvdelta=None
        if prev:
            dt=(o['ts']-prev['ts'])/60000
            if 0<dt<=30:
                short=ret(o['price'],prev['price'])/dt
                rdelta=(o['rvol']-prev['rvol'])/dt if finite(o['rvol']) and finite(prev['rvol']) else None
                if o['avgVolume'] and o['volume']>=prev['volume']:
                    exp=o['avgVolume']/390*dt
                    if exp>0: vv=(o['volume']-prev['volume'])/exp
                if i>=2:
                    pp=a[i-2]; dt2=(prev['ts']-pp['ts'])/60000
                    if 0<dt2<=30 and prev['avgVolume'] and prev['volume']>=pp['volume']:
                        exp2=prev['avgVolume']/390*dt2
                        if exp2>0:
                            pvv=(prev['volume']-pp['volume'])/exp2
                            vvdelta=(vv-pvv)/max(dt,1) if finite(vv) else None
        f30=forward_returns(a,i,30); f60=forward_returns(a,i,60); fday=forward_returns(a,i,720)
        if not f60: continue
        mfe30=max(f30) if f30 else None; mfe60=max(f60); mfeday=max(fday) if fday else None
        # Trajectory features: second derivatives / quiet-to-ignite transitions.
        turn=(m5-m30/6) if finite(m5) and finite(m30) else None
        curvature=(m5-(m10/2)) if finite(m5) and finite(m10) else None
        longcurv=(m10-(m30/3)) if finite(m10) and finite(m30) else None
        quiet=1 if abs(q(m30))<4 and abs(q(o['change']))<10 else 0
        # Persistence uses only earlier/current observations.
        recent=a[max(0,i-3):i+1]
        pos_steps=sum(1 for z in range(1,len(recent)) if recent[z]['price']>recent[z-1]['price'])
        rvol_up=sum(1 for z in range(1,len(recent)) if finite(recent[z]['rvol']) and finite(recent[z-1]['rvol']) and recent[z]['rvol']>recent[z-1]['rvol'])
        dollar=o['price']*o['volume']; floatrot=o['volume']/o['floatShares'] if o['floatShares'] else None
        features=[
            o['change'],safe_log(o['rvol']),safe_log(vv),q(short),q(rdelta),q(vvdelta),q(m5),q(m10),q(m30),q(m60),
            q(turn),q(curvature),q(longcurv),quiet,pos_steps,rvol_up,safe_log(dollar),safe_log(o['floatShares']),q(floatrot),
            q(o['gap']),q(o['sma20']),q(o['perfWeek']),session_code(o['session'])
        ]
        obs.append({**o,'features':features,'m5':m5,'m10':m10,'m30':m30,'m60':m60,'short':short,'vv':vv,'rdelta':rdelta,'vvdelta':vvdelta,
                    'mfe30':mfe30,'mfe60':mfe60,'mfeDay':mfeday,'target':mfe60>=10,'hit5':finite(mfe30) and mfe30>=5,'hit20':finite(mfeday) and mfeday>=20})

dates=sorted(set(x['day'] for x in obs)); feature_names=['change','logRvol','logVolumeVelocity','shortRate','rvolDeltaPerMin','volumeVelocityAccel','m5','m10','m30','m60','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','logDollarVolume','logFloat','floatRotation','gap','sma20','perfWeek','sessionCode']

# Only early universe is eligible for discovery.
early=[x for x in obs if -20<=x['change']<10 and x['price']>=.15]

# Fit three intentionally different models + analog memory. Models train only on earlier dates.
def fit_predict(train,test):
    X=np.array([x['features'] for x in train],dtype=float); y=np.array([1 if x['target'] else 0 for x in train],dtype=int)
    Xt=np.array([x['features'] for x in test],dtype=float)
    scaler=StandardScaler().fit(X); Xs=scaler.transform(X); Xts=scaler.transform(Xt)
    # Extra Trees: nonlinear interactions; HGB: smooth boosted boundaries; LR: monotonic sanity anchor.
    et=ExtraTreesClassifier(n_estimators=300,max_depth=10,min_samples_leaf=8,max_features=.75,class_weight='balanced_subsample',random_state=2401,n_jobs=-1).fit(X,y)
    pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); sw=np.where(y==1,min(200,neg/pos),1.0)
    hg=HistGradientBoostingClassifier(max_iter=180,max_leaf_nodes=15,learning_rate=.055,l2_regularization=3.0,min_samples_leaf=30,random_state=2402).fit(X,y,sample_weight=sw)
    lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.35,random_state=2403).fit(Xs,y)
    pet=et.predict_proba(Xt)[:,1]; phg=hg.predict_proba(Xt)[:,1]; plr=lr.predict_proba(Xts)[:,1]
    # Analog memory: nearest historical shapes, with inverse-distance weighted positive rate.
    nn=NearestNeighbors(n_neighbors=min(80,len(train)),metric='euclidean').fit(Xs)
    dist,idx=nn.kneighbors(Xts)
    analog=[]
    for ds,ids in zip(dist,idx):
        w=1/(ds+.25); yy=y[ids]; analog.append(float((w*yy).sum()/w.sum()))
    analog=np.array(analog)
    # Rank-normalized ensemble avoids trusting uncalibrated absolute probability on a rare event.
    def rank01(a):
        order=np.argsort(np.argsort(a)); return order/(max(1,len(a)-1))
    ensemble=.34*rank01(pet)+.34*rank01(phg)+.20*rank01(plr)+.12*rank01(analog)
    disagreement=np.std(np.vstack([rank01(pet),rank01(phg),rank01(plr)]),axis=0)
    return pet,phg,plr,analog,ensemble,disagreement

# True expanding walk-forward predictions, beginning on the second date.
pred=[]
for di in range(1,len(dates)):
    day=dates[di]; train=[x for x in early if x['day']<day]; test=[x for x in early if x['day']==day]
    if not train or sum(x['target'] for x in train)<5 or not test: continue
    pet,phg,plr,analog,ens,dis=fit_predict(train,test)
    for x,a,b,c,d,e,f in zip(test,pet,phg,plr,analog,ens,dis):
        pred.append({**x,'pET':float(a),'pHGB':float(b),'pLR':float(c),'analogRate':float(d),'ensemble':float(e),'disagreement':float(f)})

# Cross-sectional rank per snapshot. This is causal because only current snapshot predictions are compared.
ps=defaultdict(list)
for x in pred: ps[x['iso']].append(x)
for xs in ps.values():
    xs.sort(key=lambda z:z['ensemble'],reverse=True)
    for rank,x in enumerate(xs,1): x['rank']=rank

# Date split: Aug-26 is calibration/selection; September is untouched holdout.
cal_day=dates[1] if len(dates)>1 else None
cal=[x for x in pred if x['day']==cal_day]
hold=[x for x in pred if x['day']>cal_day]

# Research grid. We do not label a 90% lane unless it has >=20 alerts and >=5 TPs on calibration.
configs=[]
for topk in [1,2,3,5,8,10,15]:
  for minens in [.80,.88,.92,.95,.97,.98,.99]:
    for maxdis in [.12,.18,.25,.40]:
      for minanalog in [0,.005,.01,.02,.04]:
        configs.append((topk,minens,maxdis,minanalog))

def apply(xs,cfg):
    k,pe,md,ar=cfg
    return [x for x in xs if x.get('rank',999)<=k and x['ensemble']>=pe and x['disagreement']<=md and x['analogRate']>=ar]

def stat(xs):
    n=len(xs); tp=sum(1 for x in xs if x['target']);
    return {'count':n,'tp':tp,'precision10_60mPct':round(tp/n*100,2) if n else None,
            'hit5_30mPct':round(sum(1 for x in xs if x['hit5'])/n*100,2) if n else None,
            'hit20_dayPct':round(sum(1 for x in xs if x['hit20'])/n*100,2) if n else None,
            'uniqueEvents':len(set(x['key'] for x in xs)),
            'capturedTickerDays':len(set(x['key'] for x in xs if x['target']))}

# Select on calibration only. Reward precision strongly, but prevent one-shot gaming.
rows=[]
for cfg in configs:
    s=stat(apply(cal,cfg)); n=s['count'];tp=s['tp'];p=s['precision10_60mPct'] or 0
    credible=(n>=20 and tp>=5)
    utility=(p*1.0)+(min(tp,12)*2.0)+(min(n,80)/80*4)-(0 if credible else 18)
    rows.append({'cfg':cfg,'calibration':s,'credible90':credible and p>=90,'utility':utility})
rows.sort(key=lambda r:(r['credible90'],r['utility']),reverse=True)
chosen=rows[0] if rows else None
chosen_cfg=chosen['cfg'] if chosen else (3,.9,.25,0)
cal_sel=apply(cal,chosen_cfg); hold_sel=apply(hold,chosen_cfg)

# A recall-oriented RADAR lane is kept separate from precision ALERT lane.
def radar(xs): return [x for x in xs if x.get('rank',999)<=15 and x['ensemble']>=.75]
def discover(xs): return [x for x in xs if x.get('rank',999)<=5 and x['ensemble']>=.90 and x['disagreement']<=.30]

def by_day(xs,selector):
    out={}
    for d in sorted(set(x['day'] for x in xs)):
        sel=selector([x for x in xs if x['day']==d]); base=[x for x in xs if x['day']==d]
        out[d]={'eligible':len(base),'positives':sum(1 for x in base if x['target']),**stat(sel)}
    return out

# Feature importance from an all-pre-holdout ExtraTrees model is descriptive only; never used to tune holdout.
importance=[]
train_imp=[x for x in early if x['day']<=cal_day]
if train_imp:
    X=np.array([x['features'] for x in train_imp]);y=np.array([1 if x['target'] else 0 for x in train_imp])
    mdl=ExtraTreesClassifier(n_estimators=400,max_depth=10,min_samples_leaf=8,max_features=.75,class_weight='balanced_subsample',random_state=2410,n_jobs=-1).fit(X,y)
    importance=sorted([{'feature':n,'importance':round(float(v),5)} for n,v in zip(feature_names,mdl.feature_importances_)],key=lambda z:z['importance'],reverse=True)

report={
 'schemaVersion':1,'method':'TAGIT_V24_RARE_EVENT_ENSEMBLE_EXPANDING_WALK_FORWARD','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'objective':'+10% maximum favorable excursion within 60 minutes while discovered before +10% day change',
 'antiLeakageRules':['All features use current/prior snapshots only.','Models for each test day train only on earlier dates.','Ranks are within the current snapshot only.','Aug-26 selects the abstention configuration; September is untouched holdout.','Forward MFE is label-only.'],
 'coverage':{'gitRevisions':len(revs),'snapshots':len(snaps),'parseFailures':parse_fail,'rawRows':raw_rows,'eligibleEarlyObservations':len(early),'walkForwardPredictions':len(pred),'dates':dates},
 'architecture':{'RADAR':'recall lane: top-15 ensemble >= .75','DISCOVER':'precision lane: top-5 ensemble >= .90 and model disagreement <= .30','ALERT':'calibration-selected abstention lane; 90% is only claimed with >=20 alerts and >=5 true positives','models':['ExtraTrees nonlinear interactions','Histogram Gradient Boosting with rare-event weights','Balanced Logistic Regression anchor','Nearest-neighbor analog memory'],'featureCount':len(feature_names),'features':feature_names},
 'selection':{'calibrationDay':cal_day,'chosenConfig':{'topK':chosen_cfg[0],'minEnsemble':chosen_cfg[1],'maxDisagreement':chosen_cfg[2],'minAnalogRate':chosen_cfg[3]},'credible90FoundOnCalibration':bool(chosen and chosen['credible90']),'calibration':stat(cal_sel),'holdoutSeptember':stat(hold_sel)},
 'lanes':{'calibration':{'radar':stat(radar(cal)),'discover':stat(discover(cal)),'alert':stat(cal_sel)},'holdoutSeptember':{'radar':stat(radar(hold)),'discover':stat(discover(hold)),'alert':stat(hold_sel)}},
 'byDay':{'radar':by_day(pred,radar),'discover':by_day(pred,discover),'alert':by_day(pred,lambda xs:apply(xs,chosen_cfg))},
 'topFeatureImportanceDescriptive':importance[:15],
 'baselineV06':{'discoverPrecision10_60mPct':1.81,'discoverRecallTickerDayPct':11.21,'promotionPrecision10_60mPct':5.88,'promotionRecallObservationPct':2.46,'promotionRecallTickerDayPct':5.61},
 'bestCalibrationConfigs':[{'config':{'topK':r['cfg'][0],'minEnsemble':r['cfg'][1],'maxDisagreement':r['cfg'][2],'minAnalogRate':r['cfg'][3]},'credible90':r['credible90'],'calibration':r['calibration']} for r in rows[:15]],
 'limitations':['Only 107 sampled historical snapshots are available; not one-minute bars.','Most positive examples are concentrated on Aug-25/Aug-26, making September holdout sparse.','Rich production-only fields such as 1m/2m/3m, trades, ATR, spread, news direction and SEC event semantics cannot be credited historically when absent.','90% precision is not considered established unless it survives untouched holdout with meaningful support; the system abstains rather than fabricates confidence.']
}
OUT_PATH.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'coverage':report['coverage'],'selection':report['selection'],'lanes':report['lanes'],'topFeatures':importance[:8]},indent=2))
