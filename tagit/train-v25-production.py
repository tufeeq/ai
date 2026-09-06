#!/usr/bin/env python3
import json, math, pathlib, subprocess
from collections import defaultdict
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

DATA='tag/data/discovery-fast.json'
MODEL=pathlib.Path('tag/model/tagit-v25-production.joblib')
META=pathlib.Path('tag/data/tagit-v25-model-meta.json')
FEATURES=['change','logRvol','logVolumeVelocity','shortRate','rvolDeltaPerMin','volumeVelocityAccel','m5','m10','m30','m60','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','logDollarVolume','logFloat','floatRotation','gap','sma20','perfWeek']
ALERT_CFG={'topK':5,'minEnsemble':.98,'maxDisagreement':.08,'minAnalogRate':.04,'minMarketHeat':.45,'requirePersistence':False}

def finite(v):
    try:return v is not None and math.isfinite(float(v))
    except:return False

def num(v):
    if v is None or v=='':return None
    try:
        s=str(v).replace('$','').replace('%','').replace(',','').strip().upper();m=1
        if s.endswith('K'):m=1e3;s=s[:-1]
        elif s.endswith('M'):m=1e6;s=s[:-1]
        elif s.endswith('B'):m=1e9;s=s[:-1]
        return float(s)*m
    except:return None

def avg_volume(v):
    if v is None or v=='':return None
    s=str(v).strip().upper();x=num(v)
    if x is None:return None
    return x if s.endswith(('K','M','B')) else x*1000

def safe_log(v):return math.log1p(max(0,float(v))) if finite(v) else 0.0
def q(v,d=0):return float(v) if finite(v) else d
def ret(a,b):return (a/b-1)*100 if a and b else None

def prior(a,i,target,minf=.3,maxf=2.5):
    best=None;err=1e18
    for j in range(i-1,-1,-1):
        d=(a[i]['ts']-a[j]['ts'])/60000
        if d>target*maxf:break
        if d<target*minf:continue
        e=abs(d-target)
        if e<err:best=a[j];err=e
    return best

def forward(a,i,maxm):
    c=a[i];out=[]
    for j in range(i+1,len(a)):
        d=(a[j]['ts']-c['ts'])/60000
        if d>maxm:break
        out.append(ret(a[j]['price'],c['price']))
    return out

def session_key(s):
    s=str(s or '').lower()
    return 'pre' if 'pre' in s else ('regular' if s=='regular' else ('after' if 'after' in s else 'other'))

revs=subprocess.check_output(['git','log','--format=%H','--reverse','--',DATA],text=True).splitlines()
snaps=[];seen=set();fails=0
for sha in revs:
    try:
        d=json.loads(subprocess.check_output(['git','show',f'{sha}:{DATA}'],text=True,stderr=subprocess.DEVNULL))
        iso=d.get('snapshotTimestampUTC') or d.get('updatedAt')
        if not iso or iso in seen:continue
        seen.add(iso);ts=datetime.fromisoformat(iso.replace('Z','+00:00')).timestamp()*1000
        snaps.append({'iso':iso,'ts':ts,'day':iso[:10],'session':d.get('session') or 'unknown','rows':d.get('rows') or d.get('data') or []})
    except Exception:fails+=1
snaps.sort(key=lambda x:x['ts'])
by=defaultdict(list);raw_rows=0
for s in snaps:
    for r in s['rows']:
        ticker=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper();price=num(r.get('Price'))
        if not ticker or not price or price<=0:continue
        raw_rows+=1
        o={'ticker':ticker,'key':f"{ticker}|{s['day']}",'day':s['day'],'ts':s['ts'],'session':s['session'],'price':price,'volume':num(r.get('Volume')) or 0,'change':num(r.get('Change')) or 0,'rvol':num(r.get('Relative Volume') or r.get('Rel Volume')),'avgVolume':avg_volume(r.get('Average Volume')),'gap':num(r.get('Gap')),'sma20':num(r.get('20-Day Simple Moving Average')),'perfWeek':num(r.get('Performance (Week)')),'floatShares':num(r.get('Shares Float'))}
        by[o['key']].append(o)
for a in by.values():a.sort(key=lambda x:x['ts'])

rows=[]
for a in by.values():
    for i,o in enumerate(a):
        p5,p10,p30,p60=[prior(a,i,t) for t in (5,10,30,60)]
        m5=ret(o['price'],p5['price']) if p5 else None;m10=ret(o['price'],p10['price']) if p10 else None;m30=ret(o['price'],p30['price']) if p30 else None;m60=ret(o['price'],p60['price']) if p60 else None
        prev=a[i-1] if i else None;short=vv=rdelta=vvdelta=None
        if prev:
            dt=(o['ts']-prev['ts'])/60000
            if 0<dt<=30:
                short=ret(o['price'],prev['price'])/dt
                rdelta=(o['rvol']-prev['rvol'])/dt if finite(o['rvol']) and finite(prev['rvol']) else None
                if o['avgVolume'] and o['volume']>=prev['volume']:
                    ex=o['avgVolume']/390*dt
                    if ex>0:vv=(o['volume']-prev['volume'])/ex
                if i>=2 and finite(vv):
                    pp=a[i-2];dt2=(prev['ts']-pp['ts'])/60000
                    if 0<dt2<=30 and prev['avgVolume'] and prev['volume']>=pp['volume']:
                        ex2=prev['avgVolume']/390*dt2
                        if ex2>0:vvdelta=(vv-(prev['volume']-pp['volume'])/ex2)/max(dt,1)
        f60=forward(a,i,60)
        if not f60:continue
        turn=(m5-m30/6) if finite(m5) and finite(m30) else None
        curv=(m5-m10/2) if finite(m5) and finite(m10) else None
        lcurv=(m10-m30/3) if finite(m10) and finite(m30) else None
        quiet=1 if abs(q(m30))<4 and abs(q(o['change']))<10 else 0
        recent=a[max(0,i-3):i+1]
        pos_steps=sum(1 for z in range(1,len(recent)) if recent[z]['price']>recent[z-1]['price'])
        rvol_up=sum(1 for z in range(1,len(recent)) if finite(recent[z]['rvol']) and finite(recent[z-1]['rvol']) and recent[z]['rvol']>recent[z-1]['rvol'])
        dollar=o['price']*o['volume'];floatrot=o['volume']/o['floatShares'] if o['floatShares'] else None
        feat=[o['change'],safe_log(o['rvol']),safe_log(vv),q(short),q(rdelta),q(vvdelta),q(m5),q(m10),q(m30),q(m60),q(turn),q(curv),q(lcurv),quiet,pos_steps,rvol_up,safe_log(dollar),safe_log(o['floatShares']),q(floatrot),q(o['gap']),q(o['sma20']),q(o['perfWeek'])]
        if -20<=o['change']<10 and o['price']>=.15:
            rows.append({'features':feat,'target':max(f60)>=10,'session':session_key(o['session']),'day':o['day']})

X=np.asarray([r['features'] for r in rows],dtype=float);y=np.asarray([1 if r['target'] else 0 for r in rows],dtype=int);sessions=np.asarray([r['session'] for r in rows])
sc=StandardScaler().fit(X);Xs=sc.transform(X)
pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);w=np.where(y==1,min(180,neg/pos),1.0)
et=ExtraTreesClassifier(n_estimators=280,max_depth=9,min_samples_leaf=10,max_features=.75,class_weight='balanced_subsample',random_state=2507,n_jobs=-1).fit(X,y)
hg=HistGradientBoostingClassifier(max_iter=160,max_leaf_nodes=15,learning_rate=.055,l2_regularization=4,min_samples_leaf=35,random_state=2508).fit(X,y,sample_weight=w)
lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.28,random_state=2509).fit(Xs,y)
pet=et.predict_proba(X)[:,1];phg=hg.predict_proba(X)[:,1];plr=lr.predict_proba(Xs)[:,1]
k=min(61,len(rows));nn=NearestNeighbors(n_neighbors=k,metric='euclidean').fit(Xs);d,idx=nn.kneighbors(Xs)
analog=np.empty(len(rows))
for i,(ds,ids) in enumerate(zip(d,idx)):
    ds,ids=ds[1:],ids[1:];ww=1/(ds+.35);analog[i]=float((ww*y[ids]).sum()/max(1e-12,ww.sum()))

def anchors(a):
    out={'global':np.sort(a)}
    for s in ('pre','regular','after','other'):
        vals=a[sessions==s]
        if len(vals)>=100:out[s]=np.sort(vals)
    return out
artifact={'schemaVersion':1,'trainedAtUTC':datetime.now(timezone.utc).isoformat(),'featureNames':FEATURES,'alertConfig':ALERT_CFG,'scaler':sc,'extraTrees':et,'histGradientBoosting':hg,'logistic':lr,'XScaled':Xs,'y':y,'sessions':sessions,'anchors':{'et':anchors(pet),'hgb':anchors(phg),'lr':anchors(plr),'analog':anchors(analog)}}
MODEL.parent.mkdir(parents=True,exist_ok=True);joblib.dump(artifact,MODEL,compress=3)
benchmark={}
try:
    r=json.loads(pathlib.Path('tag/data/tagit-v25-hierarchical-discovery.json').read_text());benchmark={'calibration':r.get('chosenAlert',{}).get('calibration'),'holdoutSeptember':r.get('chosenAlert',{}).get('holdoutSeptember'),'credible90':r.get('chosenAlert',{}).get('credible90OnCalibration')}
except:pass
meta={'schemaVersion':1,'trainedAtUTC':artifact['trainedAtUTC'],'source':DATA,'gitRevisions':len(revs),'snapshots':len(snaps),'parseFailures':fails,'rawRows':raw_rows,'trainingRows':len(rows),'positives':int(y.sum()),'positiveRatePct':round(float(y.mean()*100),4),'dates':sorted(set(r['day'] for r in rows)),'featureNames':FEATURES,'alertConfig':ALERT_CFG,'historicalBenchmark':benchmark,'policy':'SHADOW_ONLY_UNTIL_OUT_OF_SAMPLE_PROMOTION'}
META.write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
