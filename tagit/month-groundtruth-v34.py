#!/usr/bin/env python3
"""TAGit v3.4 month-scale causal ground truth + hard-negative ranking.

Rehabilitates the Aug11-Sep4 snapshot ledger field-by-field, fetches one Yahoo 5m
series per unique early ticker, uses only fully closed bars before each decision as
features and later bars as labels, then tests a hard-negative ensemble. Research only.
"""
import bisect, json, math, pathlib, time, urllib.parse, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/snapshots.json');OUT=pathlib.Path('tag/data/tagit-v34-month-groundtruth.json')

def num(v):
    if v is None or v=='':return None
    try:return float(str(v).replace('$','').replace('%','').replace(',','').strip())
    except:return None

def q(v,d=0.0):
    try:return float(v) if v is not None and math.isfinite(float(v)) else d
    except:return d

def tms(v):
    if not v:return None
    try:return datetime.fromisoformat(str(v).replace('Z','+00:00')).timestamp()*1000
    except:return None

def scode(s):
    s=str(s or '').lower();return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)

root=json.loads(SRC.read_text());entries=root if isinstance(root,list) else root.get('snapshots',[])
entries=sorted(entries,key=lambda s:tms(s.get('timestampUTC') or s.get('snapshotTimestampUTC')) or 0)
obs=[]
for si,s in enumerate(entries):
    st=tms(s.get('timestampUTC') or s.get('snapshotTimestampUTC'))
    if st is None:continue
    day=datetime.fromtimestamp(st/1000,timezone.utc).date().isoformat();rows=[]
    for r in s.get('topMovers') or s.get('rows') or []:
        t=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper();p=num(r.get('Price'));ch=num(r.get('Change'));v=num(r.get('Volume'))
        if not t or p is None or ch is None or v is None or not (.15<=p<=20) or not (-20<=ch<10):continue
        rows.append((t,p,ch,v,r))
    if not rows:continue
    changes=np.asarray([z[2] for z in rows]);vols=np.asarray([z[3] for z in rows]);cr=rank01(changes);vr=rank01(vols)
    for j,(t,p,ch,v,r) in enumerate(rows):
        obs.append({'si':si,'ts':st,'day':day,'session':s.get('session'),'ticker':t,'key':t+'|'+day,'price':p,'change':ch,'volume':v,'changeRank':float(cr[j]),'volumeRank':float(vr[j]),'row':r})
bykey=defaultdict(list)
for o in obs:bykey[o['key']].append(o)
for a in bykey.values():a.sort(key=lambda x:x['ts'])
tickers=sorted(set(x['ticker'] for x in obs))

# Full period Yahoo cache, ephemeral.
start=int(datetime(2026,8,10,tzinfo=timezone.utc).timestamp());end=int(datetime(2026,9,6,tzinfo=timezone.utc).timestamp())
UA={'User-Agent':'Mozilla/5.0 TAGit-personal-research/3.4'}
def fetch(t):
    sym=urllib.parse.quote(t,safe='');url=f'https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={start}&period2={end}&interval=5m&includePrePost=true&events=div%2Csplits';err=None
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=20) as rr:d=json.loads(rr.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return t,None,'NO_RESULT'
            ts=z.get('timestamp') or [];qq=((z.get('indicators') or {}).get('quote') or [{}])[0];cs=qq.get('close') or [];hs=qq.get('high') or [];ls=qq.get('low') or [];vs=qq.get('volume') or []
            a=[]
            for i,tt in enumerate(ts):
                if i>=len(cs) or cs[i] is None:continue
                c=q(cs[i]);a.append({'ts':tt*1000.0,'c':c,'h':q(hs[i],c) if i<len(hs) else c,'l':q(ls[i],c) if i<len(ls) else c,'v':q(vs[i]) if i<len(vs) else 0})
            return t,a,None
        except Exception as e:err=type(e).__name__;time.sleep(.8*(k+1))
    return t,None,err
bars={};errors={}
with ThreadPoolExecutor(max_workers=8) as ex:
    fs={ex.submit(fetch,t):t for t in tickers}
    for f in as_completed(fs):
        t,a,e=f.result();bars[t]=a if a else None
        if not a:errors[t]=e

# Fully-closed bar features and independent future labels.
def bar_record(o):
    a=bars.get(o['ticker'])
    if not a:return None
    times=[z['ts'] for z in a]
    # Yahoo 5m timestamps mark bar start. Only bars ending <= decision may be features.
    i=bisect.bisect_right(times,o['ts']-5*60000)-1
    if i<0:return None
    cur=a[i];age=(o['ts']-(cur['ts']+5*60000))/60000
    if age>12 or cur['c']<=0:return None
    parity=abs(cur['c']/o['price']-1)*100
    if parity>7.5:return None
    def prior(m):
        target=cur['ts']-m*60000;k=bisect.bisect_right(times,target)-1
        return a[k] if k>=0 and 0<=cur['ts']-a[k]['ts']<=m*60000+12*60000 else None
    def rr(m):
        z=prior(m);return (cur['c']/z['c']-1)*100 if z and z['c'] else 0
    d=datetime.fromtimestamp(cur['ts']/1000,timezone.utc).date();db=[];j=i
    while j>=0 and datetime.fromtimestamp(a[j]['ts']/1000,timezone.utc).date()==d:db.append(a[j]);j-=1
    db.reverse();sv=sum(z['v'] for z in db);vwap=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in db)/sv if sv else cur['c'];hod=max(z['h'] for z in db);lod=min(z['l'] for z in db)
    l4=db[-4:];pv=np.mean([z['v'] for z in l4[:-1]]) if len(l4)>=2 else 0;vacc=l4[-1]['v']/pv-1 if pv>0 else 0
    l3=db[-3:];rng=(max(z['h'] for z in l3)/min(z['l'] for z in l3)-1)*100 if l3 and min(z['l'] for z in l3)>0 else 0
    # label starts at the first bar whose START is >= frozen decision timestamp.
    k=bisect.bisect_left(times,o['ts']);future=[]
    while k<len(a) and a[k]['ts']<=o['ts']+60*60000:
        if a[k]['ts']>=o['ts']:future.append(a[k])
        k+=1
    if not future:return None
    mfe=(max(z['h'] for z in future)/cur['c']-1)*100;mae=(min(z['l'] for z in future)/cur['c']-1)*100
    micro=[rr(5)/10,rr(10)/10,rr(30)/20,rr(60)/30,(cur['c']/vwap-1)*10 if vwap else 0,(cur['c']/hod-1)*10 if hod else 0,(cur['c']/lod-1)*10 if lod else 0,max(-4,min(8,vacc)),rng/10,math.log1p(max(0,cur['v']))/20,age/12]
    return micro,mfe,mae,parity

# Current/prior ledger features. No trainingEligible snapshot flag is trusted globally;
# only deterministic fields are re-qualified.
data=[];covered=0
for key,a in bykey.items():
    first=a[0]
    for i,o in enumerate(a):
        br=bar_record(o)
        if not br:continue
        micro,mfe,mae,parity=br;covered+=1;prev=a[i-1] if i else None;prev2=a[i-2] if i>=2 else None
        pvel=cvel=vvel=vacc2=0
        if prev:
            dt=(o['ts']-prev['ts'])/60000
            if 0<dt<=120:
                pvel=((o['price']/prev['price']-1)*100)/dt*10;cvel=(o['change']-prev['change'])/dt*10;vvel=max(0,o['volume']-prev['volume'])/dt*10
                if prev2:
                    dt2=(prev['ts']-prev2['ts'])/60000
                    if 0<dt2<=120:
                        pv=max(0,prev['volume']-prev2['volume'])/dt2*10;vacc2=(vvel-pv)/(abs(pv)+1)
        sig=o['row'].get('signals') or [];trend=str(o['row'].get('persistenceTrend') or '').lower();pbs=o['row'].get('persistenceBuckets');pbc=len(pbs) if isinstance(pbs,(list,dict)) else 0;ps=num(o['row'].get('persistenceSlopePctPts'));gr=num(o['row'].get('gainRetentionPct') or o['row'].get('_gainRetentionPct'))
        s=scode(o['session']);age=(o['ts']-first['ts'])/60000
        base=[math.log(max(o['price'],.001)),o['change']/20,math.log1p(max(0,o['volume']))/20,o['changeRank'],o['volumeRank'],
              1 if 'ta_topgainers' in sig else 0,1 if 'ta_unusualvolume' in sig else 0,1 if 'ta_mostactive' in sig else 0,
              1 if s==0 else 0,1 if s==1 else 0,1 if s==2 else 0]
        seq=[pvel/5,cvel/5,math.log1p(max(0,vvel))/15,max(-3,min(3,vacc2)),age/390,(o['change']-first['change'])/20,
             (math.log1p(max(0,o['volume']))-math.log1p(max(0,first['volume'])))/10,q(ps)/20,q(gr,50)/100,pbc/10,
             1 if any(k in trend for k in ('up','rising','positive','acceler')) else 0,1 if any(k in trend for k in ('down','fall','negative','decay')) else 0]
        data.append({**o,'base':base,'sequence':seq,'micro':micro,'mfeGT':mfe,'maeGT':mae,'target':mfe>=10,'parity':parity})

train=[x for x in data if x['day']<='2026-08-24'];cal=[x for x in data if '2026-08-25'<=x['day']<='2026-08-26'];hold=[x for x in data if x['day']>='2026-08-27']

def matrix(xs,mode):
    return np.asarray([x['base'] + (x['sequence'] if 'seq' in mode else []) + (x['micro'] if 'micro' in mode else []) for x in xs],float)

def fit_score(tr,te,mode):
    X=matrix(tr,mode);Xt=matrix(te,mode);y=np.asarray([int(x['target']) for x in tr]);sc=StandardScaler().fit(X);Xs=sc.transform(X);Xts=sc.transform(Xt);pos=max(1,y.sum());neg=max(1,len(y)-pos);w=np.where(y==1,min(80,neg/pos),1.0)
    # Hard negatives receive extra weight when already anomalous / top-ranked by current evidence.
    hard=np.asarray([1.8 if (not x['target'] and (x['changeRank']>.7 or x['volumeRank']>.8)) else 1.0 for x in tr]);w=w*hard
    et=ExtraTreesClassifier(n_estimators=420,max_depth=11,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=3401,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=15,learning_rate=.045,l2_regularization=4,min_samples_leaf=22,random_state=3402).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.25,random_state=3403).fit(Xs,y)
    a=et.predict_proba(Xt)[:,1];b=hg.predict_proba(Xt)[:,1];c=lr.predict_proba(Xts)[:,1]
    out=[None]*len(te);bys=defaultdict(list)
    for i,x in enumerate(te):bys[x['si']].append(i)
    for ids in bys.values():
        ra=rank01(a[ids]);rb=rank01(b[ids]);rc=rank01(c[ids]);ens=.42*ra+.38*rb+.20*rc;dis=np.std(np.vstack([ra,rb,rc]),axis=0);order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids[loc];out[i]={**te[i],'ensemble':float(ens[loc]),'disagreement':float(dis[loc]),'rank':rr}
    return out

def stat(xs,univ):
    n=len(xs);tp=sum(x['target'] for x in xs);den=sum(x['target'] for x in univ)
    return {'count':n,'tp':tp,'precisionPct':round(tp/n*100,2) if n else None,'recallObsPct':round(tp/den*100,2) if den else None,'tickerDays':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target'])),'meanMFE':round(float(np.mean([x['mfeGT'] for x in xs])),2) if n else None,'meanMAE':round(float(np.mean([x['maeGT'] for x in xs])),2) if n else None}
def apply(xs,c):
    k,e,d=c;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]
def choose(cp):
    z=[]
    for k in (1,2,3,5,8,10,15,20):
        for e in (.35,.50,.65,.75,.85,.93):
            for d in (.10,.18,.28,.40,.60):
                s=stat(apply(cp,(k,e,d)),cp);p=s['precisionPct'] or 0;support=min(1,s['count']/25)*min(1,s['tp']/6);utility=p*support+s['tp']*1.7+s['recallObsPct']*.2
                z.append(((k,e,d),s,utility))
    return max(z,key=lambda x:x[2])

modes=['base','base+seq','base+seq+micro'];results=[]
for mode in modes:
    cp=fit_score(train,cal,mode);hp=fit_score(train+cal,hold,mode);cfg,cs,_=choose(cp);hs=stat(apply(hp,cfg),hp);top={str(k):stat([x for x in hp if x['rank']<=k],hp) for k in (1,3,5,10,20)}
    # session view on untouched holdout
    sess={}
    for code,name in ((0,'pre'),(1,'regular'),(2,'after')):
        u=[x for x in hp if scode(x['session'])==code];sess[name]=stat(apply(u,cfg),u) if u else stat([],[])
    results.append({'mode':mode,'features':matrix(train,mode).shape[1] if train else 0,'selectedConfig':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2]},'calibration':cs,'holdout':hs,'holdoutTopK':top,'holdoutBySession':sess})

byday={}
for d in sorted(set(x['day'] for x in data)):
    x=[z for z in data if z['day']==d];byday[d]={'rows':len(x),'positives':sum(z['target'] for z in x),'tickerDays':len(set(z['key'] for z in x))}
report={'schemaVersion':1,'method':'TAGIT_V34_MONTH_5M_GROUND_TRUTH_HARD_NEGATIVE_RANKER','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
'coverage':{'snapshotEntries':len(entries),'eligibleSnapshotRows':len(obs),'uniqueTickers':len(tickers),'yahooSucceeded':sum(1 for v in bars.values() if v),'yahooFailed':len(errors),'qualityLabelledRows':len(data),'coveragePct':round(len(data)/max(1,len(obs))*100,2)},
'split':{'trainRows':len(train),'trainPositives':sum(x['target'] for x in train),'calRows':len(cal),'calPositives':sum(x['target'] for x in cal),'holdRows':len(hold),'holdPositives':sum(x['target'] for x in hold)},
'antiLeakage':['only fully closed 5m bars may enter features','future bars are label-only','field-level requalification ignores legacy snapshot-wide trainingEligible flag','Aug11-24 train; Aug25-26 calibration; Aug27-Sep4 untouched thresholds holdout','Finviz/Yahoo current price parity <=7.5%'],'byDay':byday,'results':results,'failedTickerSample':dict(list(errors.items())[:30])}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
