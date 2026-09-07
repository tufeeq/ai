#!/usr/bin/env python3
"""TAGit v5.12 fixed-cutoff pre-open validator.

One independent decision per ticker-day at 09:15 ET. Features use only bars at or before
09:15 plus prior completed sessions. Future regular-session bars are labels only.
Calibration is split into two chronological blocks and configuration is selected on
worst-block stability. Untouched holdout is evaluated once after freeze.
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

ROOT=pathlib.Path('tag/data')
FROZEN=ROOT/'tagit-v39-frozen-groundtruth.json'
DISCOVERY=ROOT/'discovery.json'
INTEGRITY=ROOT/'tagit-v511-universe-integrity.json'
OUT=ROOT/'tagit-v512-preopen-fixed-cutoff.json'
CASES=ROOT/'tagit-v512-preopen-cases.json'
NY=ZoneInfo('America/New_York')
UA={'User-Agent':'Mozilla/5.0 TAGit-v5.12-preopen-research'}
MAX_SYMBOLS=520
CUTOFF_MIN=9*60+15
OPEN_MIN=9*60+30
FEATURES=['gap','preReturn','preRange','preClosePosition','preVwapDistance','logPreVolume','logDollarVolume','r5','r15','r30','preCompression','sameTimeRvol','rvolAccel','priorDayReturn','priorDayRange','priorDayClosePosition','logPriorDayVolume','prior2DayReturn','priorVolumeAccel']

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def ret(a,b): return (a/b-1)*100 if a and b else 0.0

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def fetch(sym,retries=4):
    q=urllib.parse.quote(sym,safe='')
    u=f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits'
    err=None
    for k in range(retries):
        try:
            req=urllib.request.Request(u,headers=UA)
            with urllib.request.urlopen(req,timeout=24) as r:d=json.loads(r.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return sym,[],'NO_RESULT'
            ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
            O=qq.get('open') or [];H=qq.get('high') or [];L=qq.get('low') or [];C=qq.get('close') or [];V=qq.get('volume') or []
            out=[]
            for i,t in enumerate(ts):
                if i>=len(C) or C[i] is None:continue
                c=float(C[i]); o=float(O[i] if i<len(O) and O[i] is not None else c); h=float(H[i] if i<len(H) and H[i] is not None else c); l=float(L[i] if i<len(L) and L[i] is not None else c); v=float(V[i] if i<len(V) and V[i] is not None else 0)
                if c<=0:continue
                dt=datetime.fromtimestamp(int(t),timezone.utc).astimezone(NY)
                out.append({'t':int(t),'dt':dt,'o':o,'h':h,'l':l,'c':c,'v':max(0.0,v)})
            return sym,out,None
        except Exception as e:
            err=f'{type(e).__name__}:{e}'; time.sleep(.45*(k+1))
    return sym,[],err

# Broad research universe. Historical known movers are retained only to study patterns;
# universe-integrity gate prevents calling resulting precision real market-wide discovery.
frozen=readj(FROZEN,{'data':[]})
freq=Counter(str(x.get('ticker') or '').upper() for x in frozen.get('data',[]) if x.get('ticker'))
hist=[s for s,_ in freq.most_common(330)]
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

rows=[]
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:by[z['dt'].date().isoformat()].append(z)
    days=[]; same_slot_vol=defaultdict(list)
    for day in sorted(by):
        a=sorted(by[day],key=lambda x:x['t'])
        reg=[x for x in a if OPEN_MIN<=x['dt'].hour*60+x['dt'].minute<16*60]
        if not reg:continue
        pre=[x for x in a if 4*60<=x['dt'].hour*60+x['dt'].minute<=CUTOFF_MIN]
        days.append({'day':day,'all':a,'reg':reg,'pre':pre})
    prev=[]
    for d in days:
        reg=d['reg'];pre=d['pre']
        if len(prev)<2 or len(pre)<3: 
            # still update historical pre-volume baselines after decision day completes
            for z in pre:same_slot_vol[z['dt'].hour*60+z['dt'].minute].append(z['v'])
            prev.append(d);prev=prev[-22:];continue
        p1=prev[-1]['reg'];p2=prev[-2]['reg']; prev_close=p1[-1]['c']; p2close=p2[-1]['c']
        # exact fixed-cutoff snapshot is last available bar <= 09:15, never later.
        x=pre[-1]; c=x['c']; preopen=pre[0]['o']; ph=max(z['h'] for z in pre); pl=min(z['l'] for z in pre); pv=sum(z['v'] for z in pre)
        if not (.15<=c<=30) or c*pv<15000:
            for z in pre:same_slot_vol[z['dt'].hour*60+z['dt'].minute].append(z['v'])
            prev.append(d);prev=prev[-22:];continue
        def ago(minutes):
            target=x['t']-minutes*60; cand=[z for z in pre if z['t']<=target]
            return cand[-1]['c'] if cand else pre[0]['c']
        r5,r15,r30=ret(c,ago(5)),ret(c,ago(15)),ret(c,ago(30))
        typnum=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in pre); vwap=typnum/pv if pv else c
        cp=(c-pl)/(ph-pl) if ph>pl else .5
        recent=pre[-7:]; comp=ret(max(z['h'] for z in recent),min(z['l'] for z in recent)) if recent else 0
        slot=x['dt'].hour*60+x['dt'].minute
        histv=same_slot_vol.get(slot,[])[-20:]
        # cumulative pre-volume baseline from prior completed days only; no current/future leakage.
        prior_prevol=[sum(z['v'] for z in q['pre']) for q in prev[-20:] if q['pre']]
        medpv=float(np.median(prior_prevol)) if prior_prevol else max(pv,1)
        rvol=pv/max(medpv,1)
        earlier=sum(z['v'] for z in pre[:-3]) if len(pre)>3 else max(pv,1)
        rvacc=pv/max(earlier,1)
        p1h=max(z['h'] for z in p1);p1l=min(z['l'] for z in p1);p1o=p1[0]['o'];p1c=p1[-1]['c'];p1v=sum(z['v'] for z in p1)
        p1cp=(p1c-p1l)/(p1h-p1l) if p1h>p1l else .5
        p2v=sum(z['v'] for z in p2)
        feat=[ret(c,prev_close)/20,ret(c,preopen)/15,ret(ph,pl)/20,cp,ret(c,vwap)/10,math.log1p(pv)/20,math.log1p(c*pv)/20,r5/10,r15/15,r30/20,comp/15,math.log1p(max(rvol,0))/3,math.log1p(max(rvacc,0))/3,ret(p1c,p2close)/30,ret(p1h,p1l)/30,p1cp,math.log1p(p1v)/20,ret(p1c,p2[-1]['c'])/30,math.log1p(max(p1v/max(p2v,1),0))/3]
        # Labels start at/after regular open only.
        fut=[z for z in reg if z['dt'].hour*60+z['dt'].minute>=OPEN_MIN]
        first120=[z for z in fut if (z['t']-fut[0]['t'])/60<=120] if fut else []
        if not first120:
            for z in pre:same_slot_vol[z['dt'].hour*60+z['dt'].minute].append(z['v'])
            prev.append(d);prev=prev[-22:];continue
        def target_hit(pct):
            for z in first120:
                if z['h']>=c*(1+pct/100):
                    before=[q for q in first120 if q['t']<=z['t']]
                    mae=ret(min(q['l'] for q in before),c)
                    return True,(z['t']-x['t'])/60,mae
            return False,None,ret(min(z['l'] for z in first120),c)
        h10,lead10,mae10=target_hit(10);h20,lead20,_=target_hit(20)
        action10=bool(h10 and mae10>=-6)
        upside=ret(max(z['h'] for z in first120),c); downside=ret(min(z['l'] for z in first120),c)
        ignition=bool(rvol>=1.5 or ret(c,prev_close)>=3 or r15>=2 or cp>=.75)
        hardneg=bool(ignition and not action10)
        rows.append({'symbol':sym,'day':d['day'],'key':sym+'|'+d['day'],'ts':x['t'],'feat':feat,'action10':action10,'explode20':bool(h20),'hardNeg':hardneg,'lead10':lead10,'remainingUpsidePct':upside,'maePct':downside,'gapPct':ret(c,prev_close),'preRvol':rvol})
        for z in pre:same_slot_vol[z['dt'].hour*60+z['dt'].minute].append(z['v'])
        prev.append(d);prev=prev[-22:]

dates=sorted({x['day'] for x in rows}); ia=max(1,int(.70*len(dates))); ib=max(ia+2,int(.85*len(dates)))
td=set(dates[:ia]);cdates=dates[ia:ib];hd=set(dates[ib:]); mid=max(1,len(cdates)//2);c1d=set(cdates[:mid]);c2d=set(cdates[mid:])
train=[x for x in rows if x['day'] in td];cal1=[x for x in rows if x['day'] in c1d];cal2=[x for x in rows if x['day'] in c2d];cal=cal1+cal2;hold=[x for x in rows if x['day'] in hd]

def fit_cls(rr,seed):
    pos=[x for x in rr if x['action10']]; hard=[x for x in rr if not x['action10'] and x['hardNeg']]; easy=[x for x in rr if not x['action10'] and not x['hardNeg']]
    rnd=random.Random(seed);rnd.shuffle(hard);rnd.shuffle(easy);u=pos+hard[:max(5000,len(pos)*7)]+easy[:max(3500,len(pos)*3)]
    X=np.asarray([x['feat'] for x in u],float);y=np.asarray([int(x['action10']) for x in u],int)
    if len(y)==0 or len(np.unique(y))<2:return {'constant':float(y[0]) if len(y) else 0,'n':len(y),'p':int(y.sum()) if len(y) else 0}
    cnt=Counter(x['key'] for x in u);base=np.asarray([1/max(1,cnt[x['key']]) for x in u]);neg=max(1,len(y)-int(y.sum()));posn=max(1,int(y.sum()));w=base*np.where(y==1,min(50,neg/posn),1)
    sc=StandardScaler().fit(X);Xs=sc.transform(X)
    et=ExtraTreesClassifier(n_estimators=450,max_depth=14,min_samples_leaf=8,max_features=.75,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=base)
    hg=HistGradientBoostingClassifier(max_iter=250,max_leaf_nodes=21,learning_rate=.035,l2_regularization=16,min_samples_leaf=30,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.06,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=base)
    return {'sc':sc,'et':et,'hg':hg,'lr':lr,'n':len(y),'p':int(y.sum())}

def prob(m,rr):
    if not rr:return np.array([]),np.array([])
    if 'constant' in m:return np.full(len(rr),m['constant']),np.zeros(len(rr))
    X=np.asarray([x['feat'] for x in rr],float);Xs=m['sc'].transform(X)
    ps=np.vstack([m['et'].predict_proba(X)[:,1],m['hg'].predict_proba(X)[:,1],m['lr'].predict_proba(Xs)[:,1]])
    return .45*ps[0]+.40*ps[1]+.15*ps[2],np.std(ps,axis=0)

def fit_reg(rr):
    X=np.asarray([x['feat'] for x in rr],float);y=np.asarray([min(80,max(-20,x['remainingUpsidePct'])) for x in rr],float)
    cnt=Counter(x['key'] for x in rr);w=np.asarray([1/max(1,cnt[x['key']]) for x in rr])
    et=ExtraTreesRegressor(n_estimators=360,max_depth=13,min_samples_leaf=9,max_features=.75,n_jobs=-1,random_state=5121).fit(X,y,sample_weight=w)
    hg=HistGradientBoostingRegressor(max_iter=220,max_leaf_nodes=19,learning_rate=.04,l2_regularization=14,min_samples_leaf=30,random_state=5122).fit(X,y,sample_weight=w)
    return et,hg

def rpred(m,rr):
    if not rr:return np.array([])
    X=np.asarray([x['feat'] for x in rr],float);return .55*m[0].predict(X)+.45*m[1].predict(X)

mc=fit_cls(train,5120);mr=fit_reg(train)
def enrich(rr):
    p,d=prob(mc,rr);r=rpred(mr,rr)
    return [{**x,'pAction':float(a),'disagreement':float(b),'predUpside':float(c)} for x,a,b,c in zip(rr,p,d,r)]

def select(rr,cfg):
    th,dis,up=cfg
    return [x for x in rr if x['pAction']>=th and x['disagreement']<=dis and x['predUpside']>=up]

def block_bootstrap(sel,seed=1,B=800):
    if not sel:return 0.0
    by=defaultdict(list)
    for x in sel:by[x['day']].append(x)
    ds=list(by);rnd=random.Random(seed);vals=[]
    for _ in range(B):
        sample=[rnd.choice(ds) for __ in ds];arr=[x for d in sample for x in by[d]]
        vals.append(100*sum(x['action10'] for x in arr)/len(arr) if arr else 0)
    return float(np.quantile(vals,.10))

def stat(sel,universe):
    n=len(sel);tp=sum(x['action10'] for x in sel);by=defaultdict(list)
    for x in sel:by[x['day']].append(x)
    top=[]
    for d,g in by.items():top.extend(sorted(g,key=lambda z:z['pAction'],reverse=True)[:3])
    winners={x['day'] for x in universe if x['action10']};caught={x['day'] for x in sel if x['action10']}
    leads=[x['lead10'] for x in sel if x['action10'] and x['lead10'] is not None];ups=[x['remainingUpsidePct'] for x in sel]
    return {'count':n,'tp':tp,'precisionPct':round(100*tp/n,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'dayBlockLower90Pct':round(block_bootstrap(sel),2) if n else None,'activeDays':len(by),'medianLeadMinFrom0915':round(float(np.median(leads)),1) if leads else None,'top3DailyPrecisionPct':round(100*sum(x['action10'] for x in top)/len(top),2) if top else None,'medianRemainingUpsidePct':round(float(np.median(ups)),2) if ups else None,'winnerDayRecallPct':round(100*len(caught)/len(winners),2) if winners else None}

c1=enrich(cal1);c2=enrich(cal2);hc=enrich(hold)
configs=[]
for th in (.45,.55,.65,.72,.78,.84,.88,.92):
  for di in (.08,.12,.18,.24,.32):
    for up in (6,8,10,12,15):
      cfg=(th,di,up);s1=stat(select(c1,cfg),c1);s2=stat(select(c2,cfg),c2)
      p1=s1['precisionPct'] or 0;p2=s2['precisionPct'] or 0;l1=s1['wilsonLower90Pct'] or 0;l2=s2['wilsonLower90Pct'] or 0;n1=s1['count'];n2=s2['count'];rec=min(s1['winnerDayRecallPct'] or 0,s2['winnerDayRecallPct'] or 0)
      utility=min(l1,l2)*180+min(p1,p2)*40+rec*5+min(n1,n2)*2-abs(p1-p2)*25
      if min(n1,n2)<20:utility-=5000
      configs.append((utility,cfg,s1,s2))
configs.sort(key=lambda z:z[0],reverse=True);_,cfg,s1,s2=configs[0]
calstat=stat(select(enrich(cal),cfg),enrich(cal));hstat=stat(select(hc,cfg),hc)
integ=readj(INTEGRITY,{})
point_ok=bool((integ.get('gate') or {}).get('eligible') or (integ.get('universeIntegrity') or {}).get('pointInTimeEligible'))
credible=bool(point_ok and hstat['count']>=100 and hstat['activeDays']>=10 and (hstat['precisionPct'] or 0)>=90 and (hstat['wilsonLower90Pct'] or 0)>=80 and (hstat['dayBlockLower90Pct'] or 0)>=80 and min(s1['precisionPct'] or 0,s2['precisionPct'] or 0)>=90)
report={'schemaVersion':'5.12-preopen-fixed-cutoff','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'COMPLETE' if train and cal1 and cal2 and hold else 'INSUFFICIENT','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','decisionPolicy':{'cutoffET':'09:15','oneDecisionPerTickerDay':True,'futureRegularSessionLabelsOnly':True},'objective':{'primary':'predict actionable +10% within first 120 regular-session minutes from a fixed 09:15 ET decision','secondary':'+20% explosion and remaining upside'},'data':{'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'decisionRows':len(rows),'days':len(dates),'tickerDays':len({x['key'] for x in rows}),'fetchFailures':len(errors)},'splits':{'trainRows':len(train),'calibrationBlock1Rows':len(cal1),'calibrationBlock2Rows':len(cal2),'holdoutRows':len(hold),'trainDays':len(td),'calibrationDays':len(cdates),'holdoutDays':len(hd)},'selectedConfig':{'minPAction':cfg[0],'maxDisagreement':cfg[1],'minPredUpsidePct':cfg[2]},'calibrationBlock1':s1,'calibrationBlock2':s2,'calibration':calstat,'holdout':hstat,'validation':{'independentUnit':'ticker-day','calibrationSelection':'two consecutive chronological blocks; optimize worst-block lower bound and stability','holdoutTouchedAfterFreeze':True,'configurationSelectedWithoutHoldout':True},'universeIntegrity':{'pointInTimeEligible':point_ok,'realDiscoveryPrecisionClaimable':point_ok,'status':'POINT_IN_TIME_FORWARD_ELIGIBLE' if point_ok else 'CONDITIONAL_HISTORICAL_UNIVERSE_NOT_REAL_DISCOVERY'},'accuracyGate':{'credible90Candidate':credible,'forwardConfirmationRequired':True,'minimumIndependentHoldoutSupport':100,'minimumActiveHoldoutDays':10,'minimumWilsonAndDayBlockLowerPct':80},'antiLeakage':['exactly one fixed 09:15 ET decision per ticker-day','features use pre-market bars at or before 09:15 plus prior completed sessions only','regular-session future bars are labels only','relative-volume baseline uses prior completed days only','chronological train/calibration/holdout split','calibration split into two chronological blocks','configuration selected without holdout','untouched holdout evaluated only after configuration freeze','current float/short/news/SEC snapshots are not backfilled into historical features'],'verdict':'V512_FORWARD_CONFIRMATION_REQUIRED' if credible else 'V512_RESEARCH_COMPLETE_NOT_90','errorsSample':dict(list(errors.items())[:20])}
cases={'schemaVersion':'5.12-preopen-cases','generatedAtUTC':report['generatedAtUTC'],'featureNames':FEATURES,'selectedConfig':report['selectedConfig'],'holdoutSelected':[{'symbol':x['symbol'],'day':x['day'],'action10':x['action10'],'explode20':x['explode20'],'lead10':x['lead10'],'remainingUpsidePct':round(x['remainingUpsidePct'],2),'pAction':round(x['pAction'],4),'disagreement':round(x['disagreement'],4),'preRvol':round(x['preRvol'],3)} for x in select(hc,cfg)]}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');CASES.write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
