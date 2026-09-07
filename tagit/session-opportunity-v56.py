#!/usr/bin/env python3
"""TAGit v5.6 Session Opportunity Hunter.

Objective: surface repeatable, actionable opportunities across pre-market, regular, and
after-hours BEFORE the main move, while ranking by expected remaining same-session upside.
This is research-only. All features are causal; future highs/lows/times are labels only.
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

FROZEN=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json')
DISCOVERY=pathlib.Path('tag/data/discovery.json')
BASE50=pathlib.Path('tag/data/tagit-v50-external-history.json')
BASE53=pathlib.Path('tag/data/tagit-v53-session-explosion.json')
OUT=pathlib.Path('tag/data/tagit-v56-session-opportunities.json')
LIB=pathlib.Path('tag/data/tagit-v56-case-library.json')
NY=ZoneInfo('America/New_York')
UA={'User-Agent':'Mozilla/5.0 TAGit-v5.6-session-opportunity-research'}
MAX_SYMBOLS=550
MIN_POOL=500_000
COOLDOWN_MIN=30
MAX_ALERTS_PER_TICKER_DAY=3

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def ret(a,b):return (a/b-1)*100 if a and b else 0.0
def sess(dt):
    m=dt.hour*60+dt.minute
    if 240<=m<570:return 0
    if 570<=m<960:return 1
    if 960<=m<1200:return 2
    return 3
def slot(dt):return (dt.hour*60+dt.minute-240)//5
def medpos(vals,default):
    m=float(np.median(vals)) if vals else float(default)
    return m if m>1e-9 else max(float(default),1e-9)
def wilson(tp,n,z=1.645):
    if n<1:return 0.
    p=tp/n;den=1+z*z/n
    return max(0.,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100

def fetch(sym,rng='60d',interval='5m',prepost=True,retries=4):
    q=urllib.parse.quote(sym,safe=''); pp='true' if prepost else 'false'
    u=f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range={rng}&interval={interval}&includePrePost={pp}&events=div%2Csplits'
    err=None
    for k in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=24) as r:d=json.loads(r.read().decode())
            z=((d.get('chart') or {}).get('result') or [None])[0]
            if not z:return sym,[],'NO_RESULT'
            ts=z.get('timestamp') or [];qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
            O=qq.get('open') or [];H=qq.get('high') or [];L=qq.get('low') or [];C=qq.get('close') or [];V=qq.get('volume') or []
            out=[]
            for i,t in enumerate(ts):
                if i>=len(C) or C[i] is None:continue
                c=float(C[i]);o=float(O[i] if i<len(O) and O[i] is not None else c);h=float(H[i] if i<len(H) and H[i] is not None else c);l=float(L[i] if i<len(L) and L[i] is not None else c);v=float(V[i] if i<len(V) and V[i] is not None else 0)
                if c>0:out.append({'t':int(t),'o':o,'h':h,'l':l,'c':c,'v':max(0.,v)})
            return sym,out,None
        except Exception as e:
            err=f'{type(e).__name__}:{e}'; time.sleep(.55*(k+1))
    return sym,[],err

frozen=readj(FROZEN,{'data':[]}); freq=Counter(str(x.get('ticker') or '').upper() for x in frozen.get('data',[]) if x.get('ticker'))
hist=[s for s,_ in freq.most_common(350)]
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

FEATURES=['r5','r10','r15','r30','r60','acc5v10','acc10v30','movePrevClose','gap','logBarVol','logCumVol','logDollarVol','logRVOLbar','logRVOLcum','compression','volatility','closePosition','vwapDistance','priorDayRange','logPriorDayVolume','timeOfDay','isPre','isRegular','isAfter']
rows=[];cases=[];unique=set()
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:
        dt=datetime.fromtimestamp(z['t'],timezone.utc).astimezone(NY);s=sess(dt)
        if s<3:by[dt.date().isoformat()].append({**z,'dt':dt,'s':s,'slot':slot(dt)})
    slotv=defaultdict(list);slotc=defaultdict(list);prev_close=None;prior=[]
    for day in sorted(by):
        a=sorted(by[day],key=lambda x:x['t']);reg=[x for x in a if x['s']==1]
        if len(a)<24 or not reg:continue
        if prev_close is None:prev_close=reg[-1]['c'];continue
        day_open=reg[0]['o'];session_hi=max(x['h'] for x in a);session_gain=ret(session_hi,prev_close)
        first20=next((x['t'] for x in a if x['h']>=prev_close*1.20),None);first50=next((x['t'] for x in a if x['h']>=prev_close*1.50),None)
        cum=0.;pvnum=0.;pvden=0.;dayrows=[]
        for i,z in enumerate(a):
            unique.add((sym,z['t']));cum+=z['v'];typ=(z['h']+z['l']+z['c'])/3;pvnum+=typ*z['v'];pvden+=z['v']
            if i<12:continue
            c=z['c'];move=ret(c,prev_close);gap=ret(day_open,prev_close)
            if not (.15<=c<=30) or not (-20<=move<8.0) or c*cum<25000:continue
            p=a[:i+1]
            def ago(k):return p[max(0,len(p)-1-k)]['c']
            r5,r10,r15,r30,r60=[ret(c,ago(k)) for k in (1,2,3,6,12)]
            rvb=z['v']/medpos(slotv[z['slot']][-20:],z['v'] or 1);rvc=cum/medpos(slotc[z['slot']][-20:],cum or 1)
            recent=p[-13:];cl=np.asarray([x['c'] for x in recent],float);compression=(max(cl)/min(cl)-1)*100 if len(cl)>1 and min(cl)>0 else 0;lr=np.diff(np.log(np.maximum(cl,1e-9)));volat=float(np.std(lr)*100) if len(lr)>1 else 0
            last=p[-7:];hi=max(x['h'] for x in last);lo=min(x['l'] for x in last);closepos=(c-lo)/(hi-lo) if hi>lo else .5;vwap=pvnum/pvden if pvden else c;vwapd=ret(c,vwap);pd=prior[-1] if prior else {'range':0.,'volume':cum}
            feat=[r5,r10,r15,r30,r60,r5-r10/2,r10-r30/3,move/20,gap/20,math.log1p(z['v']),math.log1p(cum),math.log1p(max(0,c*cum)),math.log1p(max(0,rvb)),math.log1p(max(0,rvc)),compression/10,volat/10,closepos,vwapd/10,pd['range']/20,math.log1p(max(0,pd['volume']))/20,(z['dt'].hour*60+z['dt'].minute)/1440,float(z['s']==0),float(z['s']==1),float(z['s']==2)]
            future=a[i+1:]
            same_session=[x for x in future if x['s']==z['s']]
            if not same_session:continue
            rem_mfe=ret(max(x['h'] for x in same_session),c);rem_mae=ret(min(x['l'] for x in same_session),c)
            peak=max(same_session,key=lambda x:x['h']);time_peak=(peak['t']-z['t'])/60
            def hit(pct,maxmin=120):
                for zz in future:
                    dm=(zz['t']-z['t'])/60
                    if dm>maxmin:break
                    if zz['h']>=c*(1+pct/100):return zz['t'],dm
                return None,None
            h10,l10=hit(10,120);h15,l15=hit(15,150);h20,l20=hit(20,180)
            if h10:
                pre=[x for x in future if x['t']<=h10];mae10=ret(min(x['l'] for x in pre),c) if pre else 0.
            else:mae10=ret(min((x['l'] for x in future if (x['t']-z['t'])/60<=120),default=c),c)
            action10=bool(l10 is not None and 15<=l10<=90 and mae10>=-5)
            prime15=bool(l15 is not None and 15<=l15<=120 and mae10>=-5)
            too_fast=bool(l10 is not None and l10<15)
            ignition=(rvb>=1.4 or rvc>=1.4 or r10>=1.2 or r5>=.8 or (closepos>=.70 and vwapd>=0))
            hardneg=bool((not action10) and (ignition or too_fast or session_gain>=20))
            quality=max(0.,min(100.,rem_mfe-max(0.,-rem_mae)*1.8))
            row={'symbol':sym,'day':day,'key':sym+'|'+day,'ts':z['t'],'session':z['s'],'feat':feat,'action10':action10,'prime15':prime15,'hardNeg':hardneg,'tooFast':too_fast,'lead10':l10,'lead15':l15,'lead20':l20,'remainingMfePct':rem_mfe,'remainingMaePct':rem_mae,'timeToPeakMin':time_peak,'qualityReturn':quality,'session20':session_gain>=20,'session50':session_gain>=50,'sessionGainPct':session_gain,'rvbar':rvb,'rvcum':rvc,'move':move}
            rows.append(row);dayrows.append(row)
        if session_gain>=20 and first20:
            pre=[x for x in dayrows if x['ts']<first20 and x['move']<8]
            for lead in (120,90,60,45,30,20):
                cand=[x for x in pre if (first20-x['ts'])/60>=10]
                if not cand:continue
                q=min(cand,key=lambda x:abs((first20-x['ts'])/60-lead));actual=(first20-q['ts'])/60
                if abs(actual-lead)<=12:cases.append({**q,'anchorLeadMin':round(actual,1),'eventClass':'PLUS50' if session_gain>=50 else 'PLUS20'})
        cum2=0.
        for z in a:
            cum2+=z['v'];slotv[z['slot']].append(z['v']);slotc[z['slot']].append(cum2);slotv[z['slot']]=slotv[z['slot']][-20:];slotc[z['slot']]=slotc[z['slot']][-20:]
        rr=(max(x['h'] for x in reg)/min(x['l'] for x in reg)-1)*100 if min(x['l'] for x in reg)>0 else 0;prior.append({'range':rr,'volume':sum(x['v'] for x in reg)});prior=prior[-20:];prev_close=reg[-1]['c']

dates=sorted({x['day'] for x in rows});ia=max(1,int(.70*len(dates)));ib=max(ia+1,int(.85*len(dates)));td=set(dates[:ia]);cd=set(dates[ia:ib]);hd=set(dates[ib:])
train=[x for x in rows if x['day'] in td];cal=[x for x in rows if x['day'] in cd];hold=[x for x in rows if x['day'] in hd];train_cases=[x for x in cases if x['day'] in td]

def subset(rr,target,seed):
    pos=[x for x in rr if x[target]];hard=[x for x in rr if not x[target] and x['hardNeg']];easy=[x for x in rr if not x[target] and not x['hardNeg']];rnd=random.Random(seed);rnd.shuffle(hard);rnd.shuffle(easy)
    return pos+hard[:min(len(hard),max(5000,len(pos)*5))]+easy[:min(len(easy),max(3500,len(pos)*3))]
def fit_cls(rr,target,seed):
    u=subset(rr,target,seed);X=np.asarray([x['feat'] for x in u],float);y=np.asarray([int(x[target]) for x in u],int)
    if len(y)==0 or len(np.unique(y))<2:return {'constant':float(y[0]) if len(y) else 0.,'n':len(y),'p':int(y.sum()) if len(y) else 0}
    cnt=Counter(x['key'] for x in u);ew=np.asarray([1/max(1,cnt[x['key']]) for x in u]);hw=np.asarray([2.1 if (not x[target] and x['hardNeg']) else 1. for x in u]);sc=StandardScaler().fit(X);Xs=sc.transform(X);pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);w=ew*hw*np.where(y==1,min(80,neg/pos),1)
    et=ExtraTreesClassifier(n_estimators=360,max_depth=13,min_samples_leaf=7,max_features=.72,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=ew*hw)
    hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=19,learning_rate=.04,l2_regularization=12,min_samples_leaf=28,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=900,C=.08,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=ew*hw)
    return {'sc':sc,'et':et,'hg':hg,'lr':lr,'n':len(y),'p':int(y.sum())}
def clsprob(m,rr):
    if 'constant' in m:return np.full(len(rr),m['constant']),np.zeros(len(rr))
    X=np.asarray([x['feat'] for x in rr],float);Xs=m['sc'].transform(X);ps=np.vstack([m['et'].predict_proba(X)[:,1],m['hg'].predict_proba(X)[:,1],m['lr'].predict_proba(Xs)[:,1]])
    return .44*ps[0]+.41*ps[1]+.15*ps[2],np.std(ps,axis=0)
def fit_reg(rr,target,seed):
    X=np.asarray([x['feat'] for x in rr],float);y=np.asarray([max(-15,min(80,float(x[target]))) for x in rr],float);cnt=Counter(x['key'] for x in rr);w=np.asarray([1/max(1,cnt[x['key']]) for x in rr])
    et=ExtraTreesRegressor(n_estimators=300,max_depth=14,min_samples_leaf=8,max_features=.72,n_jobs=-1,random_state=seed).fit(X,y,sample_weight=w)
    hg=HistGradientBoostingRegressor(max_iter=220,max_leaf_nodes=19,learning_rate=.04,l2_regularization=10,min_samples_leaf=30,random_state=seed+1).fit(X,y,sample_weight=w)
    return et,hg
def regpred(m,rr):
    if not rr:return np.zeros(0)
    X=np.asarray([x['feat'] for x in rr],float);return .55*m[0].predict(X)+.45*m[1].predict(X)
def fit_arch(c):
    if len(c)<30:return None
    X=np.asarray([x['feat'] for x in c],float);sc=StandardScaler().fit(X);Xs=sc.transform(X);k=min(10,max(3,len(c)//70));km=MiniBatchKMeans(n_clusters=k,random_state=5661,batch_size=512,n_init=10,max_iter=300).fit(Xs);dist=np.min(km.transform(Xs),axis=1);return sc,km,max(float(np.median(dist)),1e-6)

m10=fit_cls(train,'action10',5610);m15=fit_cls(train,'prime15',5630);mret=fit_reg(train,'remainingMfePct',5650);arch=fit_arch(train_cases)
def enrich(rr):
    p10,dis=clsprob(m10,rr);p15,_=clsprob(m15,rr);pred=regpred(mret,rr)
    if arch and rr:
        X=np.asarray([x['feat'] for x in rr],float);d=np.min(arch[1].transform(arch[0].transform(X)),axis=1);sim=np.exp(-d/arch[2])
    else:sim=np.zeros(len(rr))
    out=[]
    for x,a,b,c,d,s in zip(rr,p10,p15,pred,dis,sim):
        upside=max(0.,min(60.,float(c)));score=(a**1.25)*(1+min(upside,40)/25)*(0.78+0.22*b)*(0.88+0.12*s)*max(.45,1-min(.45,d))
        out.append({**x,'pAction10':float(a),'pPrime15':float(b),'predRemainingMfePct':float(c),'disagreement':float(d),'archetypeSimilarity':float(s),'opportunityScore':float(score)})
    return out

def episode_select(xs,cfg):
    score_t,p_t,ret_t,dis_t,sim_t,sessions=cfg;eligible=[x for x in xs if x['opportunityScore']>=score_t and x['pAction10']>=p_t and x['predRemainingMfePct']>=ret_t and x['disagreement']<=dis_t and x['archetypeSimilarity']>=sim_t and x['session'] in sessions]
    by=defaultdict(list)
    for x in eligible:by[x['key']].append(x)
    out=[]
    for k,g in by.items():
        chosen=[]
        for x in sorted(g,key=lambda z:z['ts']):
            if len(chosen)>=MAX_ALERTS_PER_TICKER_DAY:break
            if not chosen:chosen.append(x);continue
            mins=(x['ts']-chosen[-1]['ts'])/60
            improved=x['opportunityScore']>=chosen[-1]['opportunityScore']*1.18
            if mins>=COOLDOWN_MIN and improved:chosen.append(x)
        out.extend(chosen)
    return sorted(out,key=lambda z:z['ts'])
def stats(sel,u):
    n=len(sel);tp=sum(x['action10'] for x in sel);leads=[x['lead10'] for x in sel if x['action10'] and x['lead10'] is not None];rm=[x['remainingMfePct'] for x in sel];ma=[x['remainingMaePct'] for x in sel];wins={x['key'] for x in u if x['action10']};hit={x['key'] for x in sel if x['action10']}
    daily=defaultdict(list)
    for x in sel:daily[x['day']].append(x)
    top1=[max(g,key=lambda z:z['opportunityScore'])['remainingMfePct'] for g in daily.values() if g]
    top3=[]
    for g in daily.values():top3.extend([x['remainingMfePct'] for x in sorted(g,key=lambda z:z['opportunityScore'],reverse=True)[:3]])
    return {'count':n,'tpAction10':tp,'precisionAction10Pct':round(tp/n*100,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'tickerDayRecallPct':round(len(hit)/len(wins)*100,2) if wins else None,'medianLeadMin':round(float(np.median(leads)),1) if leads else None,'medianRemainingMfePct':round(float(np.median(rm)),2) if rm else None,'meanRemainingMfePct':round(float(np.mean(rm)),2) if rm else None,'medianRemainingMaePct':round(float(np.median(ma)),2) if ma else None,'plus20RatePct':round(sum(x['session20'] for x in sel)/n*100,2) if n else None,'plus50RatePct':round(sum(x['session50'] for x in sel)/n*100,2) if n else None,'alertsPerDay':round(n/max(1,len(daily)),2),'activeDays':len(daily),'sessionCounts':{'pre':sum(x['session']==0 for x in sel),'regular':sum(x['session']==1 for x in sel),'after':sum(x['session']==2 for x in sel)},'top1DailyMedianRemainingMfePct':round(float(np.median(top1)),2) if top1 else None,'top3MedianRemainingMfePct':round(float(np.median(top3)),2) if top3 else None}

cp=enrich(cal);configs=[]
S=np.asarray([x['opportunityScore'] for x in cp]);P=np.asarray([x['pAction10'] for x in cp]);R=np.asarray([x['predRemainingMfePct'] for x in cp]);A=np.asarray([x['archetypeSimilarity'] for x in cp])
sg=sorted(set([round(float(np.quantile(S,q)),4) for q in (.75,.82,.88,.92,.95,.97)]));pg=sorted(set([.35,.5,.65]+[round(float(np.quantile(P,q)),4) for q in (.80,.90,.95)]));rg=sorted(set([5.,8.,12.,16.]+[round(float(np.quantile(R,q)),2) for q in (.65,.80,.90)]));ag=sorted(set([0.,.15,.30]+[round(float(np.quantile(A,q)),4) for q in (.25,.50)]))
for st in sg:
  for pt in pg:
    for rt in rg:
      for dt in (.12,.20,.30):
        for at in ag:
          for ss in ((0,1),(1,),(0,1,2)):
            cfg=(st,pt,rt,dt,at,ss);z=stats(episode_select(cp,cfg),cp);n=z['count'];p=z['precisionAction10Pct'] or 0;lo=z['wilsonLower90Pct'] or 0;rem=z['medianRemainingMfePct'] or 0;top=z['top1DailyMedianRemainingMfePct'] or 0;rec=z['tickerDayRecallPct'] or 0
            utility=lo*35+p*8+rem*30+top*18+rec*4+min(n,120)*1.5
            if n<25:utility-=4000
            if p<20:utility-=1500
            configs.append((utility,cfg,z))
configs.sort(key=lambda x:x[0],reverse=True);_,cfg,cm=configs[0];hp=enrich(hold);hs=stats(episode_select(hp,cfg),hp)

def library(c):
    if not arch or not c:return {'status':'INSUFFICIENT','caseCount':len(c),'clusters':[]}
    X=np.asarray([x['feat'] for x in c]);lab=arch[1].predict(arch[0].transform(X));clusters=[]
    for k in range(arch[1].n_clusters):
        g=[x for x,l in zip(c,lab) if int(l)==k]
        if not g:continue
        F=np.asarray([x['feat'] for x in g]);clusters.append({'cluster':k,'count':len(g),'tickerDays':len({x['key'] for x in g}),'plus50RatePct':round(sum(x['session50'] for x in g)/len(g)*100,2),'medianSessionGainPct':round(float(np.median([x['sessionGainPct'] for x in g])),2),'medianAnchorLeadMin':round(float(np.median([x['anchorLeadMin'] for x in g])),1),'medianFeatures':{n:round(float(np.median(F[:,i])),4) for i,n in enumerate(FEATURES)},'exemplars':[{'symbol':x['symbol'],'day':x['day'],'leadMin':x['anchorLeadMin'],'sessionGainPct':round(x['sessionGainPct'],2)} for x in sorted(g,key=lambda z:z['sessionGainPct'],reverse=True)[:8]]})
    clusters.sort(key=lambda x:(x['plus50RatePct'],x['medianSessionGainPct']),reverse=True);return {'status':'COMPLETE','caseCount':len(c),'clusters':clusters}

augmentation={'used':False,'provider':None,'bars':0,'days':0,'plus20Sessions':0,'plus50Sessions':0}
if len(unique)<MIN_POOL:
    augmentation['used']=True;augmentation['provider']='Yahoo 60m 730d open-history archive';hourly={}
    with ThreadPoolExecutor(max_workers=8) as ex:
        fs=[ex.submit(fetch,s,'730d','60m',False,3) for s in symbols[:400]]
        for f in as_completed(fs):
            s,b,e=f.result()
            if b:hourly[s]=b
    ds=set();p20=p50=bc=0
    for s,b in hourly.items():
        bc+=len(b);by=defaultdict(list)
        for z in b:by[datetime.fromtimestamp(z['t'],timezone.utc).astimezone(NY).date().isoformat()].append(z)
        prev=None
        for d in sorted(by):
            arr=by[d];ds.add(d)
            if prev is not None:
                g=ret(max(x['h'] for x in arr),prev);p20+=g>=20;p50+=g>=50
            prev=arr[-1]['c']
    augmentation.update({'bars':bc,'days':len(ds),'plus20Sessions':int(p20),'plus50Sessions':int(p50)})

b50=readj(BASE50,{});b53=readj(BASE53,{})
report={'schemaVersion':'5.6-session-opportunity-hunter','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'COMPLETE' if rows and cal and hold else 'INSUFFICIENT','policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','objective':{'primary':'alert before actionable +10% move with 15-90 minute runway','secondary':'rank by expected remaining same-session upside','coverage':'pre-market + regular + after-hours','repeatPolicy':f'up to {MAX_ALERTS_PER_TICKER_DAY} opportunity episodes per ticker/day; {COOLDOWN_MIN}m cooldown and >=18% score improvement','notSuccess':'move occurring in <15m is too late for the primary actionable label'},'architecture':'ACTIONABILITY CLASSIFIER + PRIME MOVE CLASSIFIER + REMAINING-UPSIDΕ REGRESSOR + EXPLOSION ARCHETYPE SIMILARITY + ABSTENTION','data':{'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),'unique5mObservations':len(unique),'decisionRows':len(rows),'tickerDays':len({x['key'] for x in rows}),'days':len(dates),'explosionCases':len(cases),'met500kObservationGoal':len(unique)>=MIN_POOL,'augmentation':augmentation},'splits':{'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd),'trainAction10':sum(x['action10'] for x in train),'calAction10':sum(x['action10'] for x in cal),'holdAction10':sum(x['action10'] for x in hold)},'selectedConfig':{'minOpportunityScore':cfg[0],'minPAction10':cfg[1],'minPredRemainingMfePct':cfg[2],'maxDisagreement':cfg[3],'minArchetypeSimilarity':cfg[4],'sessions':list(cfg[5])},'calibration':cm,'holdout':hs,'baselines':{'v50HoldoutPrecisionPct':(b50.get('holdout') or {}).get('precisionPct'),'v53HoldoutPrecisionPct':(b53.get('holdout') or {}).get('precision10Pct')},'successCriteria':{'precisionIsNotOnlyObjective':True,'mustHaveActionableRunway':True,'mustPreserveRepeatedSessionOpportunities':True,'mustImproveRemainingUpsideCapture':True},'antiLeakage':['features use current/prior completed bars only','previous regular close anchors session move','future highs/lows/times are labels only','same-time RVOL baseline uses prior days only','chronological 70/15/15 date split','models and archetypes fit on train only','thresholds selected on calibration only','untouched holdout evaluated after freeze','current discovery universe broadens symbols but is not treated as historical point-in-time membership'],'verdict':'V56_RESEARCH_COMPLETE','errorsSample':dict(list(errors.items())[:20])}
lib={'schemaVersion':'5.6-explosion-case-library','generatedAtUTC':report['generatedAtUTC'],'source':'Yahoo 5m causal precursor anchors','observationPool':len(unique),'trainingPeriodDays':len(td),'definition':'precursor anchors 20-120m before first +20 crossing; +50 retained as subtype','featureNames':FEATURES,'library':library(train_cases),'augmentation':augmentation,'policy':'TRAIN_ONLY_ARCHETYPES_NO_HOLDOUT_LEAKAGE'}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');LIB.write_text(json.dumps(lib,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))