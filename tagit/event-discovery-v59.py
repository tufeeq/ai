#!/usr/bin/env python3
"""TAGit v5.9 independent event-level discovery learner.

Design goals
- Make an ignition EVENT, not a 5-minute bar, the statistical unit.
- Learn on causal information available at the event timestamp only.
- Separate train / calibration / untouched chronological holdout by date.
- Tune thresholds on calibration only; never inspect holdout while selecting.
- Use hard negatives that looked like ignition but failed to produce an actionable move.
- Report first-class independent-event precision plus day-block bootstrap uncertainty.

Primary label
  Event reaches +10% 15-90 minutes after ignition with pre-hit MAE >= -5%.
Secondary labels
  +20% within 120 minutes, +50% during the same session.

This is research-only. A 90% claim is forbidden unless the untouched chronological
holdout has >=100 independent events across >=10 active days, point precision >=90%,
Wilson 90% lower bound >=80%, and day-block bootstrap 90% lower bound >=80%.
Forward confirmation is still required after that.
"""
import json, math, pathlib, random, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT = pathlib.Path('tag/data')
FROZEN = ROOT / 'tagit-v39-frozen-groundtruth.json'
DISCOVERY = ROOT / 'discovery.json'
BASE57 = ROOT / 'tagit-v57-cumulative-opportunities.json'
OUT = ROOT / 'tagit-v59-event-discovery.json'
EVENTS = ROOT / 'tagit-v59-event-sample.json'
NY = ZoneInfo('America/New_York')
UA = {'User-Agent': 'Mozilla/5.0 TAGit-v5.9-event-research'}
MAX_SYMBOLS = 500
EVENT_COOLDOWN_MIN = 45
MIN_CAL_SUPPORT = 60
MIN_CAL_DAYS = 5

FEATURES = [
    'r5','r10','r15','r30','r60','accel5v15','accel10v30',
    'movePrevClose','gap','logBarVol','logCumVol','logDollarVol',
    'logRVOLbar','logRVOLcum','rvAccel','cumRvAccel',
    'compression15','compression60','rangeExpansion','volatility60',
    'closePosition30','vwapDistance','vwapSlope15','distanceDayHigh',
    'priorDayRange','priorDayVolume','timeOfDay','isPre','isRegular','isAfter',
    'triggerBreadth','triggerStrength'
]

def readj(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default

def ret(a, b):
    return (a / b - 1.0) * 100.0 if a and b else 0.0

def session(dt):
    m = dt.hour * 60 + dt.minute
    if 240 <= m < 570: return 0
    if 570 <= m < 960: return 1
    if 960 <= m < 1200: return 2
    return 3

def slot(dt):
    return (dt.hour * 60 + dt.minute - 240) // 5

def safe_median(values, default=1.0):
    if not values:
        return max(float(default), 1e-9)
    v = float(np.median(values))
    return v if v > 1e-9 else max(float(default), 1e-9)

def wilson(tp, n, z=1.645):
    if n < 1: return 0.0
    p = tp / n
    den = 1 + z*z/n
    lo = (p + z*z/(2*n) - z*math.sqrt((p*(1-p) + z*z/(4*n))/n)) / den
    return max(0.0, lo) * 100.0

def day_block_bootstrap_lower(events, seed=5901, reps=2500, q=.10):
    if not events: return 0.0
    by_day = defaultdict(list)
    for x in events: by_day[x['day']].append(x)
    days = sorted(by_day)
    if len(days) < 2: return 0.0
    rnd = random.Random(seed)
    vals = []
    for _ in range(reps):
        sample_days = [days[rnd.randrange(len(days))] for _ in days]
        ss = [x for d in sample_days for x in by_day[d]]
        vals.append(100.0 * sum(bool(x['action10']) for x in ss) / max(1, len(ss)))
    return float(np.quantile(np.asarray(vals, float), q))

def fetch(sym, retries=4):
    q = urllib.parse.quote(sym, safe='')
    url = f'https://query2.finance.yahoo.com/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits'
    err = None
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                d = json.loads(r.read().decode())
            z = ((d.get('chart') or {}).get('result') or [None])[0]
            if not z: return sym, [], 'NO_RESULT'
            ts = z.get('timestamp') or []
            q0 = ((z.get('indicators') or {}).get('quote') or [{}])[0]
            O,H,L,C,V = [q0.get(k0) or [] for k0 in ('open','high','low','close','volume')]
            out = []
            for i,t in enumerate(ts):
                if i >= len(C) or C[i] is None: continue
                c = float(C[i]); o = float(O[i] if i < len(O) and O[i] is not None else c)
                h = float(H[i] if i < len(H) and H[i] is not None else c)
                l = float(L[i] if i < len(L) and L[i] is not None else c)
                v = float(V[i] if i < len(V) and V[i] is not None else 0)
                if c > 0: out.append({'t':int(t),'o':o,'h':h,'l':l,'c':c,'v':max(0.0,v)})
            return sym, out, None
        except Exception as e:
            err = f'{type(e).__name__}:{e}'
            time.sleep(.5*(k+1))
    return sym, [], err

# Stable historical symbols first. Current discovery expands coverage but is not treated as
# historical point-in-time universe membership.
frozen = readj(FROZEN, {'data':[]})
freq = Counter(str(x.get('ticker') or '').upper() for x in frozen.get('data',[]) if x.get('ticker'))
hist = [s for s,_ in freq.most_common(380)]
disc = readj(DISCOVERY, {'rows':[]})
fresh = []
for r in disc.get('rows') or []:
    s = str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
    if s and s not in fresh: fresh.append(s)
symbols = []
for s in hist + fresh:
    if s and s not in symbols: symbols.append(s)
    if len(symbols) >= MAX_SYMBOLS: break

raw, errors = {}, {}
with ThreadPoolExecutor(max_workers=12) as ex:
    fs = [ex.submit(fetch, s) for s in symbols]
    for f in as_completed(fs):
        s,b,e = f.result(); raw[s] = b
        if e or not b: errors[s] = e or 'EMPTY'

events = []
unique_bars = set()
for sym,bars in raw.items():
    by = defaultdict(list)
    for z in bars:
        dt = datetime.fromtimestamp(z['t'], timezone.utc).astimezone(NY)
        ss = session(dt)
        if ss < 3: by[dt.date().isoformat()].append({**z,'dt':dt,'session':ss,'slot':slot(dt)})
    slot_vol = defaultdict(list); slot_cum = defaultdict(list)
    prev_close = None; prior = []
    for day in sorted(by):
        a = sorted(by[day], key=lambda x:x['t']); reg = [x for x in a if x['session']==1]
        if len(a) < 24 or not reg: continue
        if prev_close is None:
            prev_close = reg[-1]['c']; continue
        day_open = reg[0]['o']; cum=0.0; pvnum=0.0; pvden=0.0
        rv_hist=[]; rvc_hist=[]; vwaps=[]; prev_trigger=False; last_event_ts=None
        for i,z in enumerate(a):
            unique_bars.add((sym,z['t']))
            cum += z['v']; typ=(z['h']+z['l']+z['c'])/3.0; pvnum += typ*z['v']; pvden += z['v']
            if i < 12: continue
            c=z['c']; move=ret(c,prev_close); gap=ret(day_open,prev_close)
            if not (.15 <= c <= 30) or not (-25 <= move < 12) or c*cum < 25000: continue
            p=a[:i+1]
            def ago(k): return p[max(0,len(p)-1-k)]['c']
            r5,r10,r15,r30,r60=[ret(c,ago(k)) for k in (1,2,3,6,12)]
            rvb=z['v']/safe_median(slot_vol[z['slot']][-20:],z['v'] or 1)
            rvc=cum/safe_median(slot_cum[z['slot']][-20:],cum or 1)
            rv_hist.append(rvb); rvc_hist.append(rvc)
            rva=rvb-safe_median(rv_hist[-4:-1],rvb) if len(rv_hist)>3 else 0.0
            rvca=rvc-safe_median(rvc_hist[-4:-1],rvc) if len(rvc_hist)>3 else 0.0
            close15=[x['c'] for x in p[-4:]]; close60=[x['c'] for x in p[-13:]]
            comp15=ret(max(close15),min(close15)) if min(close15)>0 else 0.0
            comp60=ret(max(close60),min(close60)) if min(close60)>0 else 0.0
            prev60=p[-25:-12] if len(p)>=25 else p[:-12]
            prev_range=ret(max((x['h'] for x in prev60),default=c),min((x['l'] for x in prev60),default=c)) if prev60 and min(x['l'] for x in prev60)>0 else comp60
            rex=comp60-prev_range
            logr=np.diff(np.log(np.maximum(np.asarray(close60,float),1e-9)))
            vol60=float(np.std(logr)*100) if len(logr)>1 else 0.0
            last=p[-7:]; hi=max(x['h'] for x in last); lo=min(x['l'] for x in last)
            cp=(c-lo)/(hi-lo) if hi>lo else .5
            vwap=pvnum/pvden if pvden else c; vwaps.append(vwap); vd=ret(c,vwap)
            vs=ret(vwap,vwaps[-4]) if len(vwaps)>=4 and vwaps[-4]>0 else 0.0
            dhi=max(x['h'] for x in p); ddh=ret(c,dhi)
            pd=prior[-1] if prior else {'range':0.0,'volume':cum}
            triggers=[rvb>=1.7,rvc>=1.5,rva>=.65,rvca>=.55,r5>=.8,r10>=1.3,cp>=.72 and vd>=0,vs>=.15]
            breadth=sum(bool(t) for t in triggers)
            strength=(max(0,rvb-1.0)+max(0,rvc-1.0)+max(0,rva)+max(0,rvca)+max(0,r5)/2+max(0,r10)/3)
            ignition=(breadth>=2 and strength>=1.4)
            is_new=ignition and (not prev_trigger)
            if ignition and last_event_ts is not None and (z['t']-last_event_ts)/60 >= EVENT_COOLDOWN_MIN:
                # A materially renewed ignition can form a new event only after cooldown.
                recent_strength=[x for x in rv_hist[-3:]]
                is_new = is_new or (len(recent_strength)>=3 and rvb>=max(recent_strength[:-1])*1.35)
            prev_trigger=ignition
            if not is_new: continue
            if last_event_ts is not None and (z['t']-last_event_ts)/60 < EVENT_COOLDOWN_MIN: continue
            future=a[i+1:]
            if not future: continue
            def first_hit(pct,maxmin):
                for zz in future:
                    dm=(zz['t']-z['t'])/60
                    if dm>maxmin: break
                    if zz['h']>=c*(1+pct/100): return zz['t'],dm
                return None,None
            h10,l10=first_hit(10,120); h20,l20=first_hit(20,150)
            horizon=[x for x in future if (x['t']-z['t'])/60<=120]
            if h10:
                before=[x for x in future if x['t']<=h10]
                mae=ret(min(x['l'] for x in before),c) if before else 0.0
            else:
                mae=ret(min((x['l'] for x in horizon),default=c),c)
            same=[x for x in future if x['session']==z['session']]
            mfe=ret(max((x['h'] for x in same),default=c),c)
            action10=bool(l10 is not None and 15<=l10<=90 and mae>=-5)
            action20=bool(l20 is not None and 20<=l20<=120 and mae>=-5.5)
            same50=bool(mfe>=50)
            feat=[r5,r10,r15,r30,r60,r5-r15/3,r10-r30/3,move/20,gap/20,
                  math.log1p(z['v']),math.log1p(cum),math.log1p(max(0,c*cum)),
                  math.log1p(max(0,rvb)),math.log1p(max(0,rvc)),rva/5,rvca/5,
                  comp15/10,comp60/15,rex/10,vol60/10,cp,vd/10,vs/5,ddh/10,
                  pd['range']/20,math.log1p(max(0,pd['volume']))/20,
                  (z['dt'].hour*60+z['dt'].minute)/1440,float(z['session']==0),float(z['session']==1),float(z['session']==2),
                  breadth/8,strength/10]
            events.append({'symbol':sym,'day':day,'key':sym+'|'+day,'ts':z['t'],'session':z['session'],
                           'feat':feat,'action10':action10,'action20':action20,'sameSession50':same50,
                           'lead10':l10,'lead20':l20,'maeTo10Pct':mae,'remainingMfePct':mfe,
                           'triggerBreadth':breadth,'triggerStrength':strength})
            last_event_ts=z['t']
        cum2=0.0
        for z in a:
            cum2+=z['v']; slot_vol[z['slot']].append(z['v']); slot_cum[z['slot']].append(cum2)
            slot_vol[z['slot']]=slot_vol[z['slot']][-20:]; slot_cum[z['slot']]=slot_cum[z['slot']][-20:]
        rr=ret(max(x['h'] for x in reg),min(x['l'] for x in reg)) if min(x['l'] for x in reg)>0 else 0.0
        prior.append({'range':rr,'volume':sum(x['v'] for x in reg)}); prior=prior[-20:]
        prev_close=reg[-1]['c']

# One independent ignition event row at a time. Multiple events for the same ticker/day remain
# possible only after cooldown and renewed causal ignition; confidence also reports ticker-day collapse.
dates=sorted({x['day'] for x in events})
ia=max(1,int(.65*len(dates))); ib=max(ia+1,int(.80*len(dates)))
td=set(dates[:ia]); cd=set(dates[ia:ib]); hd=set(dates[ib:])
train=[x for x in events if x['day'] in td]; cal=[x for x in events if x['day'] in cd]; hold=[x for x in events if x['day'] in hd]

def training_subset(rr,seed):
    pos=[x for x in rr if x['action10']]
    hard=[x for x in rr if not x['action10'] and (x['triggerBreadth']>=3 or x['triggerStrength']>=2.0 or x['remainingMfePct']>=8)]
    easy=[x for x in rr if not x['action10'] and x not in hard]
    rnd=random.Random(seed); rnd.shuffle(hard); rnd.shuffle(easy)
    return pos + hard[:min(len(hard),max(2500,len(pos)*5))] + easy[:min(len(easy),max(1500,len(pos)*2))]

def fit_model(rr,seed=5902):
    u=training_subset(rr,seed)
    X=np.asarray([x['feat'] for x in u],float); y=np.asarray([int(x['action10']) for x in u],int)
    if len(y)==0 or len(np.unique(y))<2: return {'constant':float(y[0]) if len(y) else 0.0,'n':len(y),'p':int(y.sum()) if len(y) else 0}
    cnt=Counter(x['key'] for x in u); base=np.asarray([1/max(1,cnt[x['key']]) for x in u],float)
    pos=max(1,int(y.sum())); neg=max(1,len(y)-pos); cw=np.where(y==1,min(40,neg/pos),1.0); w=base*cw
    sc=StandardScaler().fit(X); Xs=sc.transform(X)
    et=ExtraTreesClassifier(n_estimators=500,max_depth=12,min_samples_leaf=7,max_features=.72,class_weight='balanced_subsample',n_jobs=-1,random_state=seed).fit(X,y,sample_weight=base)
    hg=HistGradientBoostingClassifier(max_iter=260,max_leaf_nodes=17,learning_rate=.035,l2_regularization=18,min_samples_leaf=25,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=1200,C=.06,class_weight='balanced',random_state=seed+2).fit(Xs,y,sample_weight=base)
    return {'sc':sc,'et':et,'hg':hg,'lr':lr,'n':len(y),'p':int(y.sum())}

def predict(m,rr):
    if not rr: return []
    if 'constant' in m: return [float(m['constant'])]*len(rr)
    X=np.asarray([x['feat'] for x in rr],float); Xs=m['sc'].transform(X)
    ps=np.vstack([m['et'].predict_proba(X)[:,1],m['hg'].predict_proba(X)[:,1],m['lr'].predict_proba(Xs)[:,1]])
    # Lower-confidence ensemble members cannot be hidden by one extreme model.
    mean=.45*ps[0]+.40*ps[1]+.15*ps[2]
    disagreement=np.std(ps,axis=0)
    return [float(max(0,min(1,a-.35*d))) for a,d in zip(mean,disagreement)]

model=fit_model(train)
for rr in (cal,hold):
    pp=predict(model,rr)
    for x,p in zip(rr,pp): x['score']=p

def collapse_ticker_day(sel):
    by=defaultdict(list)
    for x in sel: by[x['key']].append(x)
    # In production, the first emitted event is the executable decision for ticker/day.
    return [min(g,key=lambda z:z['ts']) for g in by.values()]

def metrics(sel):
    independent=collapse_ticker_day(sel)
    n=len(independent); tp=sum(x['action10'] for x in independent); days=len({x['day'] for x in independent})
    return {'rawEventCount':len(sel),'independentTickerDays':n,'tpAction10':tp,
            'precisionPct':round(100*tp/n,2) if n else None,
            'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,
            'dayBlockBootstrapLower90Pct':round(day_block_bootstrap_lower(independent),2) if n else None,
            'activeDays':days,
            'action20RatePct':round(100*sum(x['action20'] for x in independent)/n,2) if n else None,
            'sameSession50RatePct':round(100*sum(x['sameSession50'] for x in independent)/n,2) if n else None,
            'medianRemainingMfePct':round(float(np.median([x['remainingMfePct'] for x in independent])),2) if n else None,
            'medianLead10Min':round(float(np.median([x['lead10'] for x in independent if x['action10'] and x['lead10'] is not None])),1) if any(x['action10'] and x['lead10'] is not None for x in independent) else None}

# Threshold is chosen ONLY on calibration. No holdout metric participates in this search.
thresholds=sorted(set([.30,.40,.50,.60,.70,.80,.90]+[round(float(np.quantile([x['score'] for x in cal],q)),4) for q in (.50,.65,.75,.85,.90,.95,.97)])) if cal else [.9]
candidates=[]
for th in thresholds:
    sel=[x for x in cal if x['score']>=th]
    m=metrics(sel); n=m['independentTickerDays']; p=m['precisionPct'] or 0; lo=m['wilsonLower90Pct'] or 0; blo=m['dayBlockBootstrapLower90Pct'] or 0
    utility=lo*100 + blo*80 + p*20 + min(n,150)*1.5
    if n<MIN_CAL_SUPPORT: utility-=5000
    if m['activeDays']<MIN_CAL_DAYS: utility-=3500
    candidates.append((utility,th,m))
candidates.sort(key=lambda z:z[0],reverse=True)
_,threshold,cal_metrics=candidates[0]
hold_sel=[x for x in hold if x['score']>=threshold]
hold_metrics=metrics(hold_sel)

claim_candidate=bool(
    cal_metrics['independentTickerDays']>=100 and cal_metrics['activeDays']>=10 and
    (cal_metrics['precisionPct'] or 0)>=90 and (cal_metrics['wilsonLower90Pct'] or 0)>=80 and (cal_metrics['dayBlockBootstrapLower90Pct'] or 0)>=80 and
    hold_metrics['independentTickerDays']>=100 and hold_metrics['activeDays']>=10 and
    (hold_metrics['precisionPct'] or 0)>=90 and (hold_metrics['wilsonLower90Pct'] or 0)>=80 and (hold_metrics['dayBlockBootstrapLower90Pct'] or 0)>=80
)

b57=readj(BASE57,{})
report={
    'schemaVersion':'5.9-independent-event-discovery',
    'generatedAtUTC':datetime.now(timezone.utc).isoformat(),
    'status':'COMPLETE' if train and cal and hold else 'INSUFFICIENT',
    'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
    'statisticalUnit':'FIRST_EXECUTABLE_IGNITION_EVENT_PER_TICKER_DAY_FOR_PRECISION',
    'eventDefinition':f'causal ignition transition; renewed event requires >= {EVENT_COOLDOWN_MIN}m cooldown',
    'label':'first +10% hit 15-90m after event with MAE to hit >= -5%',
    'data':{'symbolsRequested':len(symbols),'symbolsSucceeded':sum(bool(v) for v in raw.values()),'fetchFailures':len(errors),
            'unique5mBars':len(unique_bars),'eventRows':len(events),'tickerDays':len({x['key'] for x in events}),'days':len(dates)},
    'splits':{'trainEvents':len(train),'calibrationEvents':len(cal),'holdoutEvents':len(hold),'trainDays':len(td),'calibrationDays':len(cd),'holdoutDays':len(hd),
              'trainPositiveEvents':sum(x['action10'] for x in train),'calPositiveEvents':sum(x['action10'] for x in cal),'holdPositiveEvents':sum(x['action10'] for x in hold)},
    'training':{'fitRows':model.get('n'),'positiveFitRows':model.get('p'),'hardNegativeMining':True,'tickerDaySampleWeighting':True},
    'selectedThreshold':threshold,
    'thresholdSelectionRule':'calibration only; support/day penalties; untouched holdout never enters selection',
    'calibration':cal_metrics,
    'holdout':hold_metrics,
    'priorV57HoldoutPrecisionPct':((b57.get('holdout') or {}).get('precisionActionablePct')),
    'credibilityGate':{'candidate90OnHistoricalHoldout':claim_candidate,'requiredIndependentEvents':100,'requiredActiveDays':10,'requiredPointPrecisionPct':90,'requiredWilsonLower90Pct':80,'requiredDayBootstrapLower90Pct':80,'forwardConfirmationStillRequired':True},
    'antiLeakage':['all features use current/prior bars only','future bars are labels only','same-time RVOL baseline uses prior completed days only','chronological 65/15/20 date split','model fit on train only','threshold selected on calibration only','holdout evaluated once after threshold freeze','precision collapses repeated ticker-day events to first executable event'],
    'verdict':'V59_HISTORICAL_CANDIDATE_REQUIRES_FORWARD' if claim_candidate else 'V59_RESEARCH_COMPLETE_NOT_90',
    'errorsSample':dict(list(errors.items())[:20])
}
# Store a compact auditable sample; never feed holdout outcomes back into training.
def compact(x):
    return {k:x.get(k) for k in ('symbol','day','ts','session','action10','action20','sameSession50','lead10','maeTo10Pct','remainingMfePct','triggerBreadth','triggerStrength','score')}
sample={'schemaVersion':'5.9-event-audit-sample','policy':'AUDIT_ONLY_NOT_TRAINING_MEMORY','calibrationSelected':[compact(x) for x in cal if x['score']>=threshold][:300],
        'holdoutSelected':[compact(x) for x in hold_sel][:300]}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
EVENTS.write_text(json.dumps(sample,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
