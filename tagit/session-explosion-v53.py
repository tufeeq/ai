#!/usr/bin/env python3
"""TAGit v5.3 exact session-explosion learner.

Primary task: predict +10% MFE in the next 60 minutes from a pre-explosion state.
Auxiliary pattern tasks: identify sessions whose high reaches +20% / +50% versus the
previous regular-session close. Only observations with prior-close move < +9% are
eligible, so +20/+50 labels describe the future session outcome while all features
remain strictly backward-looking.
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
OUT=pathlib.Path('tag/data/tagit-v53-session-explosion.json')
NY=ZoneInfo('America/New_York'); UA={'User-Agent':'Mozilla/5.0 TAGit-v5.3-research'}; MAX_SYMBOLS=300
base=json.loads(SRC.read_text())['data']; freq=Counter(x['ticker'] for x in base); symbols=[s for s,_ in freq.most_common(MAX_SYMBOLS)]

def fetch(sym):
    u=f"https://query2.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym,safe='')}?range=60d&interval=5m&includePrePost=true"
    err=None
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=22) as r:d=json.loads(r.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return sym,[],'NO_RESULT'
            ts=z.get('timestamp') or []; q=((z.get('indicators') or {}).get('quote') or [{}])[0]
            O=q.get('open') or [];H=q.get('high') or [];L=q.get('low') or [];C=q.get('close') or [];V=q.get('volume') or []
            a=[]
            for i,t in enumerate(ts):
                if i>=len(C) or C[i] is None:continue
                c=float(C[i]); o=float(O[i] if i<len(O) and O[i] is not None else c); h=float(H[i] if i<len(H) and H[i] is not None else c); l=float(L[i] if i<len(L) and L[i] is not None else c); v=float(V[i] if i<len(V) and V[i] is not None else 0)
                if c>0:a.append({'t':int(t),'o':o,'h':h,'l':l,'c':c,'v':max(0.,v)})
            return sym,a,None
        except Exception as e:
            err=f'{type(e).__name__}:{e}'; time.sleep(.6*(k+1))
    return sym,[],err

raw={}; errors={}
with ThreadPoolExecutor(max_workers=8) as ex:
    fs=[ex.submit(fetch,s) for s in symbols]
    for f in as_completed(fs):
        s,a,e=f.result(); raw[s]=a
        if e or not a:errors[s]=e or 'EMPTY'

def ret(a,b):return (a/b-1)*100 if a and b else 0.0
def sess(dt):
    m=dt.hour*60+dt.minute
    return 0 if 240<=m<570 else (1 if 570<=m<960 else (2 if 960<=m<1200 else 3))
def slot(dt):return (dt.hour*60+dt.minute-240)//5
def safe_med(vals,default):
    m=float(np.median(vals)) if vals else float(default)
    return m if m>1e-9 else max(float(default),1e-9)

rows=[]
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:
        dt=datetime.fromtimestamp(z['t'],timezone.utc).astimezone(NY); s=sess(dt)
        if s<3:by[dt.date().isoformat()].append({**z,'dt':dt,'s':s,'slot':slot(dt)})
    slot_vol=defaultdict(list); slot_cum=defaultdict(list); prev_close=None; prior_daily=[]
    for day in sorted(by):
        a=sorted(by[day],key=lambda z:z['t']); reg=[z for z in a if z['s']==1]
        if len(a)<20 or not reg:continue
        if prev_close is None:
            prev_close=reg[-1]['c']; continue
        day_open=reg[0]['o']; session_high=max(z['h'] for z in a); session_gain=ret(session_high,prev_close)
        session20=session_gain>=20; session50=session_gain>=50
        cum=0.; pvnum=0.; pvden=0.
        for i,z in enumerate(a):
            cum+=z['v']; typ=(z['h']+z['l']+z['c'])/3; pvnum+=typ*z['v']; pvden+=z['v']
            if i<12 or i%3:continue
            c=z['c']; move=ret(c,prev_close); gap=ret(day_open,prev_close)
            if not (.15<=c<=30) or not (-18<=move<9.0) or c*cum<25000:continue
            p=a[:i+1]
            def ago(k):return p[max(0,len(p)-1-k)]['c']
            r5,r10,r15,r30,r60=[ret(c,ago(k)) for k in (1,2,3,6,12)]
            rvbar=z['v']/safe_med(slot_vol[z['slot']][-20:],z['v'] or 1)
            rvcum=cum/safe_med(slot_cum[z['slot']][-20:],cum or 1)
            recent=p[-13:]; cl=np.asarray([x['c'] for x in recent]); compression=(max(cl)/min(cl)-1)*100 if len(cl)>1 and min(cl)>0 else 0
            logret=np.diff(np.log(np.maximum(cl,1e-9))); volat=float(np.std(logret)*100) if len(logret)>1 else 0
            last=p[-7:]; hi=max(x['h'] for x in last); lo=min(x['l'] for x in last); closepos=(c-lo)/(hi-lo) if hi>lo else .5
            vwap=pvnum/pvden if pvden else c; vwapd=ret(c,vwap); acc=r5-r10/2; longacc=r10-r30/3
            pd=prior_daily[-1] if prior_daily else {'range':0,'volume':cum}
            feat=[r5,r10,r15,r30,r60,acc,longacc,move/20,gap/20,math.log1p(z['v']),math.log1p(cum),math.log1p(max(0,c*cum)),math.log1p(max(0,rvbar)),math.log1p(max(0,rvcum)),compression/10,volat/10,closepos,vwapd/10,pd['range']/20,math.log1p(max(0,pd['volume']))/20,(z['dt'].hour*60+z['dt'].minute)/1440,float(z['s']==0),float(z['s']==1),float(z['s']==2)]
            fut60=[]; futsess=[]
            for zz in a[i+1:]:
                if zz['t']-z['t']<=3600:fut60.append(zz)
                futsess.append(zz)
            if not fut60 or not futsess:continue
            mfe60=ret(max(x['h'] for x in fut60),c); mae60=ret(min(x['l'] for x in fut60),c); remain=ret(max(x['h'] for x in futsess),c)
            rows.append({'symbol':sym,'day':day,'key':sym+'|'+day,'ts':z['t'],'session':z['s'],'feat':feat,'target10':mfe60>=10,'clean10':mfe60>=10 and mae60>=-5,'session20':session20,'session50':session50,'continue20':remain>=20,'continue50':remain>=50,'sessionGainPct':session_gain,'mfe60':mfe60,'mae60':mae60,'remainSessionMfePct':remain,'rvbar':rvbar,'rvcum':rvcum,'move':move})
        cum2=0
        for z in a:
            cum2+=z['v']; slot_vol[z['slot']].append(z['v']); slot_cum[z['slot']].append(cum2); slot_vol[z['slot']]=slot_vol[z['slot']][-20:]; slot_cum[z['slot']]=slot_cum[z['slot']][-20:]
        rr=(max(z['h'] for z in reg)/min(z['l'] for z in reg)-1)*100 if min(z['l'] for z in reg)>0 else 0
        prior_daily.append({'range':rr,'volume':sum(z['v'] for z in reg)}); prior_daily=prior_daily[-20:]; prev_close=reg[-1]['c']

dates=sorted({x['day'] for x in rows}); ia=max(1,int(.70*len(dates))); ib=max(ia+1,int(.85*len(dates))); td=set(dates[:ia]); cd=set(dates[ia:ib]); hd=set(dates[ib:])
train=[x for x in rows if x['day'] in td]; cal=[x for x in rows if x['day'] in cd]; hold=[x for x in rows if x['day'] in hd]

def fit_binary(rr,target,seed):
    X=np.asarray([x['feat'] for x in rr],float); y=np.asarray([int(x[target]) for x in rr],int)
    if len(np.unique(y))<2:return {'constant':float(y[0]) if len(y) else 0.0}
    cnt=Counter(x['key'] for x in rr); ew=np.asarray([1/max(1,cnt[x['key']]) for x in rr]); sc=StandardScaler().fit(X); Xs=sc.transform(X); pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); w=ew*np.where(y==1,min(180,neg/pos),1)
    et=ExtraTreesClassifier(n_estimators=500,max_depth=14,min_samples_leaf=6,max_features=.78,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=ew)
    hg=HistGradientBoostingClassifier(max_iter=260,max_leaf_nodes=17,learning_rate=.035,l2_regularization=10,min_samples_leaf=22,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.08,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=ew)
    return {'sc':sc,'et':et,'hg':hg,'lr':lr}

def probs(m,rr):
    if 'constant' in m:return np.full(len(rr),m['constant'],float)
    X=np.asarray([x['feat'] for x in rr],float); Xs=m['sc'].transform(X); ps=np.vstack([m['et'].predict_proba(X)[:,1],m['hg'].predict_proba(X)[:,1],m['lr'].predict_proba(Xs)[:,1]])
    return .42*ps[0]+.40*ps[1]+.18*ps[2]

def enrich(models,rr):
    p10=probs(models['target10'],rr); p20=probs(models['session20'],rr); p50=probs(models['session50'],rr)
    return [{**x,'p10':float(a),'pSession20':float(b),'pSession50':float(c),'explosionScore':float(.55*a+.30*b+.15*c)} for x,a,b,c in zip(rr,p10,p20,p50)]

def first(xs):
    out=[]; seen=set()
    for x in sorted(xs,key=lambda z:z['ts']):
        if x['key'] in seen:continue
        seen.add(x['key']); out.append(x)
    return out

def stat(sel,u):
    n=len(sel); tp=sum(x['target10'] for x in sel); h20=sum(x['session20'] for x in sel); h50=sum(x['session50'] for x in sel)
    win10={x['key'] for x in u if x['target10']}; hit10={x['key'] for x in sel if x['target10']}
    return {'count':n,'tp10':tp,'precision10Pct':round(tp/n*100,2) if n else None,'session20Hits':h20,'session20RatePct':round(h20/n*100,2) if n else None,'session50Hits':h50,'session50RatePct':round(h50/n*100,2) if n else None,'winnerTickerDays10':len(win10),'capturedTickerDays10':len(hit10),'tickerDayRecall10Pct':round(len(hit10)/len(win10)*100,2) if win10 else None,'activeDays':len({x['day'] for x in sel})}

def pick(xs,c):
    e,p20,p50,rv,rc,ss=c
    return first([x for x in xs if x['explosionScore']>=e and x['pSession20']>=p20 and x['pSession50']>=p50 and x['rvbar']>=rv and x['rvcum']>=rc and x['session'] in ss])

def profile(rr,target):
    z=first([x for x in rr if x[target]])
    if not z:return {'count':0}
    F=np.asarray([x['feat'] for x in z],float); names=['r5','r10','r15','r30','r60','acc5v10','acc10v30','movePrevClose','gap','logBarVol','logCumVol','logDollarVol','logRVOLbar','logRVOLcum','compression','volatility','closePosition','vwapDistance','priorDayRange','priorDayVolume','timeOfDay','isPre','isRegular','isAfter']
    return {'count':len(z),'tickerDays':len({x['key'] for x in z}),'medianFeatures':{n:round(float(np.median(F[:,i])),4) for i,n in enumerate(names)},'p75Features':{n:round(float(np.quantile(F[:,i],.75)),4) for i,n in enumerate(names)}}

if len(train)<1000 or sum(x['target10'] for x in train)<30 or sum(x['session20'] for x in train)<10:
    report={'schemaVersion':'5.3-session-explosion','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'INSUFFICIENT','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','rows':len(rows),'days':len(dates),'train10':sum(x['target10'] for x in train),'train20':sum(x['session20'] for x in train),'train50':sum(x['session50'] for x in train)}
else:
    targets=('target10','session20','session50'); models={t:fit_binary(train,t,5300+i*20) for i,t in enumerate(targets)}; cp=enrich(models,cal); es=np.asarray([x['explosionScore'] for x in cp]); ths=sorted(set([.45,.55,.65,.75,.82,.88,.92,.95,.97]+[float(np.quantile(es,q)) for q in (.90,.93,.95,.97,.98,.99)])); cfgs=[]
    for e in ths:
      for p20 in (.05,.10,.20,.30,.40,.50,.60):
       for p50 in (0,.02,.05,.10,.20,.30):
        for rv in (0,1.25,1.75,2.5,4):
         for rc in (0,1.25,1.75,2.5,4):
          for ss in ((0,),(1,),(0,1),(0,1,2)):
            c=(e,p20,p50,rv,rc,ss); z=stat(pick(cp,c),cp); p=z['precision10Pct'] or 0; qualified=z['count']>=20 and p>=90; utility=(1e7 if qualified else 0)+p*100+z['session20Hits']*8+z['session50Hits']*15+z['tp10']*2; cfgs.append((utility,qualified,c,z))
    cfgs.sort(key=lambda x:x[0],reverse=True); _,cq,cfg,cm=cfgs[0]
    final={t:fit_binary(train+cal,t,6300+i*20) for i,t in enumerate(targets)}; hp=enrich(final,hold); hs=stat(pick(hp,cfg),hp); hq=hs['count']>=20 and (hs['precision10Pct'] or 0)>=90
    report={'schemaVersion':'5.3-session-explosion','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'COMPLETE','provider':'Yahoo 5m 60d','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','targetDefinitions':{'target10':'+10% MFE in next 60m','session20':'full-session high >= +20% vs previous regular close','session50':'full-session high >= +50% vs previous regular close','eligibility':'observation prior-close move < +9%'},'rows':len(rows),'days':len(dates),'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'splits':{'train':len(train),'calibration':len(cal),'holdout':len(hold),'train10':sum(x['target10'] for x in train),'train20':sum(x['session20'] for x in train),'train50':sum(x['session50'] for x in train),'cal10':sum(x['target10'] for x in cal),'cal20':sum(x['session20'] for x in cal),'cal50':sum(x['session50'] for x in cal),'hold10':sum(x['target10'] for x in hold),'hold20':sum(x['session20'] for x in hold),'hold50':sum(x['session50'] for x in hold)},'antiLeakage':['features use only current/prior bars','same-time RVOL baselines use prior days only','20/50 session outcomes are labels only','observations excluded once prior-close move reaches +9%','chronological 70/15/15 date split','configuration selected on calibration only','holdout evaluated only after configuration freeze','first selected ticker/day event is action unit'],'patternProfiles':{'plus20Train':profile(train,'session20'),'plus50Train':profile(train,'session50')},'selectedConfig':{'explosionScore':round(cfg[0],6),'minPSession20':cfg[1],'minPSession50':cfg[2],'minRelBarVolume':cfg[3],'minRelCumVolume':cfg[4],'sessions':list(cfg[5])},'calibration':cm,'holdout':hs,'calibrationReached90':cq,'holdoutReached90':hq,'verdict':'V53_90_CONFIRMED' if cq and hq else 'V53_90_NOT_CONFIRMED'}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
