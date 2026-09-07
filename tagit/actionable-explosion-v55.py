#!/usr/bin/env python3
"""TAGit v5.5 actionable explosion learner.

Design goals:
1) Separate "explosive ticker-day propensity" from "actionable timing".
2) Define a BUY-DECISION runway: +10% future move must first occur 15-75 minutes
   after the observation, with <=5% adverse excursion before the hit.
3) Treat too-fast (<15m), too-late/already-moved, and false-ignition states as hard negatives.
4) Build an event-level archetype library for +20%/+50% sessions from causal precursors.
5) Optimize calibration ONLY for actionable precision; +20/+50 hit rates are diagnostics,
   never rewards in threshold selection.
6) Freeze train models/config and evaluate untouched chronological holdout without refitting.
7) Analyze >=500k unique symbol/timestamp observations when available. If 5m history does
   not reach that pool, augment the case archive with open Yahoo 60m/730d history without
   mixing incompatible granularity into the 5m timing model.
"""
import json, math, pathlib, random, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

FROZEN = pathlib.Path("tag/data/tagit-v39-frozen-groundtruth.json")
DISCOVERY = pathlib.Path("tag/data/discovery.json")
BASE50 = pathlib.Path("tag/data/tagit-v50-external-history.json")
BASE53 = pathlib.Path("tag/data/tagit-v53-session-explosion.json")
OUT = pathlib.Path("tag/data/tagit-v55-actionable-explosion.json")
LIB = pathlib.Path("tag/data/tagit-v55-case-library.json")

NY = ZoneInfo("America/New_York")
UA = {"User-Agent": "Mozilla/5.0 TAGit-v5.5-actionable-research"}
MAX_SYMBOLS = 600
MIN_OBSERVATION_POOL = 500_000

def read_json(p, d):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return d

frozen = read_json(FROZEN, {"data":[]})
hist_freq = Counter(str(x.get("ticker") or "").upper() for x in frozen.get("data",[]) if x.get("ticker"))
hist_symbols = [s for s,_ in hist_freq.most_common(350)]
disc = read_json(DISCOVERY, {"rows":[]})
disc_rows = disc.get("rows") or []
disc_symbols = []
for r in sorted(disc_rows, key=lambda x: (0 if "nano_low_float" in (x.get("_discoveryLanes") or []) else 1)):
    s = str(r.get("Ticker") or r.get("Symbol") or "").upper().strip()
    if s and s not in disc_symbols:
        disc_symbols.append(s)
symbols = []
for s in hist_symbols + disc_symbols:
    if s and s not in symbols:
        symbols.append(s)
    if len(symbols) >= MAX_SYMBOLS:
        break

def fetch_chart(sym, rng="60d", interval="5m", prepost=True, retries=4):
    q = urllib.parse.quote(sym, safe="")
    pp = "true" if prepost else "false"
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{q}?range={rng}&interval={interval}&includePrePost={pp}&events=div%2Csplits"
    err = None
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=24) as r:
                d = json.loads(r.read().decode())
            z = ((d.get("chart") or {}).get("result") or [None])[0]
            if not z:
                return sym, [], "NO_RESULT"
            ts = z.get("timestamp") or []
            qq = ((z.get("indicators") or {}).get("quote") or [{}])[0]
            O=qq.get("open") or []; H=qq.get("high") or []; L=qq.get("low") or []; C=qq.get("close") or []; V=qq.get("volume") or []
            out = []
            for i,t in enumerate(ts):
                if i >= len(C) or C[i] is None:
                    continue
                c=float(C[i]); o=float(O[i] if i<len(O) and O[i] is not None else c)
                h=float(H[i] if i<len(H) and H[i] is not None else c)
                l=float(L[i] if i<len(L) and L[i] is not None else c)
                v=float(V[i] if i<len(V) and V[i] is not None else 0)
                if c > 0:
                    out.append({"t":int(t),"o":o,"h":h,"l":l,"c":c,"v":max(0.,v)})
            return sym, out, None
        except Exception as e:
            err=f"{type(e).__name__}:{e}"
            time.sleep(.55*(k+1))
    return sym, [], err

raw = {}; errors = {}
with ThreadPoolExecutor(max_workers=10) as ex:
    fs = [ex.submit(fetch_chart, s) for s in symbols]
    for f in as_completed(fs):
        s,b,e = f.result(); raw[s] = b
        if e or not b: errors[s] = e or "EMPTY"

def ret(a,b): return (a/b-1)*100 if a and b else 0.0
def session(dt):
    m=dt.hour*60+dt.minute
    if 240 <= m < 570: return 0
    if 570 <= m < 960: return 1
    if 960 <= m < 1200: return 2
    return 3
def slot(dt): return (dt.hour*60+dt.minute-240)//5
def safe_med(vals, default):
    m=float(np.median(vals)) if vals else float(default)
    return m if m > 1e-9 else max(float(default),1e-9)
def first_cross_time(a, prev_close, pct):
    level=prev_close*(1+pct/100)
    for z in a:
        if z["h"] >= level: return z["t"]
    return None

FEATURE_NAMES = ["r5","r10","r15","r30","r60","acc5v10","acc10v30","movePrevClose","gap","logBarVol","logCumVol","logDollarVol","logRVOLbar","logRVOLcum","compression","volatility","closePosition","vwapDistance","priorDayRange","logPriorDayVolume","timeOfDay","isPre","isRegular","isAfter"]
rows=[]; emergence=[]; explosion_cases=[]; unique_observations=set()
for sym,bars in raw.items():
    by=defaultdict(list)
    for z in bars:
        dt=datetime.fromtimestamp(z["t"],timezone.utc).astimezone(NY); s=session(dt)
        if s < 3: by[dt.date().isoformat()].append({**z,"dt":dt,"s":s,"slot":slot(dt)})
    slot_vol=defaultdict(list); slot_cum=defaultdict(list); prev_close=None; prior_daily=[]
    for day in sorted(by):
        a=sorted(by[day],key=lambda z:z["t"]); reg=[z for z in a if z["s"]==1]
        if len(a)<24 or not reg: continue
        if prev_close is None:
            prev_close=reg[-1]["c"]; continue
        day_open=reg[0]["o"]; sess_hi=max(z["h"] for z in a); sess_gain=ret(sess_hi,prev_close)
        is20=sess_gain>=20; is50=sess_gain>=50; t20=first_cross_time(a,prev_close,20); t50=first_cross_time(a,prev_close,50)
        cum=0.; pvnum=0.; pvden=0.; day_rows=[]
        for i,z in enumerate(a):
            unique_observations.add((sym,z["t"])); cum += z["v"]
            typ=(z["h"]+z["l"]+z["c"])/3; pvnum += typ*z["v"]; pvden += z["v"]
            if i < 12 or i % 2: continue
            c=z["c"]; move=ret(c,prev_close); gap=ret(day_open,prev_close)
            if not (.15 <= c <= 30) or not (-18 <= move < 7.0) or c*cum < 25_000: continue
            p=a[:i+1]
            def ago(k): return p[max(0,len(p)-1-k)]["c"]
            r5,r10,r15,r30,r60=[ret(c,ago(k)) for k in (1,2,3,6,12)]
            rvbar=z["v"]/safe_med(slot_vol[z["slot"]][-20:],z["v"] or 1); rvcum=cum/safe_med(slot_cum[z["slot"]][-20:],cum or 1)
            recent=p[-13:]; cl=np.asarray([x["c"] for x in recent],float); compression=(max(cl)/min(cl)-1)*100 if len(cl)>1 and min(cl)>0 else 0
            logr=np.diff(np.log(np.maximum(cl,1e-9))); volat=float(np.std(logr)*100) if len(logr)>1 else 0
            last=p[-7:]; hi=max(x["h"] for x in last); lo=min(x["l"] for x in last); closepos=(c-lo)/(hi-lo) if hi>lo else .5
            vwap=pvnum/pvden if pvden else c; vwapd=ret(c,vwap); acc=r5-r10/2; longacc=r10-r30/3
            pd=prior_daily[-1] if prior_daily else {"range":0.,"volume":cum}
            feat=[r5,r10,r15,r30,r60,acc,longacc,move/20,gap/20,math.log1p(z["v"]),math.log1p(cum),math.log1p(max(0,c*cum)),math.log1p(max(0,rvbar)),math.log1p(max(0,rvcum)),compression/10,volat/10,closepos,vwapd/10,pd["range"]/20,math.log1p(max(0,pd["volume"]))/20,(z["dt"].hour*60+z["dt"].minute)/1440,float(z["s"]==0),float(z["s"]==1),float(z["s"]==2)]
            hit_t=None; mae_to_hit=0.; mfe10=0.
            for zz in a[i+1:]:
                dm=(zz["t"]-z["t"])/60
                if dm > 90: break
                if dm <= 10: mfe10=max(mfe10,ret(zz["h"],c))
                if hit_t is None and zz["h"] >= c*1.10:
                    hit_t=zz["t"]; break
            if hit_t is not None:
                prehit=[zz for zz in a[i+1:] if zz["t"]<=hit_t]; mae_to_hit=ret(min(zz["l"] for zz in prehit),c) if prehit else 0.; lead=(hit_t-z["t"])/60
            else:
                horizon=[zz for zz in a[i+1:] if 0 < (zz["t"]-z["t"])/60 <= 90]; mae_to_hit=ret(min((zz["l"] for zz in horizon),default=c),c); lead=None
            actionable=bool(hit_t is not None and 15 <= lead <= 75 and mae_to_hit >= -5 and mfe10 < 6); too_fast=bool(hit_t is not None and lead < 15)
            ignition=(rvbar>=1.5 or rvcum>=1.5 or r10>=1.5 or r5>=1.0 or (closepos>=.72 and vwapd>=0)); hard_neg=bool((not actionable) and (ignition or too_fast or is20 or is50))
            lead20=(t20-z["t"])/60 if t20 and t20>z["t"] else None; lead50=(t50-z["t"])/60 if t50 and t50>z["t"] else None
            row={"symbol":sym,"day":day,"key":sym+"|"+day,"ts":z["t"],"session":z["s"],"feat":feat,"actionable10":actionable,"tooFast10":too_fast,"hardNeg":hard_neg,"session20":is20,"session50":is50,"sessionGainPct":sess_gain,"lead10Min":lead,"lead20Min":lead20,"lead50Min":lead50,"maeToHitPct":mae_to_hit,"rvbar":rvbar,"rvcum":rvcum,"move":move,"emergence":ignition and move<5.5}
            rows.append(row); day_rows.append(row)
        er=next((x for x in sorted(day_rows,key=lambda q:q["ts"]) if x["emergence"]),None)
        if er is None and day_rows: er=sorted(day_rows,key=lambda q:q["ts"])[0]
        if er is not None: emergence.append({**er,"prop20":is20,"prop50":is50})
        if is20 and t20:
            eligible=[x for x in day_rows if x["ts"]<t20 and x["move"]<7]
            for target_lead in (120,90,60,45,30,15):
                cand=[x for x in eligible if x["lead20Min"] is not None]
                if not cand: continue
                q=min(cand,key=lambda x:abs(x["lead20Min"]-target_lead))
                if abs(q["lead20Min"]-target_lead) <= 12: explosion_cases.append({**q,"anchorLeadTargetMin":target_lead,"eventClass":"PLUS50" if is50 else "PLUS20"})
        cum2=0.
        for z in a:
            cum2+=z["v"]; slot_vol[z["slot"]].append(z["v"]); slot_cum[z["slot"]].append(cum2); slot_vol[z["slot"]]=slot_vol[z["slot"]][-20:]; slot_cum[z["slot"]]=slot_cum[z["slot"]][-20:]
        rr=(max(z["h"] for z in reg)/min(z["l"] for z in reg)-1)*100 if min(z["l"] for z in reg)>0 else 0
        prior_daily.append({"range":rr,"volume":sum(z["v"] for z in reg)}); prior_daily=prior_daily[-20:]; prev_close=reg[-1]["c"]

dates=sorted({x["day"] for x in rows}); ia=max(1,int(.70*len(dates))); ib=max(ia+1,int(.85*len(dates))); td=set(dates[:ia]); cd=set(dates[ia:ib]); hd=set(dates[ib:])
train=[x for x in rows if x["day"] in td]; cal=[x for x in rows if x["day"] in cd]; hold=[x for x in rows if x["day"] in hd]; train_em=[x for x in emergence if x["day"] in td]; train_cases=[x for x in explosion_cases if x["day"] in td]

def balanced_subset(rr,target,seed,neg_ratio=8):
    pos=[x for x in rr if x[target]]; hard=[x for x in rr if not x[target] and x.get("hardNeg")]; easy=[x for x in rr if not x[target] and not x.get("hardNeg")]
    rnd=random.Random(seed); rnd.shuffle(hard); rnd.shuffle(easy); hcap=min(len(hard),max(len(pos)*5,4000)); ecap=min(len(easy),max(len(pos)*max(1,neg_ratio-5),3000)); return pos+hard[:hcap]+easy[:ecap]
def fit_binary(rr,target,seed,balanced=True):
    use=balanced_subset(rr,target,seed) if balanced else rr; X=np.asarray([x["feat"] for x in use],float); y=np.asarray([int(x[target]) for x in use],int)
    if len(y)==0 or len(np.unique(y))<2: return {"constant":float(y[0]) if len(y) else 0.0,"trainCount":len(y),"positiveCount":int(y.sum()) if len(y) else 0}
    cnt=Counter(x["key"] for x in use); ew=np.asarray([1/max(1,cnt[x["key"]]) for x in use],float); hardw=np.asarray([2.2 if (not x[target] and x.get("hardNeg")) else 1.0 for x in use],float)
    sc=StandardScaler().fit(X); Xs=sc.transform(X); pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); classw=np.where(y==1,min(80,neg/pos),1.); w=ew*hardw*classw
    et=ExtraTreesClassifier(n_estimators=420,max_depth=13,min_samples_leaf=7,max_features=.72,class_weight="balanced_subsample",n_jobs=-1,random_state=seed).fit(X,y,sample_weight=ew*hardw)
    hg=HistGradientBoostingClassifier(max_iter=240,max_leaf_nodes=19,learning_rate=.035,l2_regularization=12,min_samples_leaf=28,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1000,C=.07,class_weight="balanced",random_state=seed+2).fit(Xs,y,sample_weight=ew*hardw)
    return {"sc":sc,"et":et,"hg":hg,"lr":lr,"trainCount":len(y),"positiveCount":int(y.sum())}
def probs(m,rr):
    if "constant" in m: return np.full(len(rr),m["constant"],float),np.zeros(len(rr))
    X=np.asarray([x["feat"] for x in rr],float); Xs=m["sc"].transform(X); ps=np.vstack([m["et"].predict_proba(X)[:,1],m["hg"].predict_proba(X)[:,1],m["lr"].predict_proba(Xs)[:,1]]); return .44*ps[0]+.41*ps[1]+.15*ps[2], np.std(ps,axis=0)
def fit_archetypes(cases):
    if len(cases)<24: return None
    X=np.asarray([x["feat"] for x in cases],float); sc=StandardScaler().fit(X); Xs=sc.transform(X); k=min(8,max(3,len(cases)//80)); km=MiniBatchKMeans(n_clusters=k,random_state=5511,batch_size=512,n_init=10,max_iter=300).fit(Xs); dist=np.min(km.transform(Xs),axis=1); return {"sc":sc,"km":km,"scale":max(float(np.median(dist)),1e-6)}
arch=fit_archetypes(train_cases)
def arch_score(rr):
    if arch is None or not rr: return np.zeros(len(rr))
    X=np.asarray([x["feat"] for x in rr],float); d=np.min(arch["km"].transform(arch["sc"].transform(X)),axis=1); return np.exp(-d/arch["scale"])
m20=fit_binary(train_em,"prop20",5520,balanced=False); m50=fit_binary(train_em,"prop50",5540,balanced=False); ma=fit_binary(train,"actionable10",5560,balanced=True)
def enrich(rr):
    pa,da=probs(ma,rr); p20,_=probs(m20,rr); p50,_=probs(m50,rr); sim=arch_score(rr); out=[]
    for x,a,b,c,d,s in zip(rr,pa,p20,p50,da,sim):
        decision=.68*a+.17*b+.08*c+.07*s; out.append({**x,"pAction":float(a),"p20":float(b),"p50":float(c),"disAction":float(d),"archSim":float(s),"decisionScore":float(decision)})
    return out
def first(xs):
    out=[];seen=set()
    for x in sorted(xs,key=lambda z:z["ts"]):
        if x["key"] in seen: continue
        seen.add(x["key"]); out.append(x)
    return out
def wilson(tp,n,z=1.645):
    if n<1:return 0.
    p=tp/n; den=1+z*z/n; return max(0.,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100
def stat(sel, universe):
    n=len(sel); tp=sum(x["actionable10"] for x in sel); wins={x["key"] for x in universe if x["actionable10"]}; hit={x["key"] for x in sel if x["actionable10"]}; leads=[x["lead10Min"] for x in sel if x["actionable10"] and x["lead10Min"] is not None]
    return {"count":n,"tp":tp,"precisionActionablePct":round(tp/n*100,2) if n else None,"wilsonLower90Pct":round(wilson(tp,n),2) if n else None,"winnerTickerDays":len(wins),"capturedWinnerTickerDays":len(hit),"tickerDayRecallPct":round(len(hit)/len(wins)*100,2) if wins else None,"session20RatePct":round(sum(x["session20"] for x in sel)/n*100,2) if n else None,"session50RatePct":round(sum(x["session50"] for x in sel)/n*100,2) if n else None,"tooFastRatePct":round(sum(x["tooFast10"] for x in sel)/n*100,2) if n else None,"medianLeadMin":round(float(np.median(leads)),1) if leads else None,"p25LeadMin":round(float(np.quantile(leads,.25)),1) if leads else None,"p75LeadMin":round(float(np.quantile(leads,.75)),1) if leads else None,"activeDays":len({x["day"] for x in sel})}
def pick(xs,cfg):
    ds,pa,p20,dis,sim,sessions=cfg; return first([x for x in xs if x["decisionScore"]>=ds and x["pAction"]>=pa and x["p20"]>=p20 and x["disAction"]<=dis and x["archSim"]>=sim and x["session"] in sessions])

cp=enrich(cal); configs=[]
dvals=np.asarray([x["decisionScore"] for x in cp],float); avals=np.asarray([x["pAction"] for x in cp],float); svals=np.asarray([x["archSim"] for x in cp],float)
ds_grid=sorted(set([.45,.55,.65,.75,.85]+[round(float(np.quantile(dvals,q)),4) for q in (.80,.88,.92,.95,.97)])); pa_grid=sorted(set([.35,.50,.65,.80]+[round(float(np.quantile(avals,q)),4) for q in (.80,.90,.95)])); sim_grid=sorted(set([0,.20,.40]+[round(float(np.quantile(svals,q)),4) for q in (.25,.50,.75)]))
for ds in ds_grid:
  for pa in pa_grid:
    for p20 in (0,.15,.30):
      for dis in (.10,.18,.28):
        for sim in sim_grid:
          for ss in ((0,1),(1,),(0,1,2)):
            cfg=(ds,pa,p20,dis,sim,ss); z=stat(pick(cp,cfg),cp); n=z["count"]; p=z["precisionActionablePct"] or 0; lo=z["wilsonLower90Pct"] or 0; credible=n>=30
            utility=(1_000_000 if (credible and p>=90) else 0)+lo*100+p*10+(z["tp"]*2)+(z["tickerDayRecallPct"] or 0)
            if n<15: utility-=5000
            configs.append((utility,cfg,z))
configs.sort(key=lambda x:x[0],reverse=True); _,cfg,cm=configs[0]
# Critical v5.3 fix: do NOT refit on train+cal after threshold selection.
hp=enrich(hold); hs=stat(pick(hp,cfg),hp)

def cluster_library(cases):
    if arch is None or not cases: return {"status":"INSUFFICIENT","caseCount":len(cases),"clusters":[]}
    X=np.asarray([x["feat"] for x in cases],float); labels=arch["km"].predict(arch["sc"].transform(X)); clusters=[]
    for k in range(arch["km"].n_clusters):
        g=[x for x,l in zip(cases,labels) if int(l)==k]
        if not g: continue
        F=np.asarray([x["feat"] for x in g],float); clusters.append({"cluster":k,"count":len(g),"tickerDays":len({x["key"] for x in g}),"plus50RatePct":round(sum(x["session50"] for x in g)/len(g)*100,2),"medianLeadTo20Min":round(float(np.median([x["lead20Min"] for x in g if x["lead20Min"] is not None])),1) if any(x["lead20Min"] is not None for x in g) else None,"medianSessionGainPct":round(float(np.median([x["sessionGainPct"] for x in g])),2),"medianFeatures":{n:round(float(np.median(F[:,i])),4) for i,n in enumerate(FEATURE_NAMES)},"exemplars":[{"symbol":x["symbol"],"day":x["day"],"anchorLeadMin":x["anchorLeadTargetMin"],"sessionGainPct":round(x["sessionGainPct"],2)} for x in sorted(g,key=lambda q:q["sessionGainPct"],reverse=True)[:6]]})
    clusters.sort(key=lambda z:(z["plus50RatePct"],z["medianSessionGainPct"]),reverse=True); return {"status":"COMPLETE","caseCount":len(cases),"clusters":clusters}
library=cluster_library(train_cases)
augmentation={"used":False,"provider":None,"bars":0,"days":0,"plus20Sessions":0,"plus50Sessions":0,"reason":None}
if len(unique_observations) < MIN_OBSERVATION_POOL:
    augmentation["used"]=True; augmentation["provider"]="Yahoo chart 60m 730d open history"; augmentation["reason"]="5m unique observation pool below 500k; augmenting case archive only, not 5m timing model"; hourly={}
    with ThreadPoolExecutor(max_workers=8) as ex:
        fs=[ex.submit(fetch_chart,s,"730d","60m",False,3) for s in symbols[:350]]
        for f in as_completed(fs):
            s,b,e=f.result()
            if b: hourly[s]=b
    days_seen=set(); p20=p50=bars_count=0
    for s,bars in hourly.items():
        bars_count+=len(bars); by=defaultdict(list)
        for z in bars:
            dt=datetime.fromtimestamp(z["t"],timezone.utc).astimezone(NY); by[dt.date().isoformat()].append(z)
        prev=None
        for d in sorted(by):
            arr=by[d]
            if not arr: continue
            days_seen.add(d)
            if prev is not None:
                gain=ret(max(x["h"] for x in arr),prev); p20 += gain>=20; p50 += gain>=50
            prev=arr[-1]["c"]
    augmentation.update({"bars":bars_count,"days":len(days_seen),"plus20Sessions":int(p20),"plus50Sessions":int(p50)})

baseline50=read_json(BASE50,{}); baseline53=read_json(BASE53,{}); cal90=(cm["count"]>=30 and (cm["precisionActionablePct"] or 0)>=90); hold90=(hs["count"]>=30 and (hs["precisionActionablePct"] or 0)>=90)
report={"schemaVersion":"5.5-actionable-explosion","generatedAtUTC":datetime.now(timezone.utc).isoformat(),"status":"COMPLETE" if rows and cal and hold else "INSUFFICIENT","policy":"RESEARCH_ONLY_NO_CHAMPION_OVERRIDE","architecture":"EXPLOSION_PROPENSITY + ACTIONABLE_TIMING + ARCHETYPE_SIMILARITY + ABSTENTION","objective":{"primary":"first +10% from current price occurs 15-75m after observation","decisionRunway":"minimum 15 minutes before first +10% hit","riskConstraint":"MAE before hit >= -5%","tooFast":"<15m is a negative, not a success","earlyEligibility":"current move vs previous regular close < +7%"},"data":{"symbolsRequested":len(symbols),"symbolsSucceeded":sum(bool(v) for v in raw.values()),"fetchFailures":len(errors),"unique5mObservations":len(unique_observations),"decisionRows":len(rows),"tickerDays":len({x["key"] for x in rows}),"days":len(dates),"emergenceCases":len(emergence),"explosionAnchorCases":len(explosion_cases),"met500kObservationGoal":len(unique_observations)>=MIN_OBSERVATION_POOL,"augmentation":augmentation},"splits":{"trainRows":len(train),"calibrationRows":len(cal),"holdoutRows":len(hold),"trainDays":len(td),"calibrationDays":len(cd),"holdoutDays":len(hd),"trainActionable":sum(x["actionable10"] for x in train),"calibrationActionable":sum(x["actionable10"] for x in cal),"holdoutActionable":sum(x["actionable10"] for x in hold)},"training":{"timingModelTrainCount":ma.get("trainCount"),"timingModelPositiveCount":ma.get("positiveCount"),"prop20TrainCount":m20.get("trainCount"),"prop20PositiveCount":m20.get("positiveCount"),"prop50TrainCount":m50.get("trainCount"),"prop50PositiveCount":m50.get("positiveCount"),"hardNegativeDefinition":"false ignition, too-fast hit, or explosive-day state outside actionable window","criticalFixes":["session +20/+50 labels no longer drive timing threshold utility","actionable timing has explicit 15-75m lead-time target","too-fast moves are hard negatives","first-emergence ticker-day state trains explosion propensity","event archetypes are anchored before first +20 crossing","holdout uses frozen train-fitted models; no train+cal refit score drift","threshold selection optimizes actionable precision/Wilson support only"]},"selectedConfig":{"decisionScore":cfg[0],"minPAction":cfg[1],"minP20":cfg[2],"maxActionDisagreement":cfg[3],"minArchetypeSimilarity":cfg[4],"sessions":list(cfg[5])},"calibration":cm,"holdout":hs,"baselines":{"v50HoldoutPrecisionPct":(baseline50.get("holdout") or {}).get("precisionPct"),"v53HoldoutPrecisionPct":(baseline53.get("holdout") or {}).get("precision10Pct")},"calibrationReached90":cal90,"holdoutReached90":hold90,"verdict":"V55_90_CONFIRMED" if cal90 and hold90 else "V55_90_NOT_CONFIRMED","antiLeakage":["all model features use current/prior completed bars only","previous regular close is the session reference","future threshold times are labels only","same-time RVOL baselines use prior days only","chronological 70/15/15 date split","archetype clustering fit on train-period precursor cases only","configuration selected on calibration only","train-fitted models frozen for untouched holdout","first selected ticker-day event is the action unit","current discovery universe broadens symbols but is not represented as point-in-time historical membership"],"errorsSample":dict(list(errors.items())[:20])}
lib_report={"schemaVersion":"5.5-explosion-case-library","generatedAtUTC":report["generatedAtUTC"],"source":"Yahoo 5m 60d causal precursor anchors","trainingPeriodDays":len(td),"definition":"+20/+50 session vs previous regular close; precursor anchors 15-120m before first +20 crossing","featureNames":FEATURE_NAMES,"library":library,"augmentation":augmentation,"policy":"TRAIN_ONLY_ARCHETYPES_NO_HOLDOUT_LEAKAGE"}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); LIB.write_text(json.dumps(lib_report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); print(json.dumps(report,ensure_ascii=False,indent=2))
