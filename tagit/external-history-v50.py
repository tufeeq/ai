#!/usr/bin/env python3
"""TAGit v5.0 external-history bootstrap.

Fetches real 5-minute Yahoo chart history for historically observed TAGit symbols,
derives only causal bar features, and tests a chronological selective predictor.
Raw third-party bars are NOT committed. The purpose is to expand independent days
beyond the short frozen Aug-Sep window and decide whether 90% precision is supported.
"""
import json, math, pathlib, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json')
OUT=pathlib.Path('tag/data/tagit-v50-external-history.json')
MAX_SYMBOLS=300
NY=ZoneInfo('America/New_York')
UA={'User-Agent':'Mozilla/5.0 TAGit-v5-research'}
root=json.loads(SRC.read_text()); base=root['data']
freq=Counter(x['ticker'] for x in base)
symbols=[x for x,_ in freq.most_common(MAX_SYMBOLS)]

def fetch(sym):
    q=urllib.parse.quote(sym,safe='')
    url=f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits'
    err=None
    for k in range(5):
        try:
            req=urllib.request.Request(url,headers=UA)
            with urllib.request.urlopen(req,timeout=25) as r:d=json.loads(r.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return sym,[], 'NO_RESULT'
            ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
            o=qq.get('open') or [];h=qq.get('high') or [];l=qq.get('low') or [];c=qq.get('close') or [];v=qq.get('volume') or []
            bars=[]
            for i,t in enumerate(ts):
                if i>=len(c) or c[i] is None:continue
                cc=float(c[i]); oo=float(o[i] if i<len(o) and o[i] is not None else cc); hh=float(h[i] if i<len(h) and h[i] is not None else cc); ll=float(l[i] if i<len(l) and l[i] is not None else cc); vv=float(v[i] if i<len(v) and v[i] is not None else 0)
                if cc>0:bars.append((int(t),oo,hh,ll,cc,max(0.,vv)))
            return sym,bars,None
        except Exception as e:
            err=f'{type(e).__name__}:{e}'; time.sleep(.7*(k+1))
    return sym,[],err

raw={}; errors={}
with ThreadPoolExecutor(max_workers=6) as ex:
    fs=[ex.submit(fetch,s) for s in symbols]
    for f in as_completed(fs):
        s,b,e=f.result();raw[s]=b
        if e or not b:errors[s]=e or 'EMPTY'

def r(a,b):return (a/b-1)*100 if a and b else 0.
def session(dt):
    hm=dt.hour*60+dt.minute
    if 240<=hm<570:return 0
    if 570<=hm<960:return 1
    if 960<=hm<1200:return 2
    return 3

rows=[]
for sym,bars in raw.items():
    byday=defaultdict(list)
    for z in bars:
        dt=datetime.fromtimestamp(z[0],timezone.utc).astimezone(NY);byday[dt.date().isoformat()].append((z,dt))
    for day,arr in byday.items():
        arr.sort(key=lambda x:x[0][0]); n=len(arr)
        if n<20:continue
        first_close=arr[0][0][4]
        for i in range(12,n-1,3):  # 15-minute sampling reduces correlated duplicates.
            z,dt=arr[i];t,o,h,l,c,v=z;s=session(dt)
            if s==3 or not (.15<=c<=30):continue
            # Entire feature vector is backward-looking.
            def closeago(k):return arr[max(0,i-k)][0][4]
            rets=[r(c,closeago(k)) for k in (1,2,3,6,12)]
            recent=[x[0] for x in arr[max(0,i-12):i+1]]; vols=[x[5] for x in recent]
            medv=float(np.median(vols[:-1])) if len(vols)>1 else 0.; vr=v/medv if medv>0 else 0.
            ranges=[r(x[2],x[3]) for x in recent if x[3]>0]; volat=float(np.std([x[4] for x in recent]))/c*100 if c else 0.
            cumv=sum(x[0][5] for x in arr[:i+1]); dollar=c*cumv; daymove=r(c,first_close)
            if not (-20<=daymove<9.5) or dollar<25000:continue
            prev6=[x[0] for x in arr[max(0,i-6):i+1]]; hi=max(x[2] for x in prev6);lo=min(x[3] for x in prev6)
            closepos=(c-lo)/(hi-lo) if hi>lo else .5
            tod=(dt.hour*60+dt.minute)/1440
            feat=rets+[math.log1p(v),math.log1p(cumv),math.log1p(max(0,dollar)),math.log1p(max(0,vr)),daymove/20,float(np.mean(ranges) if ranges else 0)/10,volat/10,closepos,tod,float(s==0),float(s==1),float(s==2)]
            fut=[]
            for j in range(i+1,n):
                if arr[j][0][0]-t>3600:break
                fut.append(arr[j][0])
            if not fut:continue
            mfe=r(max(x[2] for x in fut),c);mae=r(min(x[3] for x in fut),c)
            rows.append({'symbol':sym,'day':day,'key':sym+'|'+day,'ts':t,'session':s,'feat':feat,'target':mfe>=10,'clean':mfe>=10 and mae>=-5,'mfe':mfe,'mae':mae})

# Chronological split by distinct date, not random rows.
days=sorted({x['day'] for x in rows}); a=max(1,int(len(days)*.70));b=max(a+1,int(len(days)*.85));trd=set(days[:a]);cad=set(days[a:b]);hod=set(days[b:])
train=[x for x in rows if x['day'] in trd];cal=[x for x in rows if x['day'] in cad];hold=[x for x in rows if x['day'] in hod]

def train_model(rr,seed):
    usable=[x for x in rr if x['clean'] or x['mfe']<4]
    X=np.asarray([x['feat'] for x in usable]); y=np.asarray([int(x['clean']) for x in usable]); keys=Counter(x['key'] for x in usable); ew=np.asarray([1/max(1,keys[x['key']]) for x in usable])
    sc=StandardScaler().fit(X);Xs=sc.transform(X);pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);w=ew*np.where(y==1,min(100,neg/pos),1)
    et=ExtraTreesClassifier(n_estimators=550,max_depth=13,min_samples_leaf=7,max_features=.75,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=ew)
    hg=HistGradientBoostingClassifier(max_iter=260,max_leaf_nodes=17,learning_rate=.04,l2_regularization=8,min_samples_leaf=25,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.10,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=ew)
    return sc,et,hg,lr

def score(m,rr):
    sc,et,hg,lr=m;X=np.asarray([x['feat'] for x in rr]);Xs=sc.transform(X);ps=np.vstack([et.predict_proba(X)[:,1],hg.predict_proba(X)[:,1],lr.predict_proba(Xs)[:,1]]);e=.42*ps[0]+.40*ps[1]+.18*ps[2];d=np.std(ps,axis=0);mn=np.min(ps,axis=0)
    return [{**x,'score':float(a),'dis':float(b),'minp':float(c)} for x,a,b,c in zip(rr,e,d,mn)]
def first(xs):
    out=[];seen=set()
    for x in sorted(xs,key=lambda z:z['ts']):
        if x['key'] in seen:continue
        seen.add(x['key']);out.append(x)
    return out
def pick(xs,c):
    t,d,m,sessions=c;return first([x for x in xs if x['score']>=t and x['dis']<=d and x['minp']>=m and x['session'] in sessions])
def wilson(tp,n,z=1.645):
    if n<1:return 0
    p=tp/n;den=1+z*z/n;return max(0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100
def stat(sel,u):
    n=len(sel);tp=sum(x['target'] for x in sel);wins={x['key'] for x in u if x['target']};hit={x['key'] for x in sel if x['target']};return {'count':n,'tp':tp,'precisionPct':round(tp/n*100,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'winnerTickerDays':len(wins),'capturedWinnerTickerDays':len(hit),'tickerDayRecallPct':round(len(hit)/len(wins)*100,2) if wins else None,'activeDays':len({x['day'] for x in sel})}

if len(train)<500 or sum(x['target'] for x in train)<20 or len(cal)<100 or len(hold)<100:
    report={'schemaVersion':'5.0-external-history','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'provider':'Yahoo chart 5m real historical data','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','status':'INSUFFICIENT_FETCHED_HISTORY','symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'rows':len(rows),'days':len(days),'train':len(train),'calibration':len(cal),'holdout':len(hold),'errorsSample':dict(list(errors.items())[:20])}
else:
    m=train_model(train,5500);cp=score(m,cal); configs=[]
    scores=np.asarray([x['score'] for x in cp]);ths=sorted(set([.5,.6,.7,.8,.85,.9,.93,.95,.97,.98,.99]+[float(np.quantile(scores,q)) for q in (.9,.93,.95,.97,.98,.99,.995)]))
    for t in ths:
      for d in (.03,.05,.08,.12,.18,.25):
       for mn in (.05,.1,.2,.3,.4,.5):
        for ss in ((0,),(1,),(0,1),(0,1,2)):
         c=(t,d,mn,ss);z=stat(pick(cp,c),cp);p=z['precisionPct'] or 0;q=z['count']>=12 and p>=90;u=(1e6 if q else 0)+(z['wilsonLower90Pct'] or 0)*100+z['tp']*10+(z['tickerDayRecallPct'] or 0);configs.append((u,q,c,z))
    configs.sort(reverse=True,key=lambda x:x[0]);_,cq,cfg,cm=configs[0]
    fm=train_model(train+cal,5600);hp=score(fm,hold);hs=stat(pick(hp,cfg),hp);hq=hs['count']>=12 and (hs['precisionPct'] or 0)>=90
    report={'schemaVersion':'5.0-external-history','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'provider':'Yahoo chart 5m real historical data','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','status':'COMPLETE','objective':'+10% MFE within 60m while observation day-move <9.5%','symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'rows':len(rows),'days':len(days),'splits':{'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainDays':len(trd),'calibrationDays':len(cad),'holdoutDays':len(hod),'trainPositives':sum(x['target'] for x in train),'calibrationPositives':sum(x['target'] for x in cal),'holdoutPositives':sum(x['target'] for x in hold)},'antiLeakage':['all features use current/prior 5m bars only','future highs/lows label only','chronological date split','ticker-day inverse weighting','first selected ticker/day alert','threshold selected on calibration only','holdout evaluated after freeze'],'selectedConfig':{'threshold':round(cfg[0],6),'maxDisagreement':cfg[1],'minModelProbability':cfg[2],'sessions':list(cfg[3])},'calibration':cm,'holdout':hs,'calibrationReached90':cq,'holdoutReached90':hq,'verdict':'EXTERNAL_90_CONFIRMED' if cq and hq else 'EXTERNAL_90_NOT_CONFIRMED','errorsSample':dict(list(errors.items())[:20])}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
