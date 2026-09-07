#!/usr/bin/env python3
"""TAGit v5.1: time-normalized precursor model on 60d real 5m history.

Adds strictly-causal historical baselines that v5.0 lacked:
- previous regular-session close / true gap and pre-move state;
- same-time-of-day relative bar volume from PRIOR days only;
- same-time cumulative relative volume from PRIOR days only;
- VWAP distance, rolling compression/range, return acceleration;
- prior-day range/volume context;
- two-pass hard-negative mining inside train only.
No raw bars are committed.
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

SRC=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json');OUT=pathlib.Path('tag/data/tagit-v51-external-history.json')
MAX_SYMBOLS=300;NY=ZoneInfo('America/New_York');UA={'User-Agent':'Mozilla/5.0 TAGit-v5.1-research'}
base=json.loads(SRC.read_text())['data']; freq=Counter(x['ticker'] for x in base);symbols=[s for s,_ in freq.most_common(MAX_SYMBOLS)]

def fetch(sym):
    url=f"https://query2.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym,safe='')}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits"
    err=None
    for k in range(4):
      try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=22) as r:d=json.loads(r.read().decode())
        z=((d.get('chart') or {}).get('result') or [None])[0]
        if not z:return sym,[],'NO_RESULT'
        ts=z.get('timestamp') or [];q=((z.get('indicators') or {}).get('quote') or [{}])[0];O=q.get('open') or [];H=q.get('high') or [];L=q.get('low') or [];C=q.get('close') or [];V=q.get('volume') or []
        a=[]
        for i,t in enumerate(ts):
            if i>=len(C) or C[i] is None:continue
            c=float(C[i]);o=float(O[i] if i<len(O) and O[i] is not None else c);h=float(H[i] if i<len(H) and H[i] is not None else c);l=float(L[i] if i<len(L) and L[i] is not None else c);v=float(V[i] if i<len(V) and V[i] is not None else 0)
            if c>0:a.append({'t':int(t),'o':o,'h':h,'l':l,'c':c,'v':max(0.,v)})
        return sym,a,None
      except Exception as e:err=f'{type(e).__name__}:{e}';time.sleep(.65*(k+1))
    return sym,[],err
raw={};errors={}
with ThreadPoolExecutor(max_workers=8) as ex:
    fs=[ex.submit(fetch,s) for s in symbols]
    for f in as_completed(fs):
        s,a,e=f.result();raw[s]=a
        if e or not a:errors[s]=e or 'EMPTY'

def ret(a,b):return (a/b-1)*100 if a and b else 0.
def scode(dt):
    m=dt.hour*60+dt.minute
    return 0 if 240<=m<570 else (1 if 570<=m<960 else (2 if 960<=m<1200 else 3))
def slot(dt):return (dt.hour*60+dt.minute-240)//5

def median_prior(vals,default=0.):return float(np.median(vals)) if vals else default
rows=[]
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:
        dt=datetime.fromtimestamp(z['t'],timezone.utc).astimezone(NY);s=scode(dt)
        if s<3:by[dt.date().isoformat()].append({**z,'dt':dt,'s':s,'slot':slot(dt)})
    days=sorted(by)
    # historical structures updated only AFTER a day has been fully processed.
    slot_vol=defaultdict(list);slot_cum=defaultdict(list);prior_daily=[];prev_regular_close=None
    for day in days:
        a=sorted(by[day],key=lambda z:z['t'])
        if len(a)<20:
            continue
        reg=[z for z in a if z['s']==1];today_open=(reg[0]['o'] if reg else a[0]['o']); pclose=prev_regular_close
        if pclose is None:
            if reg: prev_regular_close=reg[-1]['c']
            continue
        cum=0.;pv_num=0.;pv_den=0.;cum_by_slot={}
        for i,z in enumerate(a):
            cum+=z['v'];typ=(z['h']+z['l']+z['c'])/3;pv_num+=typ*z['v'];pv_den+=z['v'];cum_by_slot[z['slot']]=cum
            if i<12 or i%3:continue
            c=z['c'];move=ret(c,pclose);gap=ret(today_open,pclose)
            if not (.15<=c<=30) or not (-18<=move<9.0) or c*cum<25000:continue
            prev=a[:i+1]
            def ago(k):return prev[max(0,len(prev)-1-k)]['c']
            r5,r10,r15,r30,r60=[ret(c,ago(k)) for k in (1,2,3,6,12)]
            rvbar=z['v']/median_prior(slot_vol[z['slot']][-20:],z['v'] or 1) if z['v']>=0 else 0
            rvcum=cum/median_prior(slot_cum[z['slot']][-20:],cum or 1)
            recent=prev[-13:];ranges=[ret(x['h'],x['l']) for x in recent if x['l']>0]
            closes=np.asarray([x['c'] for x in recent]);compression=(max(closes)/min(closes)-1)*100 if len(closes)>1 and min(closes)>0 else 0
            volat=float(np.std(np.diff(np.log(np.maximum(closes,1e-9))))*100) if len(closes)>2 else 0
            last6=prev[-7:];hi=max(x['h'] for x in last6);lo=min(x['l'] for x in last6);pos=(c-lo)/(hi-lo) if hi>lo else .5
            vwap=pv_num/pv_den if pv_den else c;vwapd=ret(c,vwap)
            acc=(r5-r10/2);longacc=(r10-r30/3)
            pd=prior_daily[-1] if prior_daily else {'range':0,'volume':cum,'close':pclose}
            tod=(z['dt'].hour*60+z['dt'].minute)/1440
            feat=[r5,r10,r15,r30,r60,acc,longacc,move/20,gap/20,math.log1p(z['v']),math.log1p(cum),math.log1p(max(0,c*cum)),math.log1p(max(0,rvbar)),math.log1p(max(0,rvcum)),float(np.mean(ranges) if ranges else 0)/10,compression/10,volat/10,pos,vwapd/10,float(pd['range'])/20,math.log1p(max(0,pd['volume']))/20,tod,float(z['s']==0),float(z['s']==1),float(z['s']==2)]
            fut=[]
            for zz in a[i+1:]:
                if zz['t']-z['t']>3600:break
                fut.append(zz)
            if not fut:continue
            mfe=ret(max(x['h'] for x in fut),c);mae=ret(min(x['l'] for x in fut),c)
            rows.append({'symbol':sym,'day':day,'key':sym+'|'+day,'ts':z['t'],'session':z['s'],'feat':feat,'target':mfe>=10,'clean':mfe>=10 and mae>=-5,'mfe':mfe,'mae':mae,'rvbar':rvbar,'rvcum':rvcum,'move':move})
        # Update baselines only after decisions/labels for the day were created.
        cum2=0
        for z in a:
            cum2+=z['v'];slot_vol[z['slot']].append(z['v']);slot_cum[z['slot']].append(cum2)
            slot_vol[z['slot']]=slot_vol[z['slot']][-20:];slot_cum[z['slot']]=slot_cum[z['slot']][-20:]
        if reg:
            rr=(max(z['h'] for z in reg)/min(z['l'] for z in reg)-1)*100 if min(z['l'] for z in reg)>0 else 0
            prior_daily.append({'range':rr,'volume':sum(z['v'] for z in reg),'close':reg[-1]['c']});prior_daily=prior_daily[-20:];prev_regular_close=reg[-1]['c']

dates=sorted({x['day'] for x in rows});a=max(1,int(.70*len(dates)));b=max(a+1,int(.85*len(dates)));td=set(dates[:a]);cd=set(dates[a:b]);hd=set(dates[b:]);train=[x for x in rows if x['day'] in td];cal=[x for x in rows if x['day'] in cd];hold=[x for x in rows if x['day'] in hd]

def model(rr,seed,hard=True):
    u=[x for x in rr if x['clean'] or x['mfe']<4];X=np.asarray([x['feat'] for x in u]);y=np.asarray([int(x['clean']) for x in u]);cnt=Counter(x['key'] for x in u);ew=np.asarray([1/max(1,cnt[x['key']]) for x in u]);sc=StandardScaler().fit(X);Xs=sc.transform(X);pos=max(1,y.sum());neg=max(1,len(y)-pos);w=ew*np.where(y==1,min(120,neg/pos),1)
    et=ExtraTreesClassifier(n_estimators=700,max_depth=14,min_samples_leaf=6,max_features=.8,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=ew)
    hg=HistGradientBoostingClassifier(max_iter=330,max_leaf_nodes=19,learning_rate=.032,l2_regularization=10,min_samples_leaf=22,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1200,C=.08,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=ew)
    if hard:
        p=(et.predict_proba(X)[:,1]+hg.predict_proba(X)[:,1]+lr.predict_proba(Xs)[:,1])/3;cut=float(np.quantile(p[y==0],.92));w2=w.copy();w2[(y==0)&(p>=cut)]*=6
        hg=HistGradientBoostingClassifier(max_iter=380,max_leaf_nodes=17,learning_rate=.028,l2_regularization=13,min_samples_leaf=24,random_state=seed+11).fit(X,y,sample_weight=w2)
    return sc,et,hg,lr

def score(m,rr):
    sc,et,hg,lr=m;X=np.asarray([x['feat'] for x in rr]);Xs=sc.transform(X);ps=np.vstack([et.predict_proba(X)[:,1],hg.predict_proba(X)[:,1],lr.predict_proba(Xs)[:,1]]);e=.44*ps[0]+.40*ps[1]+.16*ps[2];d=np.std(ps,axis=0);mn=np.min(ps,axis=0);return [{**x,'score':float(a),'dis':float(b),'minp':float(c)} for x,a,b,c in zip(rr,e,d,mn)]
def first(xs):
    seen=set();out=[]
    for x in sorted(xs,key=lambda z:z['ts']):
        if x['key'] in seen:continue
        seen.add(x['key']);out.append(x)
    return out
def pick(xs,c):
    t,d,m,rv,rc,ss=c;return first([x for x in xs if x['score']>=t and x['dis']<=d and x['minp']>=m and x['rvbar']>=rv and x['rvcum']>=rc and x['session'] in ss])
def wilson(tp,n,z=1.645):
    if not n:return 0
    p=tp/n;den=1+z*z/n;return max(0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100
def stat(s,u):
    n=len(s);tp=sum(x['target'] for x in s);wins={x['key'] for x in u if x['target']};hit={x['key'] for x in s if x['target']};return {'count':n,'tp':tp,'precisionPct':round(tp/n*100,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'winnerTickerDays':len(wins),'capturedWinnerTickerDays':len(hit),'tickerDayRecallPct':round(len(hit)/len(wins)*100,2) if wins else None,'activeDays':len({x['day'] for x in s})}

if len(train)<1000 or sum(x['target'] for x in train)<30:
    report={'schemaVersion':'5.1-external','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'INSUFFICIENT','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','rows':len(rows),'days':len(dates),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors)}
else:
    mm=model(train,51010);cp=score(mm,cal);scores=np.asarray([x['score'] for x in cp]);ths=sorted(set([.5,.6,.7,.8,.85,.9,.93,.95,.97,.98,.99]+[float(np.quantile(scores,q)) for q in (.9,.93,.95,.97,.98,.99,.995)]));cfgs=[]
    for t in ths:
      for d in (.03,.05,.08,.12,.18):
       for mn in (.05,.1,.2,.3,.4):
        for rv in (0,1.25,1.75,2.5,4):
         for rc in (0,1.25,1.75,2.5,4):
          for ss in ((0,),(1,),(0,1),(0,1,2)):
           c=(t,d,mn,rv,rc,ss);z=stat(pick(cp,c),cp);p=z['precisionPct'] or 0;q=z['count']>=15 and p>=90;util=(1e7 if q else 0)+(z['wilsonLower90Pct'] or 0)*100+z['tp']*15+(z['tickerDayRecallPct'] or 0);cfgs.append((util,q,c,z))
    cfgs.sort(key=lambda z:z[0],reverse=True);_,cq,cfg,cm=cfgs[0];fm=model(train+cal,51110);hp=score(fm,hold);hs=stat(pick(hp,cfg),hp);hq=hs['count']>=15 and (hs['precisionPct'] or 0)>=90
    # Also expose the best precision frontier at minimum supports to avoid hiding useful gains.
    frontier=[]
    for minsup in (5,10,15,25,50,100):
        cand=[z for z in cfgs if z[3]['count']>=minsup]
        if cand:
            z=max(cand,key=lambda a:((a[3]['precisionPct'] or 0),(a[3]['wilsonLower90Pct'] or 0)));frontier.append({'minCalibrationSupport':minsup,'calibration':z[3],'config':{'threshold':round(z[2][0],6),'maxDisagreement':z[2][1],'minModelProbability':z[2][2],'minRelBarVolume':z[2][3],'minRelCumVolume':z[2][4],'sessions':list(z[2][5])}})
    report={'schemaVersion':'5.1-external','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'COMPLETE','provider':'Yahoo 5m 60d','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','objective':'+10% in next 60m before prior-close move reaches +9%','symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'rows':len(rows),'days':len(dates),'splits':{'train':len(train),'calibration':len(cal),'holdout':len(hold),'trainPositives':sum(x['target'] for x in train),'calibrationPositives':sum(x['target'] for x in cal),'holdoutPositives':sum(x['target'] for x in hold)},'featureUpgrades':['true previous-close gap/move','prior-day-only same-time relative bar volume','prior-day-only same-time relative cumulative volume','VWAP distance','compression/range/volatility','return acceleration','prior-day range/volume','hard-negative second pass'],'antiLeakage':['historical baselines updated only after day ends','future bars label only','chronological date split','threshold selected on calibration only','first alert ticker/day','untouched holdout'],'selectedConfig':{'threshold':round(cfg[0],6),'maxDisagreement':cfg[1],'minModelProbability':cfg[2],'minRelBarVolume':cfg[3],'minRelCumVolume':cfg[4],'sessions':list(cfg[5])},'calibration':cm,'holdout':hs,'calibrationReached90':cq,'holdoutReached90':hq,'calibrationFrontier':frontier,'verdict':'V51_EXTERNAL_90_CONFIRMED' if cq and hq else 'V51_EXTERNAL_90_NOT_CONFIRMED'}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
