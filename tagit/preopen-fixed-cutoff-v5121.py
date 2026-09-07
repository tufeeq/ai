#!/usr/bin/env python3
"""TAGit v5.12.1 robust fixed-cutoff pre-open validator.

Research-only. Exactly one independent decision per ticker/day using the last observed
premarket bar at or before 09:15 ET. All features are causal; future regular-session bars
are labels only. Calibration thresholds are selected on two chronological calibration
blocks and frozen before untouched holdout evaluation.

This revision fixes v5.12's empty-training crash by treating sparse premarket history as
a coverage condition, not a model error. It records population diagnostics and exits
cleanly with INSUFFICIENT_DATA if the causal sample is too small.
"""
import json, math, pathlib, random, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT=pathlib.Path('tag/data'); ROOT.mkdir(parents=True,exist_ok=True)
FROZEN=ROOT/'tagit-v39-frozen-groundtruth.json'; DISCOVERY=ROOT/'discovery.json'; INTEGRITY=ROOT/'tagit-v511-universe-integrity.json'
OUT=ROOT/'tagit-v5121-preopen-fixed-cutoff.json'; CASES=ROOT/'tagit-v5121-preopen-cases.json'
NY=ZoneInfo('America/New_York'); UA={'User-Agent':'Mozilla/5.0 TAGit-v5.12.1-preopen-research'}
MAX_SYMBOLS=520; CUTOFF=9*60+15; OPEN=9*60+30
FEATURES=['gap','preReturn','preRange','preClosePosition','preVwapDistance','logPreVolume','logDollarVolume','r5','r15','r30','preCompression','preRvol','preVolumeAccel','priorDayReturn','priorDayRange','priorDayClosePosition','logPriorDayVolume','priorVolumeAccel','preBarCount','minutesFromLastBarToCutoff']

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def ret(a,b):return (a/b-1)*100 if a and b else 0.0

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def fetch(sym,retries=4):
    q=urllib.parse.quote(sym,safe=''); urls=[
      f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits',
      f'https://query1.finance.yahoo.com/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits']
    err=None
    for k in range(retries):
      for u in urls:
        try:
          req=urllib.request.Request(u,headers=UA)
          with urllib.request.urlopen(req,timeout=24) as r:d=json.loads(r.read().decode())
          z=((d.get('chart') or {}).get('result') or [None])[0]
          if not z:continue
          ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
          O=qq.get('open') or [];H=qq.get('high') or [];L=qq.get('low') or [];C=qq.get('close') or [];V=qq.get('volume') or []
          out=[]
          for i,t in enumerate(ts):
            if i>=len(C) or C[i] is None:continue
            c=float(C[i]);o=float(O[i] if i<len(O) and O[i] is not None else c);h=float(H[i] if i<len(H) and H[i] is not None else c);l=float(L[i] if i<len(L) and L[i] is not None else c);v=float(V[i] if i<len(V) and V[i] is not None else 0)
            if c>0:out.append({'t':int(t),'dt':datetime.fromtimestamp(int(t),timezone.utc).astimezone(NY),'o':o,'h':h,'l':l,'c':c,'v':max(v,0.0)})
          if out:return sym,out,None
        except Exception as e:err=f'{type(e).__name__}:{e}'
      time.sleep(.5*(k+1))
    return sym,[],err or 'EMPTY'

frozen=readj(FROZEN,{'data':[]}); freq=Counter(str(x.get('ticker') or '').upper() for x in frozen.get('data',[]) if x.get('ticker')); hist=[s for s,_ in freq.most_common(330)]
disc=readj(DISCOVERY,{'rows':[]}); fresh=[]
for r in disc.get('rows') or []:
    s=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
    if s and s not in fresh:fresh.append(s)
symbols=[]
for s in hist+fresh:
    if s and s not in symbols:symbols.append(s)
    if len(symbols)>=MAX_SYMBOLS:break
raw={};errors={}
with ThreadPoolExecutor(max_workers=12) as ex:
    fs=[ex.submit(fetch,s) for s in symbols]
    for f in as_completed(fs):
        s,b,e=f.result();raw[s]=b
        if e or not b:errors[s]=e or 'EMPTY'

rows=[]; diag=Counter(); unique_pre_days=set(); decision_days=set()
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:by[z['dt'].date().isoformat()].append(z)
    days=[]
    for day in sorted(by):
        a=sorted(by[day],key=lambda x:x['t']); reg=[x for x in a if OPEN<=x['dt'].hour*60+x['dt'].minute<16*60]
        if not reg:continue
        pre=[x for x in a if 4*60<=x['dt'].hour*60+x['dt'].minute<=CUTOFF]
        if pre:unique_pre_days.add((sym,day))
        days.append({'day':day,'reg':reg,'pre':pre})
    prev=[]
    for d in days:
        diag['regularTickerDays']+=1; pre=d['pre']; reg=d['reg']
        if not pre:diag['noPremarketBars']+=1; prev.append(d);prev=prev[-22:];continue
        diag['hasPremarketBars']+=1
        if len(prev)<2:diag['insufficientPriorDays']+=1;prev.append(d);prev=prev[-22:];continue
        p1=prev[-1]['reg']; p2=prev[-2]['reg']; prev_close=p1[-1]['c']; x=pre[-1]; c=x['c']; pv=sum(z['v'] for z in pre)
        # Sparse premarket is valid evidence; do not require 3 bars. Require only minimal traded notional.
        if not (.15<=c<=30):diag['priceGate']+=1;prev.append(d);prev=prev[-22:];continue
        if c*pv<3000:diag['notionalGate']+=1;prev.append(d);prev=prev[-22:];continue
        def ago(minutes):
            cand=[z for z in pre if z['t']<=x['t']-minutes*60];return cand[-1]['c'] if cand else pre[0]['c']
        ph=max(z['h'] for z in pre);pl=min(z['l'] for z in pre);cp=(c-pl)/(ph-pl) if ph>pl else .5
        typnum=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in pre);vwap=typnum/pv if pv else c
        prior_pre=[sum(z['v'] for z in q['pre']) for q in prev[-20:] if q['pre']];medpv=float(np.median(prior_pre)) if prior_pre else max(pv,1);prv=pv/max(medpv,1)
        recent=pre[-7:];comp=ret(max(z['h'] for z in recent),min(z['l'] for z in recent)) if recent else 0
        early=sum(z['v'] for z in pre[:-3]);vacc=pv/max(early,1) if early>0 else 1.0
        p1h=max(z['h'] for z in p1);p1l=min(z['l'] for z in p1);p1c=p1[-1]['c'];p1v=sum(z['v'] for z in p1);p2v=sum(z['v'] for z in p2);p1cp=(p1c-p1l)/(p1h-p1l) if p1h>p1l else .5
        preopen=pre[0]['o']; lastmin=x['dt'].hour*60+x['dt'].minute
        feat=[ret(c,prev_close)/20,ret(c,preopen)/15,ret(ph,pl)/20,cp,ret(c,vwap)/10,math.log1p(pv)/20,math.log1p(c*pv)/20,ret(c,ago(5))/10,ret(c,ago(15))/15,ret(c,ago(30))/20,comp/15,math.log1p(max(prv,0))/3,math.log1p(max(vacc,0))/3,ret(p1c,p2[-1]['c'])/30,ret(p1h,p1l)/30,p1cp,math.log1p(p1v)/20,math.log1p(max(p1v/max(p2v,1),0))/3,min(len(pre),64)/64,max(0,CUTOFF-lastmin)/315]
        first120=[z for z in reg if (z['t']-reg[0]['t'])/60<=120]
        if not first120:diag['noLabelWindow']+=1;prev.append(d);prev=prev[-22:];continue
        def hit(pct):
            for z in first120:
                if z['h']>=c*(1+pct/100):
                    before=[q for q in first120 if q['t']<=z['t']];return True,(z['t']-x['t'])/60,ret(min(q['l'] for q in before),c)
            return False,None,ret(min(z['l'] for z in first120),c)
        h10,lead,mae=hit(10);h20,_,_=hit(20);action=bool(h10 and mae>=-6);up=ret(max(z['h'] for z in first120),c);down=ret(min(z['l'] for z in first120),c);ign=bool(prv>=1.5 or ret(c,prev_close)>=3 or ret(c,ago(15))>=2 or cp>=.75)
        rows.append({'symbol':sym,'day':d['day'],'key':sym+'|'+d['day'],'ts':x['t'],'feat':feat,'action10':action,'explode20':bool(h20),'hardNeg':bool(ign and not action),'lead10':lead,'remainingUpsidePct':up,'maePct':down,'preRvol':prv});decision_days.add(d['day']);diag['decisionRows']+=1
        prev.append(d);prev=prev[-22:]

integrity=readj(INTEGRITY,{})
base={'schemaVersion':'5.12.1','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','cutoffET':'09:15','populationDiagnostics':dict(diag),'data':{'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'uniquePremarketTickerDays':len(unique_pre_days),'decisionRows':len(rows),'decisionDays':len(decision_days)},'universeIntegrity':integrity.get('realDiscoveryEligible',False),'realDiscoveryPrecisionPct':None,'errorsSample':dict(list(errors.items())[:20])}
if len(rows)<300 or len(decision_days)<20:
    base.update({'status':'INSUFFICIENT_DATA','reason':'fixed-cutoff causal population below minimum support','minimumRequired':{'decisionRows':300,'decisionDays':20},'antiLeakage':['one decision per ticker/day','last observed premarket bar <=09:15 ET only','future regular bars labels only','no current snapshot context backfilled historically']})
    OUT.write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n');print(json.dumps(base,ensure_ascii=False,indent=2));raise SystemExit(0)

dates=sorted(decision_days);ia=max(1,int(.70*len(dates)));ib=max(ia+2,int(.85*len(dates)));td=set(dates[:ia]);cd=dates[ia:ib];hd=set(dates[ib:]);mid=max(1,len(cd)//2);c1d=set(cd[:mid]);c2d=set(cd[mid:])
train=[x for x in rows if x['day'] in td];cal1=[x for x in rows if x['day'] in c1d];cal2=[x for x in rows if x['day'] in c2d];hold=[x for x in rows if x['day'] in hd]

def fit_cls(rr,seed=5121):
    pos=[x for x in rr if x['action10']];hard=[x for x in rr if not x['action10'] and x['hardNeg']];easy=[x for x in rr if not x['action10'] and not x['hardNeg']];rnd=random.Random(seed);rnd.shuffle(hard);rnd.shuffle(easy);u=pos+hard[:max(2500,len(pos)*7)]+easy[:max(1500,len(pos)*3)]
    X=np.asarray([x['feat'] for x in u],float);y=np.asarray([int(x['action10']) for x in u],int)
    if len(y)<20 or len(np.unique(y))<2:return None
    sc=StandardScaler().fit(X);Xs=sc.transform(X);neg=max(1,len(y)-int(y.sum()));pn=max(1,int(y.sum()));w=np.where(y==1,min(40,neg/pn),1.0)
    et=ExtraTreesClassifier(n_estimators=360,max_depth=13,min_samples_leaf=8,max_features=.75,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=19,learning_rate=.035,l2_regularization=16,min_samples_leaf=28,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=900,C=.06,class_weight='balanced',random_state=seed+2).fit(Xs,y)
    return sc,et,hg,lr

def probs(m,rr):
    if not rr:return np.array([]),np.array([])
    X=np.asarray([x['feat'] for x in rr],float);Xs=m[0].transform(X);ps=np.vstack([m[1].predict_proba(X)[:,1],m[2].predict_proba(X)[:,1],m[3].predict_proba(Xs)[:,1]]);return .45*ps[0]+.40*ps[1]+.15*ps[2],np.std(ps,axis=0)

def fit_reg(rr):
    X=np.asarray([x['feat'] for x in rr],float);y=np.asarray([min(80,max(-20,x['remainingUpsidePct'])) for x in rr]);
    if len(y)<20:return None
    a=ExtraTreesRegressor(n_estimators=280,max_depth=13,min_samples_leaf=9,max_features=.75,n_jobs=-1,random_state=5151).fit(X,y);b=HistGradientBoostingRegressor(max_iter=180,max_leaf_nodes=17,learning_rate=.04,l2_regularization=14,min_samples_leaf=28,random_state=5152).fit(X,y);return a,b
mc=fit_cls(train);mr=fit_reg(train)
if mc is None or mr is None:
    base.update({'status':'INSUFFICIENT_DATA','reason':'training class/regression support insufficient','splits':{'train':len(train),'cal1':len(cal1),'cal2':len(cal2),'holdout':len(hold)}});OUT.write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n');print(json.dumps(base,ensure_ascii=False,indent=2));raise SystemExit(0)

def enrich(rr):
    p,d=probs(mc,rr);X=np.asarray([x['feat'] for x in rr],float) if rr else np.empty((0,len(FEATURES)));r=.55*mr[0].predict(X)+.45*mr[1].predict(X) if rr else np.array([]);return [{**x,'score':float(a),'disagreement':float(b),'predUpside':float(c)} for x,a,b,c in zip(rr,p,d,r)]
def sel(rr,cfg):
    th,di,up=cfg;return [x for x in rr if x['score']>=th and x['disagreement']<=di and x['predUpside']>=up]
def stat(s,univ):
    n=len(s);tp=sum(x['action10'] for x in s);days={x['day'] for x in s};leads=[x['lead10'] for x in s if x['action10'] and x['lead10'] is not None];ups=[x['remainingUpsidePct'] for x in s];by=defaultdict(list)
    for x in s:by[x['day']].append(x)
    top=[]
    for g in by.values():top+=sorted(g,key=lambda x:x['score'],reverse=True)[:3]
    w={x['day'] for x in univ if x['action10']};cw={x['day'] for x in s if x['action10']};return {'count':n,'tp':tp,'precisionPct':round(100*tp/n,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'activeDays':len(days),'medianLeadMin':round(float(np.median(leads)),1) if leads else None,'top3DailyPrecisionPct':round(100*sum(x['action10'] for x in top)/len(top),2) if top else None,'medianRemainingUpsidePct':round(float(np.median(ups)),2) if ups else None,'winnerDayRecallPct':round(100*len(cw)/len(w),2) if w else None}
e1=enrich(cal1);e2=enrich(cal2);configs=[]
for th in (.50,.60,.70,.80):
  for di in (.10,.16,.24):
    for up in (6,8,10,12):
      a=stat(sel(e1,(th,di,up)),e1);b=stat(sel(e2,(th,di,up)),e2);p1=a['precisionPct'] or 0;p2=b['precisionPct'] or 0;lo=min(a['wilsonLower90Pct'] or 0,b['wilsonLower90Pct'] or 0);support=min(a['count'],b['count']);utility=lo*100+min(p1,p2)*20-abs(p1-p2)*15+min(support,50)*3
      if support<8:utility-=3000
      configs.append((utility,(th,di,up),a,b))
configs.sort(key=lambda x:x[0],reverse=True);_,cfg,s1,s2=configs[0];eh=enrich(hold);hs=stat(sel(eh,cfg),eh)
base.update({'status':'COMPLETE','objective':'one fixed pre-open decision per ticker/day; actionable +10% within first 120 regular-session minutes','selectedConfig':{'minScore':cfg[0],'maxDisagreement':cfg[1],'minPredUpside':cfg[2]},'splits':{'train':len(train),'cal1':len(cal1),'cal2':len(cal2),'holdout':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd)},'calibrationBlock1':s1,'calibrationBlock2':s2,'holdout':hs,'realDiscoveryPrecisionPct':hs['precisionPct'] if integrity.get('realDiscoveryEligible',False) else None,'antiLeakage':['one decision per ticker/day','last observed premarket bar <=09:15 ET only','future regular bars labels only','chronological 70/15/15 split','two calibration blocks used for stability selection','holdout evaluated once after configuration freeze','current float/short/news snapshots excluded from historical model','universe-conditioned precision is not labeled real discovery unless integrity gate passes'],'verdict':'RESEARCH_COMPLETE_NOT_90'})
OUT.write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n');CASES.write_text(json.dumps({'schemaVersion':'5.12.1-cases','featureNames':FEATURES,'trainPositives':sum(x['action10'] for x in train),'trainHardNegatives':sum(x['hardNeg'] for x in train),'policy':'TRAIN_ONLY'},ensure_ascii=False,indent=2)+'\n');print(json.dumps(base,ensure_ascii=False,indent=2))
