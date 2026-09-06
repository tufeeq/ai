#!/usr/bin/env python3
"""TAGit v3.1 sequence-native causal ranking lab.

Uses the accumulated snapshot ledger (Aug 11-Sep 4) as an independent time-series
research dataset. It re-qualifies only fields that are causally available at the
snapshot timestamp, derives labels from later same-day snapshots, and leaves Aug
27-Sep 4 untouched for holdout evaluation. Research-only; no Champion mutation.
"""
import json, math, pathlib
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/snapshots.json')
OUT=pathlib.Path('tag/data/tagit-v31-sequence-native.json')

def num(v):
    if v is None or v=='': return None
    try:
        return float(str(v).replace('$','').replace('%','').replace(',','').strip())
    except Exception: return None

def ts(v):
    if not v:return None
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00')).timestamp()*1000
    except Exception:return None

def safe_log(v): return math.log1p(max(0,float(v))) if v is not None and math.isfinite(float(v)) else 0.0

def q(v,d=0.0):
    try:return float(v) if v is not None and math.isfinite(float(v)) else d
    except Exception:return d

def ret(a,b): return (a/b-1)*100 if a and b else None

def relevance(mfe):
    if mfe>=40:return 4
    if mfe>=20:return 3
    if mfe>=10:return 2
    if mfe>=5:return 1
    return 0

def sess_code(s):
    z=str(s or '').lower()
    return 0 if 'pre' in z else (1 if z=='regular' else (2 if 'after' in z else 3))

root=json.loads(SRC.read_text())
entries=root if isinstance(root,list) else root.get('snapshots',[])
entries=sorted(entries,key=lambda s:ts(s.get('timestampUTC') or s.get('snapshotTimestampUTC')) or 0)

# Flatten snapshots and compute causal current-cross-section context.
obs=[]; snapshot_meta={}
for si,s in enumerate(entries):
    st=ts(s.get('timestampUTC') or s.get('snapshotTimestampUTC'))
    if st is None:continue
    day=datetime.fromtimestamp(st/1000,timezone.utc).date().isoformat()
    rows=s.get('topMovers') or s.get('rows') or []
    clean=[]
    for r in rows:
        ticker=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper()
        price=num(r.get('Price')); change=num(r.get('Change')); volume=num(r.get('Volume'))
        if not ticker or price is None or price<=0 or change is None or volume is None:continue
        clean.append((ticker,price,change,volume,r))
    if not clean:continue
    ch=np.asarray([x[2] for x in clean],float); vol=np.asarray([x[3] for x in clean],float)
    order_ch=np.argsort(np.argsort(ch)); order_vol=np.argsort(np.argsort(vol))
    cr=order_ch/max(1,len(clean)-1); vr=order_vol/max(1,len(clean)-1)
    regime=[float(np.mean(ch>=3)),float(np.mean(ch<=-3)),float(np.std(ch)/20),float(np.percentile(np.abs(ch),90)/20),min(1,len(clean)/100)]
    snapshot_meta[si]={'ts':st,'day':day,'session':s.get('session'),'regime':regime,'rows':len(clean)}
    for j,(ticker,price,change,volume,r) in enumerate(clean):
        obs.append({'si':si,'ts':st,'day':day,'session':s.get('session'),'ticker':ticker,'key':ticker+'|'+day,
                    'price':price,'change':change,'volume':volume,'changeRank':float(cr[j]),'volumeRank':float(vr[j]),'row':r})

by_key=defaultdict(list)
for o in obs:by_key[o['key']].append(o)
for a in by_key.values():a.sort(key=lambda x:x['ts'])

# Build labels from later same-day snapshots and features from current/prior only.
data=[]; label_gaps=[]
for key,a in by_key.items():
    first=a[0]
    prev_vel=None
    for i,o in enumerate(a):
        if not (.15<=o['price']<=20 and -20<=o['change']<10):continue
        futures=[]
        for z in a[i+1:]:
            dm=(z['ts']-o['ts'])/60000
            if dm>75:break
            if dm>=3:futures.append((dm,z))
        if not futures:continue
        rets=[ret(z['price'],o['price']) for _,z in futures]
        rets=[x for x in rets if x is not None]
        if not rets:continue
        mfe=max(rets); mae=min(rets); label_gaps.extend(dm for dm,_ in futures)
        prev=a[i-1] if i else None
        prev2=a[i-2] if i>=2 else None
        dt=(o['ts']-prev['ts'])/60000 if prev else None
        price_vel=change_vel=vol_vel=vol_acc=0.0
        if prev and dt and 0<dt<=120:
            price_vel=q(ret(o['price'],prev['price']))/dt*10
            change_vel=(o['change']-prev['change'])/dt*10
            vol_vel=max(0,o['volume']-prev['volume'])/dt*10
            if prev2:
                dt2=(prev['ts']-prev2['ts'])/60000
                if dt2 and 0<dt2<=120:
                    pvv=max(0,prev['volume']-prev2['volume'])/dt2*10
                    vol_acc=(vol_vel-pvv)/max(1,abs(pvv)+1)
        age=(o['ts']-first['ts'])/60000
        first_change=o['change']-first['change']
        first_vol_ratio=math.log1p(max(0,o['volume']))-math.log1p(max(0,first['volume']))
        ps=num(o['row'].get('persistenceSlopePctPts'))
        pbs=o['row'].get('persistenceBuckets'); pbc=len(pbs) if isinstance(pbs,(list,dict)) else 0
        trend=str(o['row'].get('persistenceTrend') or '').lower()
        trend_up=1 if any(k in trend for k in ('up','rising','positive','acceler')) else 0
        trend_dn=1 if any(k in trend for k in ('down','fall','negative','decay')) else 0
        sig=o['row'].get('signals') or []
        sig_gain=1 if 'ta_topgainers' in sig else 0; sig_uv=1 if 'ta_unusualvolume' in sig else 0; sig_active=1 if 'ta_mostactive' in sig else 0
        sc=sess_code(o['session']); reg=snapshot_meta[o['si']]['regime']
        tech=[math.log(max(o['price'],1e-4)),o['change']/20,safe_log(o['volume'])/20,o['changeRank'],o['volumeRank'],sig_gain,sig_uv,sig_active,
              1 if sc==0 else 0,1 if sc==1 else 0,1 if sc==2 else 0]
        seq=[price_vel/5,change_vel/5,safe_log(vol_vel)/15,max(-3,min(3,vol_acc)),age/390,first_change/20,first_vol_ratio/10,q(ps)/20,pbc/10,trend_up,trend_dn]
        regime=reg
        data.append({**o,'mfe':mfe,'mae':mae,'target':mfe>=10,'rel':relevance(mfe),'groups':{'technical':tech,'sequence':seq,'regime':regime}})
        prev_vel=vol_vel

# Split by dates: training through Aug 24; calibration Aug 25-26; untouched holdout Aug 27 onward.
train_end='2026-08-24'; cal_start='2026-08-25'; cal_end='2026-08-26'; hold_start='2026-08-27'
train=[x for x in data if x['day']<=train_end]
cal=[x for x in data if cal_start<=x['day']<=cal_end]
hold=[x for x in data if x['day']>=hold_start]

layers=[('technical',['technical']),('technical+sequence',['technical','sequence']),('technical+sequence+regime',['technical','sequence','regime'])]

def mat(xs,groups): return np.asarray([[v for g in groups for v in x['groups'][g]] for x in xs],float)

def pair_model(train,X,groups):
    bys=defaultdict(list)
    for i,x in enumerate(train):bys[x['si']].append(i)
    dif=[]; y=[]; rng=np.random.default_rng(3107)
    for ids in bys.values():
        pairs=[]
        for ia in ids:
            for ib in ids:
                if train[ia]['rel']>train[ib]['rel']:pairs.append((ia,ib))
        if len(pairs)>40:pairs=[pairs[k] for k in rng.choice(len(pairs),40,replace=False)]
        for ia,ib in pairs:
            dif.append(X[ia]-X[ib]);y.append(1)
            dif.append(X[ib]-X[ia]);y.append(0)
    if len(set(y))<2:return None,None
    sc=StandardScaler().fit(np.asarray(dif)); lr=LogisticRegression(max_iter=500,C=.4,random_state=3108).fit(sc.transform(np.asarray(dif)),np.asarray(y))
    return sc,lr

def fit_predict(tr,te,groups):
    X=mat(tr,groups); Xt=mat(te,groups); yr=np.asarray([x['rel'] for x in tr],float)
    et=ExtraTreesRegressor(n_estimators=260,max_depth=10,min_samples_leaf=8,max_features=.8,random_state=3110,n_jobs=-1).fit(X,yr)
    hg=HistGradientBoostingRegressor(max_iter=160,max_leaf_nodes=15,learning_rate=.055,l2_regularization=3,min_samples_leaf=25,random_state=3111).fit(X,yr)
    sc,lr=pair_model(tr,X,groups)
    s1=et.predict(Xt);s2=hg.predict(Xt);s3=np.zeros(len(te)) if lr is None else lr.predict_proba(sc.transform(Xt))[:,1]
    out=[]
    bys=defaultdict(list)
    for i,x in enumerate(te):bys[x['si']].append(i)
    for ids in bys.values():
        arrs=[s1[ids],s2[ids],s3[ids]]; rr=[]
        for aa in arrs:
            if len(aa)<=1:r=np.ones(len(aa))
            else:r=np.argsort(np.argsort(aa))/max(1,len(aa)-1)
            rr.append(r)
        ens=.38*rr[0]+.34*rr[1]+.28*rr[2]; dis=np.std(np.vstack(rr),axis=0)
        for loc,i in enumerate(ids):out.append((i,float(ens[loc]),float(dis[loc])))
    scored=[None]*len(te)
    for i,e,d in out:scored[i]={**te[i],'ensemble':e,'disagreement':d}
    for xs in defaultdict(list).values():pass
    bysnap=defaultdict(list)
    for x in scored:bysnap[x['si']].append(x)
    for xs in bysnap.values():
        xs.sort(key=lambda z:z['ensemble'],reverse=True)
        for r,x in enumerate(xs,1):x['rank']=r
    return scored

def stat(xs,univ):
    n=len(xs);tp=sum(x['target'] for x in xs);den=sum(x['target'] for x in univ)
    return {'count':n,'tp':tp,'precision10_75mPct':round(tp/n*100,2) if n else None,'recallObsPct':round(tp/den*100,2) if den else None,
            'uniqueTickerDays':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target'])),
            'hit20Pct':round(sum(x['mfe']>=20 for x in xs)/n*100,2) if n else None}

def apply(xs,c):
    k,e,d=c;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]

def choose(calp):
    rows=[]
    for k in (1,2,3,5,8,10,15):
        for e in (.45,.60,.72,.82,.90):
            for d in (.12,.20,.30,.45):
                s=stat(apply(calp,(k,e,d)),calp);p=s['precision10_75mPct'] or 0
                support=min(1,s['count']/20)*min(1,s['tp']/4);util=p*support+s['tp']*1.8+s['recallObsPct']*.25
                rows.append(((k,e,d),s,util))
    return max(rows,key=lambda z:z[2])

report_layers=[]
for lname,groups in layers:
    calp=fit_predict(train,cal,groups) if train and cal else []
    hold_train=train+cal
    holdp=fit_predict(hold_train,hold,groups) if hold_train and hold else []
    cfg,cals,_=choose(calp) if calp else ((1,.9,.2),stat([],cal),0)
    hs=stat(apply(holdp,cfg),holdp) if holdp else stat([],hold)
    radar_cal=stat([x for x in calp if x['rank']<=15],calp) if calp else stat([],cal)
    radar_hold=stat([x for x in holdp if x['rank']<=15],holdp) if holdp else stat([],hold)
    top1_hold=stat([x for x in holdp if x['rank']==1],holdp) if holdp else stat([],hold)
    report_layers.append({'layer':lname,'groups':groups,'featureCount':sum(len(data[0]['groups'][g]) for g in groups) if data else 0,
                          'selectedConfig':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2]},'calibration':cals,'holdout':hs,
                          'radarTop15':{'calibration':radar_cal,'holdout':radar_hold},'top1Holdout':top1_hold})

byday={}
for d in sorted(set(x['day'] for x in data)):
    xs=[x for x in data if x['day']==d]
    byday[d]={'rows':len(xs),'positives':sum(x['target'] for x in xs),'tickerDays':len(set(x['key'] for x in xs))}

report={'schemaVersion':1,'method':'TAGIT_V31_SEQUENCE_NATIVE_CAUSAL_RANKING','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
        'objective':'+10% MFE by next observed snapshots within 75m while current day change <10%',
        'antiLeakage':['features use current/prior same-day snapshot only','labels use later same-day snapshots only','calibration Aug25-26 selects thresholds','Aug27-Sep4 is untouched for threshold selection','holdout model may train through calibration dates but never on holdout labels'],
        'coverage':{'snapshots':len(entries),'flattenedRows':len(obs),'labeledEarlyRows':len(data),'dates':sorted(set(x['day'] for x in data)),
                    'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainPositives':sum(x['target'] for x in train),'calibrationPositives':sum(x['target'] for x in cal),'holdoutPositives':sum(x['target'] for x in hold),
                    'medianFutureObservationGapMin':round(float(np.median(label_gaps)),2) if label_gaps else None},
        'byDay':byday,'ablation':report_layers,'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE'}
OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
