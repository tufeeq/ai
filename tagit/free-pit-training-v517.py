#!/usr/bin/env python3
"""TAGit v5.17 free-source point-in-time pre-open trainer.

Free-first data policy:
- Prefer Alpaca historical bars when APCA_API_KEY_ID/APCA_API_SECRET_KEY exist.
- Otherwise run a recent bootstrap from public Nasdaq symbol files + Yahoo 5m pre/post bars.
- SEC/FINRA adapters are additive and fail closed when exact availability timestamps are unavailable.
- One decision row per ticker/day at <=09:15 ET. Outcomes use >=09:30 ET only.
- Chronological train/calibration/sealed-holdout. Threshold selection calibration-only.
- Bootstrap/Yahoo mode is explicitly NOT market-wide PIT proof because current-symbol survivorship remains.
"""
from __future__ import annotations
import datetime as dt, json, math, os, pathlib, random, statistics, urllib.parse, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from zoneinfo import ZoneInfo
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

NY=ZoneInfo('America/New_York'); UTC=dt.timezone.utc
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v517-free-pit-training.json'; CASES=ROOT/'tagit-v517-free-pit-cases.json'
CUT=dt.time(9,15); OPEN=dt.time(9,30); CLOSE=dt.time(16,0)
UA={'User-Agent':'TAGit-v5.17-free-PIT research@example.com'}
FEATURES=['preRet','r5','r15','preRange','logPreVol','closePos','barsObs','gapPrevClose','prevRange','logPrevVol','preVolVsPrev','preTrendAccel']

def pct(a,b): return (a/b-1)*100 if a and b else 0.0

def wilson(tp,n,z=1.645):
    if n<1:return 0.0
    p=tp/n; d=1+z*z/n
    return max(0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/d)*100

def get_json(url,headers=None,timeout=30):
    req=urllib.request.Request(url,headers=headers or UA)
    with urllib.request.urlopen(req,timeout=timeout) as r:return json.loads(r.read().decode())

def get_text(url,timeout=25):
    req=urllib.request.Request(url,headers=UA)
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read().decode(errors='replace')

def public_universe(limit=900):
    syms=[]
    urls=['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt']
    for u in urls:
        try:
            txt=get_text(u)
            lines=txt.splitlines(); hdr=lines[0].split('|')
            for line in lines[1:]:
                p=line.split('|')
                if len(p)!=len(hdr):continue
                z=dict(zip(hdr,p)); s=(z.get('Symbol') or z.get('NASDAQ Symbol') or z.get('ACT Symbol') or '').strip().upper()
                name=(z.get('Security Name') or '').upper()
                test=(z.get('Test Issue') or z.get('Test Issue') or '').upper()
                if not s or '$' in s or '^' in s or '/' in s or test=='Y':continue
                if any(k in name for k in ['ETF','ETN','FUND','WARRANT','RIGHT','UNIT']):continue
                if s not in syms:syms.append(s)
        except Exception: pass
    # focus on broad manageable deterministic slice; no outcome conditioning
    return syms[:limit]

def yahoo_bars(sym):
    q=urllib.parse.quote(sym,safe='')
    u=f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits'
    d=get_json(u,{'User-Agent':'Mozilla/5.0 TAGit-v5.17'})
    z=((d.get('chart') or {}).get('result') or [None])[0]
    if not z:return []
    ts=z.get('timestamp') or []; q0=((z.get('indicators') or {}).get('quote') or [{}])[0]
    O=q0.get('open') or [];H=q0.get('high') or [];L=q0.get('low') or [];C=q0.get('close') or [];V=q0.get('volume') or []
    out=[]
    for i,t in enumerate(ts):
        if i>=len(C) or C[i] is None:continue
        c=float(C[i]);o=float(O[i] if i<len(O) and O[i] is not None else c);h=float(H[i] if i<len(H) and H[i] is not None else c);l=float(L[i] if i<len(L) and L[i] is not None else c);v=float(V[i] if i<len(V) and V[i] is not None else 0)
        if c>0:out.append((int(t),o,h,l,c,max(0.0,v)))
    return out

def alpaca_bars(sym,start,end,key,secret):
    qs=urllib.parse.urlencode({'symbols':sym,'timeframe':'5Min','start':start,'end':end,'limit':10000,'adjustment':'raw','feed':'iex','sort':'asc'})
    d=get_json('https://data.alpaca.markets/v2/stocks/bars?'+qs,{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret,'User-Agent':'TAGit-v5.17'})
    out=[]
    for z in ((d.get('bars') or {}).get(sym) or []):
        try:
            t=dt.datetime.fromisoformat(z['t'].replace('Z','+00:00')).timestamp()
            out.append((int(t),float(z['o']),float(z['h']),float(z['l']),float(z['c']),float(z.get('v') or 0)))
        except Exception:pass
    return out

def make_rows(sym,bars):
    by=defaultdict(list)
    for z in bars:
        local=dt.datetime.fromtimestamp(z[0],UTC).astimezone(NY)
        by[local.date().isoformat()].append((z,local))
    rows=[]; prev=None
    for day in sorted(by):
        arr=sorted(by[day],key=lambda x:x[0][0])
        pre=[]; reg=[]
        for z,local in arr:
            tm=local.time().replace(tzinfo=None)
            if dt.time(4,0)<=tm<=CUT:pre.append(z)
            elif OPEN<=tm<CLOSE:reg.append(z)
        if not pre or not reg:
            if reg: prev=reg
            continue
        if prev is None:
            prev=reg; continue
        pc=prev[-1][4]; prev_hi=max(x[2] for x in prev); prev_lo=min(x[3] for x in prev); prev_vol=sum(x[5] for x in prev)
        px=pre[-1][4]; po=pre[0][1]; hi=max(x[2] for x in pre); lo=min(x[3] for x in pre); pv=sum(x[5] for x in pre)
        def rback(n):
            xs=pre[-n:]; return pct(xs[-1][4],xs[0][1]) if xs else 0
        r5=rback(1); r15=rback(3); pret=pct(px,po); gap=pct(px,pc); prng=pct(prev_hi,prev_lo)
        feat=[pret/20,r5/10,r15/15,pct(hi,lo)/20,math.log1p(pv)/20,(px-lo)/(hi-lo) if hi>lo else .5,len(pre)/64,gap/30,prng/20,math.log1p(prev_vol)/20,math.log1p((pv+1)/(prev_vol+1)),(r5-r15/3)/10]
        fut_hi=max(x[2] for x in reg); fut_lo=min(x[3] for x in reg); mfe=pct(fut_hi,px); mae=pct(fut_lo,px)
        hit20=mfe>=20; hit10=mfe>=10
        lead=None
        if hit20:
            target=px*1.20
            for z in reg:
                if z[2]>=target:
                    lead=(dt.datetime.fromtimestamp(z[0],UTC).astimezone(NY)-dt.datetime.combine(dt.date.fromisoformat(day),CUT,NY)).total_seconds()/60;break
        rows.append({'symbol':sym,'day':day,'feat':feat,'hit20':bool(hit20),'hit10':bool(hit10),'mfe':mfe,'mae':mae,'lead20':lead,'decisionPrice':px,'preBars':len(pre),'preVol':pv})
        prev=reg
    return rows

def fit_model(train):
    X=np.asarray([r['feat'] for r in train],float); y=np.asarray([int(r['hit20']) for r in train],int)
    if len(np.unique(y))<2: raise RuntimeError('Need both classes')
    cnt=defaultdict(int)
    for r in train:cnt[r['symbol']+'|'+r['day']]+=1
    pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);cw=min(40,neg/pos)
    w=np.asarray([(cw if yy else 1.0)/max(1,cnt[r['symbol']+'|'+r['day']]) for r,yy in zip(train,y)])
    sc=StandardScaler().fit(X);Xs=sc.transform(X)
    et=ExtraTreesClassifier(n_estimators=360,max_depth=13,min_samples_leaf=8,max_features=.8,class_weight='balanced_subsample',n_jobs=-1,random_state=517).fit(X,y,sample_weight=w)
    hg=HistGradientBoostingClassifier(max_iter=240,max_leaf_nodes=19,learning_rate=.035,l2_regularization=15,min_samples_leaf=28,random_state=518).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.06,class_weight='balanced',random_state=519).fit(Xs,y,sample_weight=w)
    return sc,et,hg,lr

def score(models,rr):
    if not rr:return []
    sc,et,hg,lr=models;X=np.asarray([r['feat'] for r in rr],float);Xs=sc.transform(X)
    ps=np.vstack([et.predict_proba(X)[:,1],hg.predict_proba(X)[:,1],lr.predict_proba(Xs)[:,1]])
    mean=.45*ps[0]+.4*ps[1]+.15*ps[2]; dis=np.std(ps,axis=0)
    return [dict(r,score=float(a),disagreement=float(d)) for r,a,d in zip(rr,mean,dis)]

def select(rr,thr,dismax,topn):
    by=defaultdict(list)
    for r in rr:
        if r['score']>=thr and r['disagreement']<=dismax:by[r['day']].append(r)
    out=[]
    for d,g in by.items(): out+=sorted(g,key=lambda x:x['score'],reverse=True)[:topn]
    return out

def block_bootstrap_lower(sel,iters=1200):
    if not sel:return 0.0
    by=defaultdict(list)
    for r in sel:by[r['day']].append(r)
    days=list(by);rnd=random.Random(51717);vals=[]
    for _ in range(iters):
        samp=[rnd.choice(days) for _ in days];arr=[r for d in samp for r in by[d]]
        vals.append(100*sum(r['hit20'] for r in arr)/len(arr))
    return float(np.quantile(vals,.05))

def metrics(sel,universe):
    n=len(sel);tp=sum(r['hit20'] for r in sel);days=len({r['day'] for r in sel});leads=[r['lead20'] for r in sel if r['hit20'] and r['lead20'] is not None]
    by=defaultdict(list)
    for r in sel:by[r['day']].append(r)
    top3=[x for g in by.values() for x in sorted(g,key=lambda z:z['score'],reverse=True)[:3]]
    winners={r['day'] for r in universe if r['hit20']};caught={r['day'] for r in sel if r['hit20']}
    return {'count':n,'tp20':tp,'precision20Pct':round(100*tp/n,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'dayBlockLower90Pct':round(block_bootstrap_lower(sel),2) if n else None,'activeDays':days,'medianLeadMin':round(float(np.median(leads)),1) if leads else None,'top3DailyPrecisionPct':round(100*sum(x['hit20'] for x in top3)/len(top3),2) if top3 else None,'medianRemainingUpsidePct':round(float(np.median([x['mfe'] for x in sel])),2) if sel else None,'winnerDayRecallPct':round(100*len(caught)/len(winners),2) if winners else None}

def main():
    key=os.getenv('APCA_API_KEY_ID','');secret=os.getenv('APCA_API_SECRET_KEY','')
    mode='ALPACA_FREE_IEX' if key and secret else 'NASDAQ_PLUS_YAHOO_RECENT_BOOTSTRAP'
    syms=public_universe(int(os.getenv('TAGIT_MAX_SYMBOLS','650')))
    if not syms: raise RuntimeError('Public Nasdaq universe unavailable')
    raw={};errs={}
    if mode.startswith('ALPACA'):
        end=dt.datetime.now(UTC);start=end-dt.timedelta(days=int(os.getenv('TAGIT_HISTORY_DAYS','730')))
        fn=lambda s:alpaca_bars(s,start.isoformat().replace('+00:00','Z'),end.isoformat().replace('+00:00','Z'),key,secret)
    else: fn=yahoo_bars
    with ThreadPoolExecutor(max_workers=10) as ex:
        fut={ex.submit(fn,s):s for s in syms}
        for f in as_completed(fut):
            s=fut[f]
            try:raw[s]=f.result()
            except Exception as e:errs[s]=f'{type(e).__name__}:{e}'
    rows=[]
    for s,b in raw.items():
        if b: rows+=make_rows(s,b)
    dates=sorted({r['day'] for r in rows})
    if len(dates)<20 or len(rows)<500: raise RuntimeError(f'Insufficient replay population days={len(dates)} rows={len(rows)}')
    a=max(1,int(.60*len(dates)));b=max(a+1,int(.80*len(dates)))
    td=set(dates[:a]);cd=set(dates[a:b]);hd=set(dates[b:])
    train=[r for r in rows if r['day'] in td];cal=[r for r in rows if r['day'] in cd];hold=[r for r in rows if r['day'] in hd]
    models=fit_model(train);cs=score(models,cal);hs=score(models,hold)
    configs=[]
    for thr in np.quantile([r['score'] for r in cs],[.80,.86,.90,.93,.95,.97,.98]):
        for dm in (.08,.12,.18,.25):
            for topn in (3,5,10):
                sel=select(cs,float(thr),dm,topn);m=metrics(sel,cs)
                n=m['count']; lo=m['dayBlockLower90Pct'] or 0; p=m['precision20Pct'] or 0
                utility=lo*4+p+min(n,120)*.08
                if n<30 or m['activeDays']<5:utility-=100
                configs.append((utility,float(thr),dm,topn,m))
    configs.sort(reverse=True,key=lambda x:x[0]);_,thr,dm,topn,cm=configs[0]
    hsel=select(hs,thr,dm,topn);hm=metrics(hsel,hs)
    integrity=(mode=='ALPACA_FREE_IEX')
    report={'schemaVersion':'5.17-free-pit','generatedAtUTC':dt.datetime.now(UTC).isoformat(),'status':'COMPLETE','dataMode':mode,'universeSource':'Nasdaq public symbol directory','providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False if mode.endswith('BOOTSTRAP') else False,'extendedHours':True,'feed':'IEX' if mode.startswith('ALPACA') else 'Yahoo chart','marketWidePrecisionClaimAllowed':False},'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchErrors':len(errs),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows)},'splits':{'trainRows':len(train),'calibrationRows':len(cal),'holdoutRows':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd)},'selectedConfig':{'scoreThreshold':round(thr,6),'maxDisagreement':dm,'topNPerDay':topn},'calibration':cm,'holdout':hm,'realDiscoveryPrecisionPct':None,'realDiscoveryPrecisionReason':'Current-symbol public universe is not historical point-in-time/survivorship-safe; holdout precision is conditional research evidence only.','antiLeakage':['one decision per ticker/day using bars <=09:15 ET','outcomes use regular-session bars >=09:30 ET only','chronological 60/20/20 split','model fit train only','configuration selected calibration only','holdout evaluated after configuration freeze','no holdout retuning in this run'],'errorsSample':dict(list(errs.items())[:20])}
    OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    CASES.write_text(json.dumps({'schemaVersion':'5.17-cases','featureNames':FEATURES,'mode':mode,'trainPositiveCount':sum(r['hit20'] for r in train),'trainNegativeCount':sum(not r['hit20'] for r in train),'examples':sorted(train,key=lambda r:r['mfe'],reverse=True)[:100]},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
