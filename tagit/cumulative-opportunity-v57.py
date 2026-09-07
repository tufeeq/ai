#!/usr/bin/env python3
"""TAGit v5.7 Cumulative Opportunity Learner.

Purpose
- Learn recurring pre-explosion patterns, not only single-run thresholds.
- Preserve repeated opportunity episodes across pre-market, regular, and after-hours.
- Combine current train-period patterns with a cumulative train-only experience memory.
- Model both success archetypes and false-ignition archetypes.
- Measure accuracy only on chronological calibration and untouched holdout.

Primary actionable label:
  First +10% hit occurs 15-90 minutes after the observation, with MAE to hit >= -5%.
Secondary objectives:
  +15% prime move, remaining same-session upside, and quality-adjusted remaining upside.

No holdout outcome is ever written into cumulative experience used for the same run.
"""
import json, math, pathlib, random, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor, HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT=pathlib.Path('tag/data')
FROZEN=ROOT/'tagit-v39-frozen-groundtruth.json'
DISCOVERY=ROOT/'discovery.json'
BASE50=ROOT/'tagit-v50-external-history.json'
BASE53=ROOT/'tagit-v53-session-explosion.json'
BASE56=ROOT/'tagit-v56-session-opportunities.json'
LIB56=ROOT/'tagit-v56-case-library.json'
EXPERIENCE=ROOT/'tagit-cumulative-experience.json'
OUT=ROOT/'tagit-v57-cumulative-opportunities.json'
LIB=ROOT/'tagit-v57-case-library.json'

NY=ZoneInfo('America/New_York')
UA={'User-Agent':'Mozilla/5.0 TAGit-v5.7-cumulative-research'}
MAX_SYMBOLS=600
MIN_OBSERVATIONS=500_000
COOLDOWN_MIN=25
MAX_ALERTS_PER_TICKER_DAY=4
FEATURES=['r5','r10','r15','r30','r60','acc5v10','acc10v30','movePrevClose','gap','logBarVol','logCumVol','logDollarVol','logRVOLbar','logRVOLcum','rvAccel','cumRvAccel','compression','rangeExpansion','volatility','closePosition','vwapDistance','vwapSlope','distanceDayHigh','priorDayRange','logPriorDayVolume','timeOfDay','isPre','isRegular','isAfter']

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def ret(a,b):return (a/b-1)*100 if a and b else 0.0

def sess(dt):
    m=dt.hour*60+dt.minute
    if 240<=m<570:return 0
    if 570<=m<960:return 1
    if 960<=m<1200:return 2
    return 3

def slot(dt):return (dt.hour*60+dt.minute-240)//5

def safe_med(vals,default):
    m=float(np.median(vals)) if vals else float(default)
    return m if m>1e-9 else max(float(default),1e-9)

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def fetch(sym,rng='60d',interval='5m',prepost=True,retries=4):
    q=urllib.parse.quote(sym,safe=''); pp='true' if prepost else 'false'
    u=f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range={rng}&interval={interval}&includePrePost={pp}&events=div%2Csplits'
    err=None
    for k in range(retries):
        try:
            req=urllib.request.Request(u,headers=UA)
            with urllib.request.urlopen(req,timeout=24) as r:d=json.loads(r.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return sym,[],'NO_RESULT'
            ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
            O=qq.get('open') or []; H=qq.get('high') or []; L=qq.get('low') or []; C=qq.get('close') or []; V=qq.get('volume') or []
            out=[]
            for i,t in enumerate(ts):
                if i>=len(C) or C[i] is None:continue
                c=float(C[i]); o=float(O[i] if i<len(O) and O[i] is not None else c); h=float(H[i] if i<len(H) and H[i] is not None else c); l=float(L[i] if i<len(L) and L[i] is not None else c); v=float(V[i] if i<len(V) and V[i] is not None else 0)
                if c>0:out.append({'t':int(t),'o':o,'h':h,'l':l,'c':c,'v':max(0.0,v)})
            return sym,out,None
        except Exception as e:
            err=f'{type(e).__name__}:{e}'; time.sleep(.5*(k+1))
    return sym,[],err

# Universe = historically observed symbols first, then current proactive discovery universe.
frozen=readj(FROZEN,{'data':[]})
freq=Counter(str(x.get('ticker') or '').upper() for x in frozen.get('data',[]) if x.get('ticker'))
hist=[s for s,_ in freq.most_common(380)]
disc=readj(DISCOVERY,{'rows':[]}); fresh=[]
for r in disc.get('rows') or []:
    s=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
    if s and s not in fresh:fresh.append(s)
symbols=[]
for s in hist+fresh:
    if s and s not in symbols:symbols.append(s)
    if len(symbols)>=MAX_SYMBOLS:break

raw={}; errors={}
with ThreadPoolExecutor(max_workers=12) as ex:
    fs=[ex.submit(fetch,s) for s in symbols]
    for f in as_completed(fs):
        s,b,e=f.result(); raw[s]=b
        if e or not b:errors[s]=e or 'EMPTY'

rows=[]; success_cases=[]; failure_cases=[]; unique=set()
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:
        dt=datetime.fromtimestamp(z['t'],timezone.utc).astimezone(NY); s=sess(dt)
        if s<3:by[dt.date().isoformat()].append({**z,'dt':dt,'s':s,'slot':slot(dt)})
    slotv=defaultdict(list); slotc=defaultdict(list); prev_close=None; prior=[]
    for day in sorted(by):
        a=sorted(by[day],key=lambda x:x['t']); reg=[x for x in a if x['s']==1]
        if len(a)<24 or not reg:continue
        if prev_close is None:
            prev_close=reg[-1]['c']; continue
        day_open=reg[0]['o']; session_hi=max(x['h'] for x in a); session_gain=ret(session_hi,prev_close)
        cum=0.0; pvnum=0.0; pvden=0.0; dayrows=[]; rv_hist=[]; rvc_hist=[]; vwap_hist=[]
        for i,z in enumerate(a):
            unique.add((sym,z['t'])); cum+=z['v']; typ=(z['h']+z['l']+z['c'])/3; pvnum+=typ*z['v']; pvden+=z['v']
            if i<12:continue
            c=z['c']; move=ret(c,prev_close); gap=ret(day_open,prev_close)
            if not (.15<=c<=30) or not (-20<=move<8.0) or c*cum<25000:continue
            p=a[:i+1]
            def ago(k):return p[max(0,len(p)-1-k)]['c']
            r5,r10,r15,r30,r60=[ret(c,ago(k)) for k in (1,2,3,6,12)]
            rvb=z['v']/safe_med(slotv[z['slot']][-20:],z['v'] or 1); rvc=cum/safe_med(slotc[z['slot']][-20:],cum or 1)
            rv_hist.append(rvb); rvc_hist.append(rvc)
            rv_acc=rvb-safe_med(rv_hist[-4:-1],rvb) if len(rv_hist)>3 else 0.0
            rvc_acc=rvc-safe_med(rvc_hist[-4:-1],rvc) if len(rvc_hist)>3 else 0.0
            recent=p[-13:]; cl=np.asarray([x['c'] for x in recent],float)
            compression=(max(cl)/min(cl)-1)*100 if len(cl)>1 and min(cl)>0 else 0.0
            prev_window=p[-25:-12] if len(p)>=25 else p[:-12]
            prior_range=(max(x['h'] for x in prev_window)/min(x['l'] for x in prev_window)-1)*100 if prev_window and min(x['l'] for x in prev_window)>0 else compression
            range_exp=compression-prior_range
            logr=np.diff(np.log(np.maximum(cl,1e-9))); volat=float(np.std(logr)*100) if len(logr)>1 else 0.0
            last=p[-7:]; hi=max(x['h'] for x in last); lo=min(x['l'] for x in last); closepos=(c-lo)/(hi-lo) if hi>lo else .5
            vwap=pvnum/pvden if pvden else c; vwap_hist.append(vwap); vwapd=ret(c,vwap); vwapslope=ret(vwap,vwap_hist[-4]) if len(vwap_hist)>=4 and vwap_hist[-4]>0 else 0.0
            day_hi=max(x['h'] for x in p); dist_hi=ret(c,day_hi)
            pd=prior[-1] if prior else {'range':0.0,'volume':cum}
            feat=[r5,r10,r15,r30,r60,r5-r10/2,r10-r30/3,move/20,gap/20,math.log1p(z['v']),math.log1p(cum),math.log1p(max(0,c*cum)),math.log1p(max(0,rvb)),math.log1p(max(0,rvc)),rv_acc/5,rvc_acc/5,compression/10,range_exp/10,volat/10,closepos,vwapd/10,vwapslope/5,dist_hi/10,pd['range']/20,math.log1p(max(0,pd['volume']))/20,(z['dt'].hour*60+z['dt'].minute)/1440,float(z['s']==0),float(z['s']==1),float(z['s']==2)]
            future=a[i+1:]; same=[x for x in future if x['s']==z['s']]
            if not same:continue
            rem_mfe=ret(max(x['h'] for x in same),c); rem_mae=ret(min(x['l'] for x in same),c); peak=max(same,key=lambda x:x['h']); time_peak=(peak['t']-z['t'])/60
            def hit(pct,maxmin):
                for zz in future:
                    dm=(zz['t']-z['t'])/60
                    if dm>maxmin:break
                    if zz['h']>=c*(1+pct/100):return zz['t'],dm
                return None,None
            h10,l10=hit(10,120); h15,l15=hit(15,150)
            horizon=[x for x in future if (x['t']-z['t'])/60<=120]
            if h10:
                pre=[x for x in future if x['t']<=h10]; mae10=ret(min(x['l'] for x in pre),c) if pre else 0.0
            else:mae10=ret(min((x['l'] for x in horizon),default=c),c)
            action10=bool(l10 is not None and 15<=l10<=90 and mae10>=-5)
            prime15=bool(l15 is not None and 20<=l15<=120 and mae10>=-5.5)
            too_fast=bool(l10 is not None and l10<15)
            ignition=(rvb>=1.35 or rvc>=1.35 or rv_acc>=.5 or rvc_acc>=.5 or r10>=1.1 or r5>=.7 or (closepos>=.68 and vwapd>=0))
            hardneg=bool((not action10) and (ignition or too_fast or session_gain>=20))
            quality=max(-20.0,min(100.0,rem_mfe-max(0.0,-rem_mae)*1.8-max(0.0,15-time_peak)*.08))
            row={'symbol':sym,'day':day,'key':sym+'|'+day,'ts':z['t'],'session':z['s'],'feat':feat,'action10':action10,'prime15':prime15,'hardNeg':hardneg,'tooFast':too_fast,'lead10':l10,'lead15':l15,'remainingMfePct':rem_mfe,'remainingMaePct':rem_mae,'timeToPeakMin':time_peak,'qualityReturn':quality,'session20':session_gain>=20,'session50':session_gain>=50,'sessionGainPct':session_gain,'move':move,'rvbar':rvb,'rvcum':rvc}
            rows.append(row); dayrows.append(row)
        # Event-level experience anchors: positives near useful lead windows; failures are ignition states that never became actionable.
        for x in dayrows:
            if x['action10'] and x['lead10'] is not None and 20<=x['lead10']<=75:
                success_cases.append(x)
            elif x['hardNeg'] and (x['rvbar']>=1.4 or x['rvcum']>=1.4):
                failure_cases.append(x)
        cum2=0.0
        for z in a:
            cum2+=z['v']; slotv[z['slot']].append(z['v']); slotc[z['slot']].append(cum2); slotv[z['slot']]=slotv[z['slot']][-20:]; slotc[z['slot']]=slotc[z['slot']][-20:]
        rr=(max(x['h'] for x in reg)/min(x['l'] for x in reg)-1)*100 if min(x['l'] for x in reg)>0 else 0.0
        prior.append({'range':rr,'volume':sum(x['v'] for x in reg)}); prior=prior[-20:]; prev_close=reg[-1]['c']

dates=sorted({x['day'] for x in rows}); ia=max(1,int(.70*len(dates))); ib=max(ia+1,int(.85*len(dates)))
td=set(dates[:ia]); cd=set(dates[ia:ib]); hd=set(dates[ib:])
train=[x for x in rows if x['day'] in td]; cal=[x for x in rows if x['day'] in cd]; hold=[x for x in rows if x['day'] in hd]
train_pos=[x for x in success_cases if x['day'] in td]; train_neg=[x for x in failure_cases if x['day'] in td]

# Cumulative experience is allowed only if its maxDate is strictly before current holdout start.
prior_exp=readj(EXPERIENCE,{'schemaVersion':'1.0','featureNames':FEATURES,'archetypes':[]})
holdout_start=min(hd) if hd else '9999-12-31'
prior_archetypes=[]
if prior_exp.get('featureNames')==FEATURES:
    for a0 in prior_exp.get('archetypes') or []:
        if str(a0.get('maxDate') or '0000-00-00') < holdout_start and len(a0.get('centroid') or [])==len(FEATURES):prior_archetypes.append(a0)

def subset(rr,target,seed):
    pos=[x for x in rr if x[target]]; hard=[x for x in rr if not x[target] and x['hardNeg']]; easy=[x for x in rr if not x[target] and not x['hardNeg']]
    rnd=random.Random(seed); rnd.shuffle(hard); rnd.shuffle(easy)
    return pos+hard[:min(len(hard),max(6000,len(pos)*6))]+easy[:min(len(easy),max(4000,len(pos)*3))]

def fit_cls(rr,target,seed):
    u=subset(rr,target,seed); X=np.asarray([x['feat'] for x in u],float); y=np.asarray([int(x[target]) for x in u],int)
    if len(y)==0 or len(np.unique(y))<2:return {'constant':float(y[0]) if len(y) else 0.0,'n':len(y),'p':int(y.sum()) if len(y) else 0}
    cnt=Counter(x['key'] for x in u); ew=np.asarray([1/max(1,cnt[x['key']]) for x in u],float); hw=np.asarray([2.4 if (not x[target] and x['hardNeg']) else 1.0 for x in u],float)
    sc=StandardScaler().fit(X); Xs=sc.transform(X); pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); w=ew*hw*np.where(y==1,min(90,neg/pos),1)
    et=ExtraTreesClassifier(n_estimators=460,max_depth=14,min_samples_leaf=7,max_features=.76,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=ew*hw)
    hg=HistGradientBoostingClassifier(max_iter=260,max_leaf_nodes=21,learning_rate=.035,l2_regularization=14,min_samples_leaf=28,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.07,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=ew*hw)
    return {'sc':sc,'et':et,'hg':hg,'lr':lr,'n':len(y),'p':int(y.sum())}

def clsprob(m,rr):
    if 'constant' in m:return np.full(len(rr),m['constant']),np.zeros(len(rr))
    X=np.asarray([x['feat'] for x in rr],float); Xs=m['sc'].transform(X)
    ps=np.vstack([m['et'].predict_proba(X)[:,1],m['hg'].predict_proba(X)[:,1],m['lr'].predict_proba(Xs)[:,1]])
    return .45*ps[0]+.40*ps[1]+.15*ps[2],np.std(ps,axis=0)

def fit_reg(rr,target,seed):
    X=np.asarray([x['feat'] for x in rr],float); y=np.asarray([max(-20,min(100,float(x[target]))) for x in rr],float)
    cnt=Counter(x['key'] for x in rr); w=np.asarray([1/max(1,cnt[x['key']]) for x in rr],float)
    et=ExtraTreesRegressor(n_estimators=360,max_depth=14,min_samples_leaf=8,max_features=.75,n_jobs=-1,random_state=seed).fit(X,y,sample_weight=w)
    hg=HistGradientBoostingRegressor(max_iter=220,max_leaf_nodes=19,learning_rate=.04,l2_regularization=12,min_samples_leaf=30,random_state=seed+1).fit(X,y,sample_weight=w)
    return {'et':et,'hg':hg}

def regpred(m,rr):
    X=np.asarray([x['feat'] for x in rr],float); return .55*m['et'].predict(X)+.45*m['hg'].predict(X)

def build_archetypes(pos,neg):
    alltrain=pos+neg
    if len(alltrain)<60:return None
    X=np.asarray([x['feat'] for x in alltrain],float); sc=StandardScaler().fit(X)
    def fit_group(g,kind):
        if len(g)<20:return []
        G=np.asarray([x['feat'] for x in g],float); Z=sc.transform(G); k=min(10,max(3,len(g)//90)); km=MiniBatchKMeans(n_clusters=k,random_state=5700+(0 if kind=='success' else 100),batch_size=512,n_init=10,max_iter=300).fit(Z)
        labels=km.labels_; out=[]
        for j in range(k):
            idx=np.where(labels==j)[0]
            if len(idx)==0:continue
            gg=[g[int(i)] for i in idx]; centroid=np.mean(G[idx],axis=0)
            out.append({'kind':kind,'count':len(gg),'centroid':[round(float(v),7) for v in centroid],'minDate':min(x['day'] for x in gg),'maxDate':max(x['day'] for x in gg),'actionRatePct':round(100*sum(x['action10'] for x in gg)/len(gg),2),'medianLeadMin':round(float(np.median([x['lead10'] for x in gg if x['lead10'] is not None])),1) if any(x['lead10'] is not None for x in gg) else None,'medianRemainingMfePct':round(float(np.median([x['remainingMfePct'] for x in gg])),2),'sessionMix':{str(s):sum(x['session']==s for x in gg) for s in (0,1,2)}})
        return out
    return {'sc':sc,'success':fit_group(pos,'success'),'failure':fit_group(neg,'failure')}

arch=build_archetypes(train_pos,train_neg)

def similarity(rr,items,sc):
    if not rr or not items:return np.zeros(len(rr))
    X=sc.transform(np.asarray([x['feat'] for x in rr],float)); C=sc.transform(np.asarray([x['centroid'] for x in items],float))
    d=np.sqrt(((X[:,None,:]-C[None,:,:])**2).mean(axis=2)); md=d.min(axis=1); scale=max(float(np.median(md)),1e-6)
    return np.exp(-md/scale)

def prior_similarity(rr,kind):
    items=[a for a in prior_archetypes if a.get('kind')==kind]
    if not rr or not items:return np.zeros(len(rr))
    # Use current training scaler so old raw centroids are comparable without leaking holdout outcomes.
    Xtrain=np.asarray([x['feat'] for x in train],float); sc=StandardScaler().fit(Xtrain)
    return similarity(rr,items,sc)

ma=fit_cls(train,'action10',5710); mp=fit_cls(train,'prime15',5740); mr=fit_reg(train,'remainingMfePct',5770); mq=fit_reg(train,'qualityReturn',5790)

def enrich(rr):
    pa,dis=clsprob(ma,rr); pp,_=clsprob(mp,rr); rem=regpred(mr,rr); qual=regpred(mq,rr)
    if arch:
        spos=similarity(rr,arch['success'],arch['sc']); sneg=similarity(rr,arch['failure'],arch['sc'])
    else:
        spos=np.zeros(len(rr)); sneg=np.zeros(len(rr))
    oldpos=prior_similarity(rr,'success'); oldneg=prior_similarity(rr,'failure')
    out=[]
    for x,a,p,r,q,d,sp,sn,op,on in zip(rr,pa,pp,rem,qual,dis,spos,sneg,oldpos,oldneg):
        pattern_lift=float(sp-sn); memory_lift=float(op-on)
        # Scores are ranking scores, not calibrated probabilities.
        score=float(.46*a+.10*p+.14*np.clip(r,0,40)/40+.08*np.clip(q,0,40)/40+.10*np.clip((pattern_lift+1)/2,0,1)+.07*np.clip((memory_lift+1)/2,0,1)+.05*(1-min(1,d/.35)))
        out.append({**x,'pAction':float(a),'pPrime15':float(p),'predRemainingMfePct':float(r),'predQualityReturn':float(q),'disagreement':float(d),'successSimilarity':float(sp),'failureSimilarity':float(sn),'patternLift':pattern_lift,'memoryLift':memory_lift,'opportunityScore':score})
    return out

def episodes(xs,cfg):
    score,pa,rem,dis,lift,sessions=cfg
    eligible=[x for x in xs if x['opportunityScore']>=score and x['pAction']>=pa and x['predRemainingMfePct']>=rem and x['disagreement']<=dis and x['patternLift']>=lift and x['session'] in sessions]
    by=defaultdict(list)
    for x in eligible:by[x['key']].append(x)
    out=[]
    for _,g in by.items():
        chosen=[]
        for x in sorted(g,key=lambda z:z['ts']):
            if len(chosen)>=MAX_ALERTS_PER_TICKER_DAY:break
            if not chosen:chosen.append(x);continue
            mins=(x['ts']-chosen[-1]['ts'])/60
            improved=x['opportunityScore']>=chosen[-1]['opportunityScore']*1.12 or x['predRemainingMfePct']>=chosen[-1]['predRemainingMfePct']+4
            if mins>=COOLDOWN_MIN and improved:chosen.append(x)
        out.extend(chosen)
    return sorted(out,key=lambda z:z['ts'])

def stat(sel,universe):
    n=len(sel); tp=sum(x['action10'] for x in sel); prime=sum(x['prime15'] for x in sel)
    rem=[x['remainingMfePct'] for x in sel]; leads=[x['lead10'] for x in sel if x['action10'] and x['lead10'] is not None]
    byday=defaultdict(list)
    for x in sel:byday[x['day']].append(x)
    top3=[]
    for d,g in byday.items():top3.extend(sorted(g,key=lambda z:z['opportunityScore'],reverse=True)[:3])
    t3n=len(top3); t3tp=sum(x['action10'] for x in top3)
    winner_days={x['day'] for x in universe if x['action10']}; caught_days={x['day'] for x in sel if x['action10']}
    return {'count':n,'tpAction10':tp,'precisionActionablePct':round(tp/n*100,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'prime15RatePct':round(prime/n*100,2) if n else None,'medianRemainingMfePct':round(float(np.median(rem)),2) if rem else None,'p75RemainingMfePct':round(float(np.quantile(rem,.75)),2) if rem else None,'medianLeadMin':round(float(np.median(leads)),1) if leads else None,'activeDays':len(byday),'winnerDays':len(winner_days),'capturedWinnerDays':len(caught_days),'winnerDayRecallPct':round(len(caught_days)/len(winner_days)*100,2) if winner_days else None,'top3DailyCount':t3n,'top3DailyPrecisionPct':round(t3tp/t3n*100,2) if t3n else None,'sessionCounts':{str(s):sum(x['session']==s for x in sel) for s in (0,1,2)}}

cp=enrich(cal); scores=np.asarray([x['opportunityScore'] for x in cp]); pas=np.asarray([x['pAction'] for x in cp]); rems=np.asarray([x['predRemainingMfePct'] for x in cp]); lifts=np.asarray([x['patternLift'] for x in cp])
score_grid=sorted(set([.45,.55,.65,.75,.82]+[round(float(np.quantile(scores,q)),4) for q in (.80,.88,.92,.95,.97)]))
pa_grid=sorted(set([.35,.50,.65,.78]+[round(float(np.quantile(pas,q)),4) for q in (.80,.90,.95)]))
rem_grid=sorted(set([6,8,10,12,15]+[round(float(np.quantile(rems,q)),2) for q in (.55,.70,.80)]))
lift_grid=sorted(set([-.2,0,.1,.2]+[round(float(np.quantile(lifts,q)),3) for q in (.50,.70,.85)]))
configs=[]
for sc in score_grid:
  for pa in pa_grid:
    for rm in rem_grid:
      for di in (.10,.16,.24,.32):
        for lf in lift_grid:
          for ss in ((0,),(1,),(0,1),(0,1,2)):
            cfg=(sc,pa,rm,di,lf,ss); z=stat(episodes(cp,cfg),cp); n=z['count']; p=z['precisionActionablePct'] or 0; lo=z['wilsonLower90Pct'] or 0; med=z['medianRemainingMfePct'] or 0; rec=z['winnerDayRecallPct'] or 0; top3=z['top3DailyPrecisionPct'] or 0
            # Precision first, but require enough support and preserve useful remaining upside and day coverage.
            utility=lo*180+p*45+top3*20+min(med,30)*25+rec*8+min(n,120)*2
            if n<25:utility-=6000
            if med<8:utility-=2500
            configs.append((utility,cfg,z))
configs.sort(key=lambda x:x[0],reverse=True); _,cfg,cm=configs[0]
hp=enrich(hold); hs=stat(episodes(hp,cfg),hp)

# Build/update cumulative memory using TRAIN outcomes only.
new_arch=[]
if arch:new_arch=arch['success']+arch['failure']
combined=[]
for a0 in prior_archetypes+new_arch:
    if len(a0.get('centroid') or [])!=len(FEATURES):continue
    combined.append(a0)
# Deduplicate very similar archetypes while retaining outcome-weighted counts.
if combined:
    X=np.asarray([a['centroid'] for a in combined],float); sc_mem=StandardScaler().fit(X); Z=sc_mem.transform(X); k=min(40,max(6,len(combined)//2)); km=MiniBatchKMeans(n_clusters=k,random_state=5799,batch_size=256,n_init=10,max_iter=250).fit(Z)
    compact=[]
    for j in range(k):
        ids=np.where(km.labels_==j)[0]
        if len(ids)==0:continue
        grp=[combined[int(i)] for i in ids]; kinds=Counter(a.get('kind','unknown') for a in grp); kind=kinds.most_common(1)[0][0]; weights=np.asarray([max(1,float(a.get('count',1))) for a in grp]); cents=np.asarray([a['centroid'] for a in grp],float); centroid=np.average(cents,axis=0,weights=weights)
        compact.append({'kind':kind,'count':int(weights.sum()),'centroid':[round(float(v),7) for v in centroid],'minDate':min(str(a.get('minDate') or min(td or ['0000-00-00'])) for a in grp),'maxDate':max(str(a.get('maxDate') or max(td or ['0000-00-00'])) for a in grp),'sourceRuns':len(grp)})
else:compact=[]
experience={'schemaVersion':'1.1','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'featureNames':FEATURES,'policy':'TRAIN_ONLY_CUMULATIVE_EXPERIENCE_NO_CURRENT_HOLDOUT_OUTCOMES','archetypes':compact,'currentTrainPeriod':{'minDate':min(td) if td else None,'maxDate':max(td) if td else None},'currentHoldoutStart':holdout_start}

# Open-history augmentation only if 5m observation goal is not met; never mixed into timing model.
augmentation={'used':False,'provider':None,'bars':0,'days':0,'plus20Sessions':0,'plus50Sessions':0}
if len(unique)<MIN_OBSERVATIONS:
    augmentation['used']=True; augmentation['provider']='Yahoo chart 60m 730d open history'
    hourly={}
    with ThreadPoolExecutor(max_workers=8) as ex:
        fs=[ex.submit(fetch,s,'730d','60m',False,3) for s in symbols[:380]]
        for f in as_completed(fs):
            s,b,e=f.result()
            if b:hourly[s]=b
    days_seen=set(); p20=p50=bc=0
    for s,bars in hourly.items():
        bc+=len(bars); by=defaultdict(list)
        for z in bars:
            dt=datetime.fromtimestamp(z['t'],timezone.utc).astimezone(NY); by[dt.date().isoformat()].append(z)
        prev=None
        for d in sorted(by):
            arr=by[d]; days_seen.add(d)
            if prev is not None:
                g=ret(max(x['h'] for x in arr),prev); p20+=g>=20; p50+=g>=50
            prev=arr[-1]['c'] if arr else prev
    augmentation.update({'bars':bc,'days':len(days_seen),'plus20Sessions':int(p20),'plus50Sessions':int(p50)})

b50=readj(BASE50,{}); b53=readj(BASE53,{}); b56=readj(BASE56,{})
report={'schemaVersion':'5.7-cumulative-opportunity','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'COMPLETE' if train and cal and hold else 'INSUFFICIENT','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','architecture':'ACTIONABILITY + PRIME15 + REMAINING_UPSIDE + SUCCESS/FAILURE ARCHETYPES + CUMULATIVE EXPERIENCE + REPEATED EPISODES','objective':{'primary':'detect actionable +10% opportunity 15-90m before first hit','secondary':'maximize remaining same-session upside','coverage':'pre-market + regular + after-hours','repeatPolicy':f'up to {MAX_ALERTS_PER_TICKER_DAY} episodes per ticker/day with {COOLDOWN_MIN}m cooldown and material score/upside improvement'},'data':{'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'unique5mObservations':len(unique),'decisionRows':len(rows),'tickerDays':len({x['key'] for x in rows}),'days':len(dates),'trainSuccessCases':len(train_pos),'trainFailureCases':len(train_neg),'priorExperienceArchetypesUsed':len(prior_archetypes),'currentArchetypes':len(new_arch),'cumulativeArchetypesAfterCompaction':len(compact),'met500kObservationGoal':len(unique)>=MIN_OBSERVATIONS,'augmentation':augmentation},'splits':{'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd),'trainAction10':sum(x['action10'] for x in train),'calAction10':sum(x['action10'] for x in cal),'holdAction10':sum(x['action10'] for x in hold)},'selectedConfig':{'minOpportunityScore':cfg[0],'minPAction':cfg[1],'minPredRemainingMfePct':cfg[2],'maxDisagreement':cfg[3],'minPatternLift':cfg[4],'sessions':list(cfg[5])},'calibration':cm,'holdout':hs,'baselines':{'v50HoldoutPrecisionPct':(b50.get('holdout') or {}).get('precisionPct'),'v53HoldoutPrecisionPct':(b53.get('holdout') or {}).get('precision10Pct'),'v56HoldoutPrecisionPct':(b56.get('holdout') or {}).get('precisionActionablePct')},'training':{'actionModelTrainCount':ma.get('n'),'actionModelPositives':ma.get('p'),'primeModelTrainCount':mp.get('n'),'primeModelPositives':mp.get('p'),'experienceMemoryRule':'only archetypes ending before current holdout start are eligible','falsePatternLearning':True,'successPatternLearning':True},'accuracyGate':{'holdoutSupport':hs['count'],'holdoutPrecisionPct':hs['precisionActionablePct'],'holdoutWilsonLower90Pct':hs['wilsonLower90Pct'],'holdoutTop3DailyPrecisionPct':hs['top3DailyPrecisionPct'],'holdoutMedianRemainingMfePct':hs['medianRemainingMfePct'],'credible90Claim':bool(hs['count']>=30 and (hs['precisionActionablePct'] or 0)>=90 and (cm['precisionActionablePct'] or 0)>=90)},'antiLeakage':['features use current/prior completed bars only','future highs/lows/times are labels only','same-time RVOL baselines use prior days only','chronological 70/15/15 split','success/failure archetypes fit on train only','cumulative experience must end before current holdout start','configuration selected on calibration only','untouched holdout evaluated after configuration freeze','holdout outcomes never update experience used in same run'],'verdict':'V57_90_CONFIRMED' if (hs['count']>=30 and (hs['precisionActionablePct'] or 0)>=90 and (cm['precisionActionablePct'] or 0)>=90) else 'V57_RESEARCH_COMPLETE_NOT_90','errorsSample':dict(list(errors.items())[:20])}
lib={'schemaVersion':'5.7-case-library','generatedAtUTC':report['generatedAtUTC'],'featureNames':FEATURES,'successCases':len(train_pos),'failureCases':len(train_neg),'archetypes':new_arch,'policy':'TRAIN_ONLY_PATTERN_LIBRARY'}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
LIB.write_text(json.dumps(lib,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
EXPERIENCE.write_text(json.dumps(experience,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
