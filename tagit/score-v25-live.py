#!/usr/bin/env python3
import json, math, pathlib
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.neighbors import NearestNeighbors

RAW=pathlib.Path('tag/data/finviz-rich.json')
MODEL=pathlib.Path('tag/model/tagit-v25-production.joblib')
OUT=pathlib.Path('tag/data/tagit-v25-shadow.json')

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def q(v,d=0.0):return float(v) if finite(v) else d
def slog(v):return math.log1p(max(0,q(v))) if finite(v) else 0.0
def clamp(v,a=0,b=1):return max(a,min(b,v))
def skey(s):
    s=str(s or '').lower()
    return 'pre' if 'pre' in s else ('regular' if s=='regular' else ('after' if 'after' in s else 'other'))
def pct(anchor,v):
    a=np.asarray(anchor,dtype=float)
    return float(np.searchsorted(a,float(v),side='right')/len(a)) if len(a) else 0.0
def read(p,d):
    try:return json.loads(p.read_text())
    except:return d

def write_degraded(reason,raw=None):
    payload={'schemaVersion':1,'source':'TAGit v2.5 shadow scorer','updatedAt':datetime.now(timezone.utc).isoformat(),'status':'DEGRADED','reason':reason,'session':(raw or {}).get('session'),'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','counts':{'total':0,'radar':0,'discover':0,'alert':0},'items':[],'stateCache':{}}
    OUT.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(payload,indent=2));return

raw=read(RAW,{})
if not raw or not MODEL.exists():
    write_degraded('MODEL_OR_RICH_INPUT_MISSING',raw);raise SystemExit(0)
try:art=joblib.load(MODEL)
except Exception as e:
    write_degraded(f'MODEL_LOAD_FAILED:{type(e).__name__}',raw);raise SystemExit(0)
prev=read(OUT,{})
prev_cache=prev.get('stateCache') or {}
rows=raw.get('rows') or []
asof=raw.get('updatedAt') or datetime.now(timezone.utc).isoformat();day=asof[:10];session=str(raw.get('session') or 'unknown').lower();sess=skey(session)
try:cur_ts=datetime.fromisoformat(asof.replace('Z','+00:00')).timestamp()*1000
except:cur_ts=datetime.now(timezone.utc).timestamp()*1000

built=[]
for r in rows:
    t=r.get('_tagit') or {};sym=str(r.get('Ticker') or '').upper();price=q(t.get('price'),None) if finite(t.get('price')) else None
    if not sym or price is None or price<.15:continue
    change=q(t.get('dayChangePct'));rvol=t.get('relativeVolume');vol=t.get('volume');avg=t.get('averageVolumeShares');pm=prev_cache.get(sym) or {}
    same=pm.get('day')==day and pm.get('session')==session and finite(pm.get('ts'))
    dt=(cur_ts-q(pm.get('ts')))/60000 if same else None
    vv=rdelta=vvdelta=None
    if same and dt and 0<dt<=90:
        if finite(rvol) and finite(pm.get('rvol')):rdelta=(q(rvol)-q(pm.get('rvol')))/dt
        if finite(vol) and finite(pm.get('volume')) and finite(avg) and q(vol)>=q(pm.get('volume')) and q(avg)>0:
            ex=q(avg)/390*dt
            if ex>0:vv=(q(vol)-q(pm.get('volume')))/ex
        if finite(vv) and finite(pm.get('volumeVelocity')):vvdelta=(q(vv)-q(pm.get('volumeVelocity')))/max(dt,1)
    mom=t.get('momentumPct') or {};m5=mom.get('5');m10=mom.get('10');m30=mom.get('30');m60=mom.get('60')
    short=t.get('shortMomentumRatePctPerMin')
    turn=q(m5)-q(m30)/6 if finite(m5) and finite(m30) else 0
    curv=q(m5)-q(m10)/2 if finite(m5) and finite(m10) else 0
    lcurv=q(m10)-q(m30)/3 if finite(m10) and finite(m30) else 0
    quiet=1 if abs(q(m30))<4 and abs(change)<10 else 0
    hist=list(pm.get('history') or [])[-3:]+[{'price':price,'rvol':q(rvol,None) if finite(rvol) else None}]
    pos_steps=sum(1 for i in range(1,len(hist)) if finite(hist[i].get('price')) and finite(hist[i-1].get('price')) and q(hist[i].get('price'))>q(hist[i-1].get('price')))
    rvol_up=sum(1 for i in range(1,len(hist)) if finite(hist[i].get('rvol')) and finite(hist[i-1].get('rvol')) and q(hist[i].get('rvol'))>q(hist[i-1].get('rvol')))
    feat=[change,slog(rvol),slog(vv),q(short),q(rdelta),q(vvdelta),q(m5),q(m10),q(m30),q(m60),q(turn),q(curv),q(lcurv),quiet,pos_steps,rvol_up,slog(t.get('dollarVolume')),slog(t.get('floatShares')),q(t.get('floatRotation')),q(t.get('gapPct')),q(t.get('sma20Pct')),q(t.get('perfWeekPct'))]
    if not (-20<=change<10):continue
    built.append({'symbol':sym,'r':r,'t':t,'features':feat,'history':hist,'price':price,'change':change,'rvol':q(rvol,None) if finite(rvol) else None,'volume':q(vol,None) if finite(vol) else None,'volumeVelocity':q(vv,None) if finite(vv) else None})

if not built:
    payload={'schemaVersion':1,'source':'TAGit v2.5 shadow scorer','updatedAt':asof,'status':'PASS','session':session,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','counts':{'total':0,'radar':0,'discover':0,'alert':0},'items':[],'stateCache':{}}
    OUT.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(payload,indent=2));raise SystemExit(0)
X=np.asarray([x['features'] for x in built],dtype=float);Xs=art['scaler'].transform(X)
pe=art['extraTrees'].predict_proba(X)[:,1];ph=art['histGradientBoosting'].predict_proba(X)[:,1];pl=art['logistic'].predict_proba(Xs)[:,1]
knn=NearestNeighbors(n_neighbors=min(61,len(art['XScaled'])),metric='euclidean').fit(art['XScaled']);dist,idx=knn.kneighbors(Xs);y=np.asarray(art['y'])
analog=[]
for ds,ids in zip(dist,idx):
    w=1/(ds+.35);analog.append(float((w*y[ids]).sum()/max(1e-12,w.sum())))
analog=np.asarray(analog)

def anchored(kind,v):
    aa=art['anchors'][kind];a=aa.get(sess) if sess in aa and len(aa[sess])>=100 else aa['global'];return pct(a,v)
for x,a,b,c,d in zip(built,pe,ph,pl,analog):
    pa,pb,pc,pd=anchored('et',a),anchored('hgb',b),anchored('lr',c),anchored('analog',d)
    x['pET']=pa;x['pHGB']=pb;x['pLR']=pc;x['analogRate']=float(d);x['analogPct']=pd;x['ensemble']=.34*pa+.34*pb+.20*pc+.12*pd;x['disagreement']=float(np.std([pa,pb,pc]))
built.sort(key=lambda x:x['ensemble'],reverse=True)
for i,x in enumerate(built,1):x['rank']=i
ens=[x['ensemble'] for x in built];top3=sum(ens[:3])/max(1,len(ens[:3]));high=min(1,sum(1 for z in ens if z>=.90)/5)
rvol_hot=sum(1 for x in built if x['features'][1]>=math.log1p(3))/len(built);vv_hot=sum(1 for x in built if x['features'][2]>=math.log1p(1.5))/len(built);m5_hot=sum(1 for x in built if x['features'][6]>=.5)/len(built);quiet_hot=sum(1 for x in built if x['features'][13]>=1 and x['features'][1]>=math.log1p(2))/len(built)
heat=clamp(.34*top3+.22*high+.12*min(1,rvol_hot*8)+.12*min(1,vv_hot*8)+.10*min(1,m5_hot*8)+.10*min(1,quiet_hot*8))
cfg=art.get('alertConfig') or {};active=session in ('pre-market','regular','after-hours');healthy=raw.get('richHealthStatus')=='PASS'
items=[];cache={}
for x in built:
    pm=prev_cache.get(x['symbol']) or {};same=pm.get('day')==day and pm.get('session')==session and finite(pm.get('ts'));dt=(cur_ts-q(pm.get('ts')))/60000 if same else None
    persistent=bool(same and dt and 0<dt<=90 and q(pm.get('rank'),999)<=10 and q(pm.get('ensemble'))>=.78 and x['ensemble']>=q(pm.get('ensemble'))-.08)
    radar=x['rank']<=15 and x['ensemble']>=.70
    discover=x['rank']<=5 and x['ensemble']>=.88 and heat>=.55
    alert=x['rank']<=cfg.get('topK',5) and x['ensemble']>=cfg.get('minEnsemble',.98) and x['disagreement']<=cfg.get('maxDisagreement',.08) and x['analogRate']>=cfg.get('minAnalogRate',.04) and heat>=cfg.get('minMarketHeat',.45) and (persistent if cfg.get('requirePersistence') else True)
    dilution=bool(x['t'].get('recentDilutionFiling'));risk_overlay='DILUTION_BLOCK' if dilution else 'CLEAR'
    if not active:state='CLOSED'
    elif not healthy:state='BLOCKED_DATA'
    elif alert and dilution:state='ALERT_RISK_BLOCKED'
    elif alert:state='ALERT'
    elif discover:state='DISCOVER'
    elif radar:state='RADAR'
    else:state='ABSTAIN'
    items.append({'symbol':x['symbol'],'state':state,'rank':x['rank'],'ensembleScore':round(x['ensemble']*100,2),'modelDisagreement':round(x['disagreement'],4),'analogRatePct':round(x['analogRate']*100,2),'marketHeatPct':round(heat*100,2),'persistent':persistent,'riskOverlay':risk_overlay,'latestNewsPresent':bool(x['t'].get('latestNewsTitle')),'dayChangePct':round(x['change'],2),'policy':'SHADOW_ONLY'})
    cache[x['symbol']]={'ts':cur_ts,'day':day,'session':session,'price':x['price'],'rvol':x['rvol'],'volume':x['volume'],'volumeVelocity':x['volumeVelocity'],'ensemble':x['ensemble'],'rank':x['rank'],'history':x['history'][-4:]}
items.sort(key=lambda z:({'ALERT':6,'ALERT_RISK_BLOCKED':5,'DISCOVER':4,'RADAR':3,'ABSTAIN':2,'BLOCKED_DATA':1,'CLOSED':0}.get(z['state'],0),z['ensembleScore']),reverse=True)
payload={'schemaVersion':1,'source':'TAGit v2.5 leak-free hierarchical model','modelTrainedAtUTC':art.get('trainedAtUTC'),'updatedAt':asof,'status':'PASS' if healthy else 'DEGRADED','session':session,'marketHeatPct':round(heat*100,2),'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,'counts':{'total':len(items),'radar':sum(z['state']=='RADAR' for z in items),'discover':sum(z['state']=='DISCOVER' for z in items),'alert':sum(z['state']=='ALERT' for z in items),'riskBlocked':sum(z['state']=='ALERT_RISK_BLOCKED' for z in items)},'items':items[:100],'stateCache':cache}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in payload.items() if k not in ('items','stateCache')},indent=2))
