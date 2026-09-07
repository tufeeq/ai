#!/usr/bin/env python3
"""Score current Finviz Elite rich feed with TAGit v4 live21 SHADOW ranker.

Exact live feature contract mirrors v3.10 live21. Output is relative discovery rank
and research event evidence only. It never overrides the champion and never verifies
execution because bid/ask is not part of this model.
"""
import json,math,pathlib
from datetime import datetime,timezone
import joblib
import numpy as np

RAW=pathlib.Path('tag/data/finviz-rich.json')
MODEL=pathlib.Path('tag/model/tagit-v4-live-compatible.joblib')
OUT=pathlib.Path('tag/data/tagit-v4-shadow.json')
EXPECTED='19277cfddc8dbeaebee73ce70a6e6fad57213caae87959da7f3e5e859a88773b'
SELECTED={'topK':20,'minEnsemble':.50,'maxDisagreement':.40}


def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def q(v,d=0.0):
    try:return float(v) if finite(v) else d
    except:return d

def read(p,d):
    try:return json.loads(p.read_text())
    except:return d

def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)
def scode(s):
    s=str(s or '').lower()
    return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))
def degraded(reason,raw=None):
    p={'schemaVersion':4,'source':'TAGit v4 live21 shadow ranker','updatedAt':datetime.now(timezone.utc).isoformat(),'status':'DEGRADED','reason':reason,
       'session':(raw or {}).get('session'),'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,'executionVerified':False,
       'scoreMeaning':'RELATIVE_RANK_NOT_CALIBRATED_SUCCESS_PROBABILITY','counts':{'total':0,'selectedGate':0,'lead':0,'shortlist':0,'radar':0},'items':[],'stateCache':{}}
    OUT.write_text(json.dumps(p,indent=2)+'\n');print(json.dumps({k:v for k,v in p.items() if k not in ('items','stateCache')},indent=2))

raw=read(RAW,{})
if not raw or not MODEL.exists(): degraded('MODEL_OR_RICH_INPUT_MISSING',raw);raise SystemExit(0)
try: art=joblib.load(MODEL)
except Exception as e: degraded(f'MODEL_LOAD_FAILED:{type(e).__name__}',raw);raise SystemExit(0)
if art.get('policy')!='SHADOW_ONLY_NO_CHAMPION_OVERRIDE' or art.get('datasetSha256')!=EXPECTED or art.get('featureCount')!=21:
    degraded('MODEL_CONTRACT_MISMATCH',raw);raise SystemExit(0)

prev=read(OUT,{}); cache0=prev.get('stateCache') or {}
asof=raw.get('updatedAt') or datetime.now(timezone.utc).isoformat();day=asof[:10];session=str(raw.get('session') or 'unknown').lower();active=session in ('pre-market','regular','after-hours')
try:now=datetime.fromisoformat(asof.replace('Z','+00:00')).timestamp()*1000
except:now=datetime.now(timezone.utc).timestamp()*1000

# Field-level eligibility exactly mirrors the historical live21 domain.
elig=[];excluded={'domain':0,'missingMomentum':0,'missingCore':0}
for r in raw.get('rows') or []:
    t=r.get('_tagit') or {}; sym=str(r.get('Ticker') or '').strip().upper(); price=t.get('price');ch=t.get('dayChangePct');vol=t.get('volume')
    if not sym or not finite(price) or not finite(ch) or not finite(vol):excluded['missingCore']+=1;continue
    price=float(price);ch=float(ch);vol=float(vol)
    if not (.15<=price<=20) or not (-20<=ch<10):excluded['domain']+=1;continue
    mom=t.get('momentumPct') or {}
    if not all(finite(mom.get(str(k))) for k in (5,10,30,60)):excluded['missingMomentum']+=1;continue
    elig.append({'r':r,'t':t,'symbol':sym,'price':price,'change':ch,'volume':vol,'mom':mom})

if not elig:
    p={'schemaVersion':4,'source':'TAGit v4 live21 shadow ranker','modelVersion':art.get('modelVersion'),'modelTrainedAtUTC':art.get('trainedAtUTC'),'datasetSha256':EXPECTED,'updatedAt':asof,
       'status':'PASS' if raw.get('richHealthStatus')=='PASS' else 'DEGRADED','session':session,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,'executionVerified':False,
       'scoreMeaning':'RELATIVE_RANK_NOT_CALIBRATED_SUCCESS_PROBABILITY','selectedGate':SELECTED,'excludedRows':excluded,'counts':{'total':0,'selectedGate':0,'lead':0,'shortlist':0,'radar':0},'items':[],'stateCache':{}}
    OUT.write_text(json.dumps(p,indent=2)+'\n');print(json.dumps(p,indent=2));raise SystemExit(0)

cr=rank01([x['change'] for x in elig]);vr=rank01([x['volume'] for x in elig])
built=[]
for i,x in enumerate(elig):
    r=x['r'];t=x['t'];sym=x['symbol'];price=x['price'];ch=x['change'];vol=x['volume'];mom=x['mom'];signals=r.get('_signals') or []
    pm=cache0.get(sym) or {};same=pm.get('day')==day and finite(pm.get('ts'))
    first_ts=q(pm.get('firstTs'),now) if same else now; first_ch=q(pm.get('firstChange'),ch) if same else ch
    dt=(now-q(pm.get('ts')))/60000 if same else None
    pvel=cvel=vvel=vacc=0.0;progress_parts=[]
    if dt and 0<dt<=120 and finite(pm.get('price')) and finite(pm.get('change')) and finite(pm.get('volume')):
        pvel=((price/q(pm['price'])-1)*100)/dt*10 if q(pm['price'])>0 else 0.0
        cvel=(ch-q(pm['change']))/dt*10
        vvel=max(0.0,vol-q(pm['volume']))/dt*10
        if finite(pm.get('rawVvel')):vacc=(vvel-q(pm['rawVvel']))/(abs(q(pm['rawVvel']))+1)
        progress_parts=[pvel>0,cvel>0,vacc>0,float(mom['5'])>0]
    age=max(0,(now-first_ts)/60000)
    s=scode(session)
    feat=[math.log(max(price,.001)),ch/20,math.log1p(max(0,vol))/20,float(cr[i]),float(vr[i]),
          1.0 if 'ta_topgainers' in signals else 0.0,1.0 if 'ta_unusualvolume' in signals else 0.0,1.0 if 'ta_mostactive' in signals else 0.0,
          1.0 if s==0 else 0.0,1.0 if s==1 else 0.0,1.0 if s==2 else 0.0,
          pvel/5,cvel/5,math.log1p(max(0,vvel))/15,max(-3,min(3,vacc)),age/390,(ch-first_ch)/20,
          float(mom['5'])/10,float(mom['10'])/10,float(mom['30'])/20,float(mom['60'])/30]
    progression=bool(same and sum(progress_parts)>=2)
    built.append({**x,'features':feat,'pvel':pvel,'cvel':cvel,'rawVvel':vvel,'vacc':vacc,'firstTs':first_ts,'firstChange':first_ch,'progressionSeen':progression})

X=np.asarray([x['features'] for x in built],float)
et=art['extraTrees'].predict_proba(X)[:,1];hg=art['histGradientBoosting'].predict_proba(X)[:,1];lr=art['logistic'].predict_proba(art['scaler'].transform(X))[:,1]
er,hr,rr=rank01(et),rank01(hg),rank01(lr)
for i,x in enumerate(built):
    vals=np.asarray([er[i],hr[i],rr[i]]);x['ensemble']=float(.42*vals[0]+.38*vals[1]+.20*vals[2]);x['disagreement']=float(np.std(vals));x['rawModels']={'extraTrees':float(et[i]),'histGradientBoosting':float(hg[i]),'logistic':float(lr[i])}
built.sort(key=lambda z:(z['ensemble'],-z['disagreement']),reverse=True)
for i,x in enumerate(built,1):x['rank']=i

healthy=raw.get('richHealthStatus')=='PASS';items=[];cache={}
for x in built:
    selected=x['rank']<=SELECTED['topK'] and x['ensemble']>=SELECTED['minEnsemble'] and x['disagreement']<=SELECTED['maxDisagreement']
    if not active:shadow='CLOSED'
    elif not healthy:shadow='BLOCKED_DATA'
    elif x['rank']<=3:shadow='LEAD'
    elif x['rank']<=10:shadow='SHORTLIST'
    elif x['rank']<=20:shadow='RADAR'
    else:shadow='ABSTAIN'
    s=scode(session)
    if not selected:event='NO_EVENT_GATE'
    elif s==0:event='PRE_FIRST_EVENT_RESEARCH_ELIGIBLE'
    elif s==1:event='REGULAR_PROGRESSION_CANDIDATE' if x['progressionSeen'] else 'REGULAR_REQUIRE_PROGRESSION'
    elif s==2:event='AFTER_HOURS_INFORMATIONAL_ONLY'
    else:event='INACTIVE_SESSION'
    t=x['t'];cat={k:t.get(k) for k in ('catalystType','catalystPolarity','catalystMateriality','catalystConfidence') if t.get(k) is not None}
    risk=[]
    if t.get('recentDilutionFiling'):risk.append('RECENT_DILUTION_FILING')
    items.append({'symbol':x['symbol'],'shadowState':shadow,'rank':x['rank'],'rankScorePct':round(x['ensemble']*100,2),'modelDisagreement':round(x['disagreement'],4),'shadowGatePassed':selected,
                  'eventPolicy':event,'progressionSeen':x['progressionSeen'],'dayChangePct':round(x['change'],2),'momentum5mPct':round(float(x['mom']['5']),2),'momentum10mPct':round(float(x['mom']['10']),2),
                  'riskContext':risk or None,'catalystContext':cat or None,'executionVerified':False,'interpretation':'RELATIVE_RANK_NOT_SUCCESS_PROBABILITY','policy':'SHADOW_ONLY'})
    cache[x['symbol']]={'ts':now,'day':day,'price':x['price'],'change':x['change'],'volume':x['volume'],'rawVvel':x['rawVvel'],'firstTs':x['firstTs'],'firstChange':x['firstChange'],'rank':x['rank'],'rankScore':x['ensemble']}

payload={'schemaVersion':4,'source':'TAGit v4 live21 causal shadow ranker','modelVersion':art.get('modelVersion'),'modelTrainedAtUTC':art.get('trainedAtUTC'),'datasetSha256':EXPECTED,'updatedAt':asof,'status':'PASS' if healthy else 'DEGRADED','session':session,
         'objective':art.get('objective'),'featureCount':21,'featureParity':'LIVE21_VERIFIED_ON_FROZEN_V310','scoreMeaning':'RELATIVE_RANK_NOT_CALIBRATED_SUCCESS_PROBABILITY','selectedGate':SELECTED,
         'eventPolicyNotes':{'pre':'first selected event may be surfaced for forward research','regular':'selected rank still requires progression evidence before event surfacing','after':'informational only due low historical support'},
         'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,'executionVerified':False,'excludedRows':excluded,
         'counts':{'total':len(items),'selectedGate':sum(bool(z['shadowGatePassed']) for z in items),'lead':sum(z['shadowState']=='LEAD' for z in items),'shortlist':sum(z['shadowState']=='SHORTLIST' for z in items),'radar':sum(z['shadowState']=='RADAR' for z in items)},
         'items':items[:100],'stateCache':cache}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in payload.items() if k not in ('items','stateCache')},indent=2))
