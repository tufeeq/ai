"""Closed-5m opening/continuation hypotheses shared by replay and live research.

All model estimates and setups are research observations, never trade permission.
"""
import json, math
from pathlib import Path
from explosive import pct, slot, aggregate_minutes, ET
from datetime import datetime, timezone

SCHEMA='session-setups-v1.0'
FEATURES=['return5','return15','moveFromOpen','gapPct','vwapDistance',
    'drawdownFromHigh','closePosition5','upperWick5','range5','range15',
    'logDollarVolume5','logRelativeVolume','volumeAcceleration5','minutesFromOpen',
    'breakoutDistance15','previousBarReturn','priorDayReturn','priorDayRange']
HYPOTHESES={
    'OPENING_IMPULSE':'First 15 minutes; >=0.5% 5m body, high close, >=1.5x same-time volume, above VWAP',
    'RANGE_BREAKOUT':'After 20 minutes; >=0.3% 5m body and >0.1% beyond prior 15m high, volume acceleration',
    'PULLBACK_RECLAIM':'After 25 minutes; prior red bar >=0.2%, regain prior 15m high, above VWAP and within 2% of session high'}

def vector(prefix, ref):
    if not prefix or not ref or slot(prefix[0]['t'])!=570:return None
    if any(b['t']-a['t']!=300 for a,b in zip(prefix,prefix[1:])):return None
    if any(not all(isinstance(b.get(k),(int,float)) and math.isfinite(b[k]) for k in 'ohlcv')
        or b['v']<0 or not 0<b['l']<=min(b['o'],b['c'])<=max(b['o'],b['c'])<=b['h'] for b in prefix):return None
    b=prefix[-1];recent=prefix[-3:];before=prefix[-4:-1]
    volume=sum(v['v'] for v in prefix);baseline=ref['cumulativeVolume'].get(str(slot(b['t'])))
    if volume<=0 or not baseline or baseline<=0 or ref.get('previousClose',0)<=0:return None
    price=b['c'];width=max(b['h']-b['l'],1e-9)
    vwap=sum((v['h']+v['l']+v['c'])/3*v['v'] for v in prefix)/volume
    prior_high=max(v['h'] for v in before) if before else b['o']
    prior_volume=sum(v['v'] for v in before)/len(before) if before else baseline
    return [pct(price,b['o']),pct(price,recent[0]['o']),pct(price,prefix[0]['o']),
        pct(prefix[0]['o'],ref['previousClose']),pct(price,vwap),pct(max(v['h'] for v in prefix),price),
        (price-b['l'])/width,(b['h']-max(b['o'],price))/width,pct(b['h'],b['l']),
        pct(max(v['h'] for v in recent),min(v['l'] for v in recent)),
        math.log1p(price*b['v']),math.log1p(min(volume/baseline,100)),
        min(b['v']/prior_volume,100) if prior_volume>0 else 0,
        slot(b['t'])+5-570,pct(price,prior_high),
        pct(prefix[-2]['c'],prefix[-2]['o']) if len(prefix)>1 else 0,
        ref['priorDayReturn'],ref['priorDayRange']]

def domain(x, price):
    return bool(x and price>=.2 and 5<=x[13]<=350 and x[10]>=math.log1p(100000))

def families(x):
    if not x:return []
    # RVOL alone is never a directional trigger. Thresholds are frozen hypotheses,
    # not assertions that these patterns will earn money.
    strong=x[4]>=0 and x[6]>=.7 and x[7]<=.3 and x[11]>=math.log1p(1.5)
    if not strong:return []
    found=[]
    if x[13]<=15 and x[0]>=.5 and x[2]<10:found.append('OPENING_IMPULSE')
    if x[13]>=20 and x[0]>=.3 and x[14]>.1 and x[12]>=1.25 and x[2]<15:
        found.append('RANGE_BREAKOUT')
    if x[13]>=25 and x[0]>=.3 and x[15]<=-.2 and x[5]<=2 and x[14]>0 and x[12]>=1.25 and x[2]<15:
        found.append('PULLBACK_RECLAIM')
    return found

def volume_baseline(x):
    return bool(x and x[0]>=.3 and x[11]>=math.log1p(1.5))

def hard_negative(x):
    return bool(x and x[11]>=math.log1p(1.5) and (x[0]<0 or x[7]>=.5 or x[4]<0))

def outcome(future, decision, close_at, target_pct=3, horizon_minutes=30):
    entry_at=decision+300
    deadline=close_at if horizon_minutes is None else entry_at+horizon_minutes*60
    if deadline>close_at or not future or future[0]['t']!=entry_at:return None
    entry=future[0]['o'];previous=entry_at-300;mae=mfe=0.
    if entry<=0:return None
    for b in future:
        if b['t']>=deadline:break
        if b['t']!=previous+300:return None
        if any(not isinstance(b.get(k),(int,float)) or not math.isfinite(b[k]) for k in 'ohlcv') or not 0<b['l']<=min(b['o'],b['c'])<=max(b['o'],b['c'])<=b['h']:return None
        previous=b['t'];mae=min(mae,pct(b['l'],entry));mfe=max(mfe,pct(b['h'],entry))
        stop=entry*.98;target=entry*(1+target_pct/100)
        if b['l']<=stop:
            return {'label':'STOP_FIRST','grossReturnPct':pct(min(b['o'],stop),entry),
                'maePct':mae,'mfePct':mfe,'ambiguous':b['h']>=target,'minutesToExit':(b['t']-entry_at)/60,
                'entryAt':entry_at,'entryPrice':entry}
        if b['h']>=target:
            return {'label':'TARGET_FIRST','grossReturnPct':target_pct,'maePct':mae,'mfePct':mfe,
                'ambiguous':False,'minutesToExit':(b['t']-entry_at)/60,'entryAt':entry_at,'entryPrice':entry}
    if previous+300!=deadline:return None
    b=next(v for v in reversed(future) if v['t']<deadline)
    return {'label':'TIMEOUT','grossReturnPct':pct(b['c'],entry),'maePct':mae,'mfePct':mfe,
        'ambiguous':False,'minutesToExit':(deadline-entry_at)/60,'entryAt':entry_at,'entryPrice':entry}

def predict_net(model,x):
    value=model['intercept']
    for tree in model['trees']:
        i=0
        while not tree[i]['leaf']:
            node=tree[i];i=node['left'] if x[node['feature']]<=node['threshold'] else node['right']
        value+=tree[i]['value']
    return value

def load_model():
    try:return json.loads((Path(__file__).parent/'reports/session-model.json').read_text())
    except (OSError,ValueError):return None

def observe(symbol,points,session,refs,bundle,at):
    base={'schema':SCHEMA,'tradeEligible':False,'status':'UNAVAILABLE'}
    if session!='regular':return {**base,'reason':'REGULAR_SESSION_ONLY'}
    ref=refs.get('symbols',{}).get(symbol);today=datetime.fromtimestamp(at,ET).date().isoformat()
    if not ref or not ref.get('asOfDate') or not 0<(datetime.fromisoformat(today)-datetime.fromisoformat(ref['asOfDate'])).days<=7:
        return {**base,'reason':'PRIOR_SESSION_BASELINE_UNAVAILABLE'}
    bars=[b for b in aggregate_minutes(points) if datetime.fromtimestamp(b['t'],ET).date().isoformat()==today and 570<=slot(b['t'])<960]
    if not bars or not 0<=at-bars[-1]['t']-300<=60:return {**base,'reason':'WAITING_FOR_FRESH_CLOSED_5M_BAR'}
    x=vector(bars,ref)
    if not domain(x,bars[-1]['c']):return {**base,'reason':'INCOMPLETE_OR_INSUFFICIENT_DATA'}
    names=families(x)
    if not names:return {**base,'status':'NO_SETUP','reason':'PRICE_VOLUME_STRUCTURE_NOT_MET'}
    result={**base,'status':'RESEARCH_SETUP','families':names,'decisionAtUTC':datetime.fromtimestamp(bars[-1]['t']+300,timezone.utc).isoformat(),
        'minutesFromOpen':x[13],'indicatorEvidence':dict(zip(FEATURES,x)),
        'meaning':'Observed price/volume structure; no demonstrated trading approval'}
    if bundle and bundle.get('schema')==SCHEMA and bundle.get('trainingCutoff',today)<today and bundle.get('evaluatedThrough',today)<today:
        result.update(modelId=bundle['id'],estimatedNet30mPct=round(predict_net(bundle['model'],x),4),
            validationStatus=bundle['validationStatus'],researchThreshold=bundle['threshold'])
    return result
