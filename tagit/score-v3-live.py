#!/usr/bin/env python3
"""Score current Finviz Rich feed with TAGit v3 graded-relevance ranker.

Output is rank/state evidence, not a calibrated success probability.
Champion is never modified. State cache contains only derived observations needed
for causal sequence derivatives on later runs.
"""
import json, math, pathlib
from datetime import datetime, timezone

import joblib
import numpy as np

RAW=pathlib.Path('tag/data/finviz-rich.json')
MODEL=pathlib.Path('tag/model/tagit-v3-ranker.joblib')
OUT=pathlib.Path('tag/data/tagit-v3-shadow.json')
MAX_PRICE=20.0; MAX_CAP=2_000_000_000.0

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def q(v,d=0.0): return float(v) if finite(v) else d
def slog(v): return math.log1p(max(0,q(v))) if finite(v) else 0.0
def read(p,d):
    try:return json.loads(p.read_text())
    except:return d

def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    o=np.argsort(np.argsort(a));return o/(len(a)-1)
def degraded(reason,raw=None):
    p={'schemaVersion':3,'source':'TAGit v3 graded relevance shadow ranker','updatedAt':datetime.now(timezone.utc).isoformat(),'status':'DEGRADED','reason':reason,
       'session':(raw or {}).get('session'),'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,
       'counts':{'total':0,'lead':0,'shortlist':0,'radar':0},'items':[],'stateCache':{}}
    OUT.write_text(json.dumps(p,indent=2)+'\n');print(json.dumps({k:v for k,v in p.items() if k not in ('items','stateCache')},indent=2))

raw=read(RAW,{})
if not raw or not MODEL.exists(): degraded('MODEL_OR_RICH_INPUT_MISSING',raw);raise SystemExit(0)
try: art=joblib.load(MODEL)
except Exception as e: degraded(f'MODEL_LOAD_FAILED:{type(e).__name__}',raw);raise SystemExit(0)
prev=read(OUT,{}); cache0=prev.get('stateCache') or {}
asof=raw.get('updatedAt') or datetime.now(timezone.utc).isoformat(); day=asof[:10]; session=str(raw.get('session') or 'unknown').lower();active=session in ('pre-market','regular','after-hours')
try: now=datetime.fromisoformat(asof.replace('Z','+00:00')).timestamp()*1000
except: now=datetime.now(timezone.utc).timestamp()*1000
rows=raw.get('rows') or [];built=[];excluded=0
for r in rows:
    t=r.get('_tagit') or {};sym=str(r.get('Ticker') or '').upper();price=q(t.get('price'),None) if finite(t.get('price')) else None;cap=q(t.get('marketCapUsd'),None) if finite(t.get('marketCapUsd')) else None
    if not sym or price is None or price<.15:continue
    if price>MAX_PRICE or (cap is not None and cap>MAX_CAP): excluded+=1;continue
    ch=q(t.get('dayChangePct'))
    if not (-20<=ch<10):continue
    rv=t.get('relativeVolume');vol=t.get('volume');avg=t.get('averageVolumeShares');pm=cache0.get(sym) or {};same=pm.get('day')==day and pm.get('session')==session and finite(pm.get('ts'))
    dt=(now-q(pm.get('ts')))/60000 if same else None;vv=rdelta=vvacc=None
    if same and dt and 0<dt<=90:
        if finite(rv) and finite(pm.get('rvol')):rdelta=(q(rv)-q(pm.get('rvol')))/dt
        if finite(vol) and finite(pm.get('volume')) and finite(avg) and q(avg)>0 and q(vol)>=q(pm.get('volume')):
            exp=q(avg)/390*dt
            if exp>0:vv=(q(vol)-q(pm.get('volume'))/1)/exp
        if finite(vv) and finite(pm.get('volumeVelocity')):vvacc=(q(vv)-q(pm.get('volumeVelocity')))/max(dt,1)
    mom=t.get('momentumPct') or {};m5=mom.get('5');m10=mom.get('10');m30=mom.get('30');m60=mom.get('60');short=t.get('shortMomentumRatePctPerMin')
    turn=q(m5)-q(m30)/6 if finite(m5) and finite(m30) else 0; c1=q(m5)-q(m10)/2 if finite(m5) and finite(m10) else 0;c2=q(m10)-q(m30)/3 if finite(m10) and finite(m30) else 0
    quiet=1 if abs(q(m30))<4 and abs(ch)<10 else 0
    hist=list(pm.get('history') or [])[-3:]+[{'price':price,'rvol':q(rv,None) if finite(rv) else None}]
    pos=sum(1 for i in range(1,len(hist)) if finite(hist[i].get('price')) and finite(hist[i-1].get('price')) and q(hist[i]['price'])>q(hist[i-1]['price']))
    rup=sum(1 for i in range(1,len(hist)) if finite(hist[i].get('rvol')) and finite(hist[i-1].get('rvol')) and q(hist[i]['rvol'])>q(hist[i-1]['rvol']))
    feat=[ch,slog(rv),slog(vv),q(short),q(m5),q(m10),q(m30),q(m60),slog(t.get('dollarVolume')),q(rdelta),q(vvacc),q(turn),q(c1),q(c2),quiet,pos,rup]
    built.append({'symbol':sym,'features':feat,'price':price,'cap':cap,'change':ch,'rvol':q(rv,None) if finite(rv) else None,'volume':q(vol,None) if finite(vol) else None,'vv':q(vv,None) if finite(vv) else None,'history':hist,'t':t})
if not built:
    p={'schemaVersion':3,'source':'TAGit v3 graded relevance shadow ranker','updatedAt':asof,'status':'PASS','session':session,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,'counts':{'total':0,'lead':0,'shortlist':0,'radar':0},'items':[],'stateCache':{}}
    OUT.write_text(json.dumps(p,indent=2)+'\n');print(json.dumps(p,indent=2));raise SystemExit(0)
X=np.asarray([x['features'] for x in built],float);se=art['extraTrees'].predict(X);sh=art['histGradientBoosting'].predict(X);sp=art['scaler'].transform(X)@art['pairwise'].coef_[0]
er,hr,pr=rank01(se),rank01(sh),rank01(sp)
for i,x in enumerate(built):
    vals=np.asarray([er[i],hr[i],pr[i]]);x['rankScore']=float(.4*vals[0]+.35*vals[1]+.25*vals[2]);x['disagreement']=float(np.std(vals));x['rawRelevance']=float(.5*se[i]+.5*sh[i])
built.sort(key=lambda z:(z['rankScore'],-z['disagreement']),reverse=True)
for i,x in enumerate(built,1):x['rank']=i
items=[];cache={};healthy=raw.get('richHealthStatus')=='PASS'
for x in built:
    dilution=bool(x['t'].get('recentDilutionFiling'));cat=x['t'].get('catalystShadow') or {}
    if not active:state='CLOSED'
    elif not healthy:state='BLOCKED_DATA'
    elif x['rank']==1:state='LEAD_RISK_BLOCKED' if dilution else 'LEAD'
    elif x['rank']<=3:state='SHORTLIST_RISK_BLOCKED' if dilution else 'SHORTLIST'
    elif x['rank']<=10:state='RADAR'
    else:state='ABSTAIN'
    items.append({'symbol':x['symbol'],'state':state,'rank':x['rank'],'rankScorePct':round(x['rankScore']*100,2),'modelDisagreement':round(x['disagreement'],4),'rawRelevanceScore':round(x['rawRelevance'],4),
                  'dayChangePct':round(x['change'],2),'riskOverlay':'DILUTION_BLOCK' if dilution else 'CLEAR','catalystSideEvidence':cat or None,
                  'interpretation':'RELATIVE_RANK_NOT_SUCCESS_PROBABILITY','policy':'SHADOW_ONLY'})
    cache[x['symbol']]={'ts':now,'day':day,'session':session,'price':x['price'],'rvol':x['rvol'],'volume':x['volume'],'volumeVelocity':x['vv'],'rank':x['rank'],'rankScore':x['rankScore'],'history':x['history'][-4:]}
payload={'schemaVersion':3,'source':'TAGit v3 graded relevance + pairwise discovery ranker','modelTrainedAtUTC':art.get('trainedAtUTC'),'updatedAt':asof,'status':'PASS' if healthy else 'DEGRADED','session':session,
         'objective':art.get('objective'),'domainPolicy':{'maxPriceUsd':MAX_PRICE,'maxMarketCapUsd':MAX_CAP,'unknownMarketCap':'ALLOW_AS_UNKNOWN','excludedRows':excluded},
         'scoreMeaning':'RELATIVE_RANK_NOT_CALIBRATED_PROBABILITY','policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,
         'counts':{'total':len(items),'lead':sum(z['state'] in ('LEAD','LEAD_RISK_BLOCKED') for z in items),'shortlist':sum(z['state'].startswith('SHORTLIST') for z in items),'radar':sum(z['state']=='RADAR' for z in items)},
         'items':items[:100],'stateCache':cache}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in payload.items() if k not in ('items','stateCache')},indent=2))
