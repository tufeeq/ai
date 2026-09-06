#!/usr/bin/env python3
import json, math, statistics, subprocess, pathlib
from collections import defaultdict
from datetime import datetime, timezone

DATA_PATH='tag/data/discovery-fast.json'
OUT_PATH=pathlib.Path('tag/data/tagit-large-walkforward.json')

def clamp(x,a=0,b=100): return max(a,min(b,x))
def pct(v):
    if v is None: return None
    try:
        if isinstance(v,str): v=v.replace('%','').replace(',','').strip()
        return float(v)
    except: return None

def num(v):
    if v is None: return None
    try:
        if isinstance(v,str): v=v.replace(',','').strip()
        return float(v)
    except: return None

def parse_ts(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace('Z','+00:00'))
    except: return None

def git(*args):
    return subprocess.check_output(['git',*args],text=True,stderr=subprocess.DEVNULL)

def med(xs):
    xs=[x for x in xs if x is not None and math.isfinite(x)]
    return round(statistics.median(xs),2) if xs else None

def mean(xs):
    xs=[x for x in xs if x is not None and math.isfinite(x)]
    return round(statistics.mean(xs),2) if xs else None

def rate_bool(xs):
    xs=[bool(x) for x in xs]
    return round(sum(xs)/len(xs)*100,2) if xs else None

def f1(p,r):
    if p is None or r is None or p+r==0: return None
    return round(2*p*r/(p+r),2)

# Mirrors TAGit 0.4 continuation logic using only fields that existed point-in-time
# in historical discovery snapshots. Missing spread/VWAP/catalyst/float remain missing.
def score(obs):
    va=obs.get('volumeAcceleration'); pa=obs.get('priceAcceleration'); rv=obs.get('rvol')
    spread=None; breakout=obs.get('breakoutQuality'); vwap=None; catalyst=None; cat_age=None
    change=obs.get('changePct') or 0; volume=obs.get('volume') or 0
    critical=[va,pa,rv,spread,breakout,vwap]
    coverage=sum(v is not None for v in critical)/len(critical)
    quality=min(.82,.45+coverage*.55)-.04-.03-.06
    quality=clamp(quality,0,1)
    dilution=.35; halt=.10

    # phase
    if change < 0 and (va or 0) < 1: phase='FAILED'
    elif change>=55 or ((rv or 0)>=20 and change>=35): phase='EXHAUSTION'
    elif change>=24 and (breakout or 0)>=.72 and (va or 0)>=5: phase='EXPANSION'
    elif (breakout or 0)>=.66 and (va or 0)>=3: phase='BREAKOUT'
    elif (va or 0)>=2.2 and (pa or 0)>=.6 and (rv if rv is not None else 1.5)>=1.5: phase='ACCELERATION'
    elif (va or 0)>=1.35 and (rv if rv is not None else 1.5)>=1.25: phase='IGNITION'
    else: phase='ANOMALY'

    def norm(v,m): return clamp(((v or 0)/m)*100)
    def weighted(parts):
        ok=[(v,w) for v,w in parts if v is not None and math.isfinite(v)]
        if not ok:return 0
        sw=sum(w for _,w in ok) or 1
        return sum(v*w for v,w in ok)/sw

    catalyst_score=0
    accel=weighted([(None if va is None else norm(va,8),.55),(None if pa is None else norm(max(0,pa),3),.45)])
    participation=weighted([(None if rv is None else norm(rv,10),.70),(None,.30)])
    structure=weighted([(None if breakout is None else breakout*100,.45),(None,.35),(None if obs.get('distanceToBreakoutPct') is None else max(0,100-abs(min(0,obs['distanceToBreakoutPct']))*14),.20)])
    liquidity=weighted([(None,.65),(min(100,norm(volume,4_000_000)) if volume>0 else None,.35)])
    freshness=0
    risk=clamp(dilution*42+halt*23+12+max(0,change-35)*.45+(12 if coverage<.5 else 0))
    bonus={'ANOMALY':0,'IGNITION':7,'ACCELERATION':10,'BREAKOUT':5,'EXPANSION':-6,'EXHAUSTION':-20,'FAILED':-30}.get(phase,0)
    raw=catalyst_score*.12+accel*.25+participation*.19+structure*.18+liquidity*.11+freshness*.05+(quality*100)*.10
    extension=max(0,change-24)*.35
    base=clamp(raw+bonus-risk*.14-4-extension) # neutral market regime: conservative

    support=possible=contr=0
    def add(avail,w,good,bad):
        nonlocal support,possible,contr
        if not avail:return
        possible+=w
        if good:support+=w
        if bad:contr+=w
    add(va is not None,20,(va or 0)>=1.6,(va or 0)<.8)
    add(pa is not None,16,(pa or 0)>=.25,(pa or 0)<=-.35)
    add(rv is not None,16,(rv or 0)>=1.5,(rv or 0)<.8)
    add(False,14,False,False) # VWAP unavailable historically
    add(breakout is not None,14,(breakout or 0)>=.55,(breakout or 0)<.25)
    add(False,10,False,False) # spread unavailable historically
    add(False,10,False,False) # catalyst unavailable historically
    cont=(support/possible*100 if possible else 0)-(contr/possible*65 if possible else 25)
    if change>20:cont-=min(22,(change-20)*.7)
    if quality<.65:cont-=10
    cont=round(clamp(cont))
    confidence='HIGH' if coverage>=.83 else ('MEDIUM' if coverage>=.5 else 'LOW')
    action=round(clamp(base*.58+cont*.42-risk*.16-(8 if phase=='EXPANSION' else 0)-(22 if phase=='EXHAUSTION' else 0)))
    if phase=='FAILED': gate='REJECT'
    elif quality*100<60 or confidence=='LOW': gate='REJECT'
    elif risk>=72 or phase=='EXHAUSTION': gate='CAUTION'
    elif contr>=20: gate='OBSERVE'
    elif action>=65 and cont>=68 and phase in ('IGNITION','ACCELERATION','BREAKOUT'): gate='WATCH'
    else: gate='OBSERVE'
    return {'phase':phase,'score':round(base),'actionability':action,'continuation':cont,'quality':round(quality*100),'risk':round(risk),'gate':gate,'coverage':round(coverage,3)}

# Load historical file versions from git. We use the file's embedded snapshot timestamp,
# not commit time, and de-duplicate identical timestamps.
commits=git('log','--format=%H','--reverse','--',DATA_PATH).splitlines()
snapshots=[]; seen_ts=set(); parse_fail=0
for sha in commits:
    try:
        raw=git('show',f'{sha}:{DATA_PATH}')
        d=json.loads(raw)
        ts=d.get('snapshotTimestampUTC') or d.get('updatedAt')
        dt=parse_ts(ts)
        if not dt or ts in seen_ts: continue
        seen_ts.add(ts)
        rows=d.get('rows') or []
        if not rows: continue
        snapshots.append((dt,ts,d.get('session'),rows,sha))
    except Exception:
        parse_fail+=1
snapshots.sort(key=lambda x:x[0])

series=defaultdict(list)
raw_rows=0
for dt,ts,session,rows,sha in snapshots:
    for r in rows:
        ticker=str(r.get('Ticker') or '').strip().upper()
        price=num(r.get('Price')); volume=num(r.get('Volume')); change=pct(r.get('Change')); rv=num(r.get('Relative Volume')); avg=num(r.get('Average Volume'))
        if not ticker or not price or price<=0 or volume is None: continue
        raw_rows+=1
        series[ticker].append({'ticker':ticker,'dt':dt,'ts':ts,'session':session,'sha':sha,'price':price,'volume':volume,'changePct':change,'rvol':rv,'avgVolK':avg,'patternScore':num(r.get('_earlyPatternScore')),'latent':bool(r.get('_latentIgnition'))})

# Build strictly causal features from prior snapshots only.
observations=[]
for ticker, arr in series.items():
    arr.sort(key=lambda x:x['dt'])
    day_hist=defaultdict(list)
    prev=None
    for o in arr:
        day=o['dt'].date().isoformat()
        hist=day_hist[day]
        if prev is None or prev['dt'].date()!=o['dt'].date(): prev=None
        if prev:
            mins=(o['dt']-prev['dt']).total_seconds()/60
            if 0.2<=mins<=120:
                o['priceAcceleration']=((o['price']/prev['price']-1)*100)*(5/mins)
                dv=o['volume']-prev['volume']
                avg_shares=(o['avgVolK']*1000) if o.get('avgVolK') and o['avgVolK']>0 else None
                if dv>=0 and avg_shares:
                    inc_per_min=dv/mins; base_per_min=max(1,avg_shares/390)
                    o['volumeAcceleration']=inc_per_min/base_per_min
                else:o['volumeAcceleration']=None
            else:
                o['priceAcceleration']=None;o['volumeAcceleration']=None
        else:
            o['priceAcceleration']=None;o['volumeAcceleration']=None
        prior_prices=[x['price'] for x in hist[-8:]]
        if prior_prices:
            mx=max(prior_prices); dist=(o['price']/mx-1)*100
            o['distanceToBreakoutPct']=dist
            o['breakoutQuality']=clamp(1-max(0,-dist)/8,0,1)
        else:
            o['distanceToBreakoutPct']=None;o['breakoutQuality']=None
        o['volume']=o['volume']
        sc=score(o);o.update(sc)
        # Discovery-only comparator from the historical engine; all fields are current-snapshot values.
        o['legacyCandidate']=bool((o.get('patternScore') or 0)>=65 and o.get('latent') and (o.get('changePct') or 0)<24)
        observations.append(o);hist.append(o);prev=o

# Index by ticker/day for forward outcomes.
by_td=defaultdict(list)
for o in observations: by_td[(o['ticker'],o['dt'].date().isoformat())].append(o)
for arr in by_td.values(): arr.sort(key=lambda x:x['dt'])

eligible=[]
for key,arr in by_td.items():
    for i,o in enumerate(arr):
        if o.get('priceAcceleration') is None or o.get('volumeAcceleration') is None or o.get('rvol') is None: continue
        fut=[x for x in arr[i+1:] if x['dt']>o['dt']]
        if not fut: continue
        f30=[x for x in fut if (x['dt']-o['dt']).total_seconds()<=1800]
        f60=[x for x in fut if (x['dt']-o['dt']).total_seconds()<=3600]
        def ret(x): return (x['price']/o['price']-1)*100
        dayrets=[ret(x) for x in fut]
        r30=[ret(x) for x in f30];r60=[ret(x) for x in f60]
        o['mfe30']=max(r30) if r30 else None;o['mae30']=min(r30) if r30 else None
        o['mfe60']=max(r60) if r60 else None;o['mae60']=min(r60) if r60 else None
        o['mfeDay']=max(dayrets) if dayrets else None;o['maeDay']=min(dayrets) if dayrets else None
        o['hit5_30']=o['mfe30'] is not None and o['mfe30']>=5
        o['hit10_60']=o['mfe60'] is not None and o['mfe60']>=10
        o['hit20_day']=o['mfeDay'] is not None and o['mfeDay']>=20
        eligible.append(o)

watch=[o for o in eligible if o['gate']=='WATCH']
legacy=[o for o in eligible if o['legacyCandidate']]

def classification(cands,label):
    positives=[o for o in eligible if o[label]]
    tp=[o for o in cands if o[label]]
    precision=(len(tp)/len(cands)*100) if cands else None
    recall=(len(tp)/len(positives)*100) if positives else None
    return {'candidates':len(cands),'positivesInUniverse':len(positives),'truePositives':len(tp),'precisionPct':round(precision,2) if precision is not None else None,'recallPct':round(recall,2) if recall is not None else None,'f1Pct':f1(precision,recall)}

def candidate_stats(cands):
    return {
      'count':len(cands),
      'hit5_30mPct':rate_bool([o['hit5_30'] for o in cands]),
      'hit10_60mPct':rate_bool([o['hit10_60'] for o in cands]),
      'hit20_dayPct':rate_bool([o['hit20_day'] for o in cands]),
      'medianMFE30Pct':med([o['mfe30'] for o in cands]),
      'medianMAE30Pct':med([o['mae30'] for o in cands]),
      'medianMFE60Pct':med([o['mfe60'] for o in cands]),
      'medianMAE60Pct':med([o['mae60'] for o in cands]),
      'medianMFEDayPct':med([o['mfeDay'] for o in cands]),
      'medianMAEDayPct':med([o['maeDay'] for o in cands]),
    }

# First candidate per ticker/day removes repeated-snapshot inflation.
def first_per_day(cands):
    out=[];seen=set()
    for o in sorted(cands,key=lambda x:x['dt']):
        k=(o['ticker'],o['dt'].date().isoformat())
        if k in seen:continue
        seen.add(k);out.append(o)
    return out
fw=first_per_day(watch);fl=first_per_day(legacy)

# Event capture: ticker-days containing at least one early (<10% daily change) observation
# that subsequently achieved +10% within 60 minutes. Count captured if a WATCH itself was
# one of those positive early observations.
early_pos=defaultdict(list)
for o in eligible:
    if abs(o.get('changePct') or 0)<10 and o['hit10_60']:
        early_pos[(o['ticker'],o['dt'].date().isoformat())].append(o)
opp=set(early_pos)
captured=set((o['ticker'],o['dt'].date().isoformat()) for o in watch if abs(o.get('changePct') or 0)<10 and o['hit10_60'])
legacy_cap=set((o['ticker'],o['dt'].date().isoformat()) for o in legacy if abs(o.get('changePct') or 0)<10 and o['hit10_60'])

report={
 'schemaVersion':2,
 'method':'GIT_HISTORY_POINT_IN_TIME_WALK_FORWARD',
 'generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'source':DATA_PATH,
 'antiLeakageRules':['Each snapshot is loaded from its historical Git revision.','Features use only current/prior snapshots for the same ticker/day.','Forward prices are used only after the gate decision is frozen.','Final _moveFromFirstPct/_volumeExpansionFromFirst are never used as model inputs.','First WATCH per ticker/day is reported separately to reduce repeated-snapshot inflation.'],
 'coverage':{'gitRevisions':len(commits),'parsedUniqueSnapshots':len(snapshots),'parseFailures':parse_fail,'snapshotRows':raw_rows,'causalObservations':len(observations),'eligibleObservationsWithForwardData':len(eligible),'uniqueTickerDays':len(by_td),'watchObservations':len(watch),'watchEventsFirstPerTickerDay':len(fw),'legacyDiscoveryObservations':len(legacy)},
 'tagit04':{'observationLevel':candidate_stats(watch),'eventLevelFirstWatch':candidate_stats(fw),'classification10pct60m':classification(watch,'hit10_60')},
 'discoveryOnlyBaseline':{'observationLevel':candidate_stats(legacy),'eventLevelFirstCandidate':candidate_stats(fl),'classification10pct60m':classification(legacy,'hit10_60')},
 'earlyOpportunityRecall':{'opportunityTickerDays':len(opp),'tagitCapturedTickerDays':len(captured),'tagitRecallPct':round(len(captured)/len(opp)*100,2) if opp else None,'baselineCapturedTickerDays':len(legacy_cap),'baselineRecallPct':round(len(legacy_cap)/len(opp)*100,2) if opp else None},
 'segments':{},
 'limitations':['Historical discovery snapshots do not contain bid/ask spread, VWAP, catalyst direction, float or SEC dilution at every point. Those fields are kept unavailable rather than fabricated.','Therefore this is a conservative replay of TAGit 0.4 continuation logic on the historical feature intersection, not a full SIP/news/SEC replay.','Finviz snapshots are sampled, not one-minute bars; an intraperiod peak between snapshots can be missed.','No transaction costs or slippage are included.']
}
for name,pred in {
 'early_change_under_10':lambda o:abs(o.get('changePct') or 0)<10,
 'continuation_68_79':lambda o:68<=o.get('continuation',0)<80,
 'continuation_80_plus':lambda o:o.get('continuation',0)>=80,
 'acceleration_phase':lambda o:o.get('phase')=='ACCELERATION',
 'breakout_phase':lambda o:o.get('phase')=='BREAKOUT',
}.items():
    xs=[o for o in watch if pred(o)]
    report['segments'][name]=candidate_stats(xs)

# Compact examples only; full observation rows are deliberately not committed.
def sample_row(o):
    return {k:(round(o[k],3) if isinstance(o.get(k),float) else o.get(k)) for k in ['ticker','ts','session','price','changePct','rvol','volumeAcceleration','priceAcceleration','phase','score','actionability','continuation','gate','mfe30','mfe60','mfeDay','mae60']}
report['examples']={'bestWatchByMFE60':[sample_row(o) for o in sorted(watch,key=lambda x:(x.get('mfe60') if x.get('mfe60') is not None else -999),reverse=True)[:12]],'falsePositiveWatch':[sample_row(o) for o in sorted([x for x in watch if not x['hit5_30']],key=lambda x:(x.get('mae60') if x.get('mae60') is not None else 0))[:12]]}

OUT_PATH.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:report[k] for k in ['coverage','tagit04','discoveryOnlyBaseline','earlyOpportunityRecall','segments']},indent=2))
