#!/usr/bin/env python3
"""TAGit v5.15 immutable forward scorer.

Scores only a same-day v5.13 point-in-time capture with the hash-addressed v5.14
executable model. It never attaches outcomes, never scores a pre-freeze capture,
and never rewrites an existing day/model prediction. Feature construction exactly
matches the v5.12.2 feed-aware 09:15 ET pipeline.
"""
import argparse, base64, hashlib, json, math, pickle, time, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np

ROOT=Path('tag/data'); MODEL=ROOT/'tagit-v514-frozen-model.json'; CAP=ROOT/'tagit-v513-preopen-forward-ledger.json'; OUT=ROOT/'tagit-v515-forward-predictions.json'
NY=ZoneInfo('America/New_York'); CUTOFF=9*60+15; OPEN=9*60+30
UA={'User-Agent':'Mozilla/5.0 TAGit-v5.15-forward-validation'}
EXPECTED=['gap','preReturn','preRange','preClosePosition','preVwapDistance','logPreVolume','logDollarVolume','r5','r15','r30','preCompression','preRvol','preVolumeAccel','priorDayReturn','priorDayRange','priorDayClosePosition','logPriorDayVolume','priorVolumeAccel','preBarCount','minutesFromLastBarToCutoff','preVolumeObserved']

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def ret(a,b): return (a/b-1)*100 if a and b else 0.0

def fetch(sym,retries=3):
    q=urllib.parse.quote(sym,safe=''); err=None
    for k in range(retries):
      for host in ('query2.finance.yahoo.com','query1.finance.yahoo.com'):
        u=f'https://{host}/v8/finance/chart/{q}?range=60d&interval=5m&includePrePost=true&events=div%2Csplits'
        try:
          req=urllib.request.Request(u,headers=UA)
          with urllib.request.urlopen(req,timeout=20) as r:d=json.loads(r.read().decode())
          z=((d.get('chart') or {}).get('result') or [None])[0]
          if not z:continue
          ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
          O=qq.get('open') or [];H=qq.get('high') or [];L=qq.get('low') or [];C=qq.get('close') or [];V=qq.get('volume') or []
          out=[]
          for i,t in enumerate(ts):
            if i>=len(C) or C[i] is None:continue
            c=float(C[i]); o=float(O[i] if i<len(O) and O[i] is not None else c); h=float(H[i] if i<len(H) and H[i] is not None else c); l=float(L[i] if i<len(L) and L[i] is not None else c); v=float(V[i] if i<len(V) and V[i] is not None else 0)
            if c>0:out.append({'t':int(t),'dt':datetime.fromtimestamp(int(t),timezone.utc).astimezone(NY),'o':o,'h':h,'l':l,'c':c,'v':max(v,0.0)})
          if out:return out,None
        except Exception as e:err=f'{type(e).__name__}:{e}'
      time.sleep(.4*(k+1))
    return [],err or 'EMPTY'

def feature_for_day(bars, day):
    """Build target-day features strictly from bars <=09:15 ET plus completed prior sessions.

    Important: target day is evaluated BEFORE the completed-regular-session gate; at
    pre-open time it correctly has no regular bars yet. Prior days are appended only
    after a complete/non-empty regular-session slice exists.
    """
    by=defaultdict(list)
    for z in bars:by[z['dt'].date().isoformat()].append(z)
    completed=[]
    for d in sorted(by):
      a=sorted(by[d],key=lambda x:x['t'])
      pre=[x for x in a if 4*60<=x['dt'].hour*60+x['dt'].minute<=CUTOFF]
      if d==day:
        if len(completed)<2:return None,'INSUFFICIENT_PRIOR_DAYS'
        if not pre:return None,'NO_PREMARKET_BAR_AT_OR_BEFORE_CUTOFF'
        p1=completed[-1]['reg']; p2=completed[-2]['reg']; x=pre[-1]; c=x['c']; pv=sum(z['v'] for z in pre); prev_close=p1[-1]['c']
        if not (.15<=c<=30):return None,'PRICE_GATE'
        p1d=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in p1)
        if p1d<100000:return None,'PRIOR_REGULAR_LIQUIDITY_GATE'
        def ago(minutes):
          cand=[z for z in pre if z['t']<=x['t']-minutes*60]; return cand[-1]['c'] if cand else pre[0]['c']
        ph=max(z['h'] for z in pre); pl=min(z['l'] for z in pre); cp=(c-pl)/(ph-pl) if ph>pl else .5
        typnum=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in pre); vwap=typnum/pv if pv else c
        prior_pre=[sum(z['v'] for z in q['pre']) for q in completed[-20:] if q['pre'] and sum(z['v'] for z in q['pre'])>0]
        medpv=float(np.median(prior_pre)) if prior_pre else max(pv,1); pvf=pv if pv>0 else medpv; prv=pvf/max(medpv,1)
        recent=pre[-7:]; comp=ret(max(z['h'] for z in recent),min(z['l'] for z in recent)) if recent else 0
        early=sum(z['v'] for z in pre[:-3]); vacc=pv/max(early,1) if early>0 else 1.0
        p1h=max(z['h'] for z in p1); p1l=min(z['l'] for z in p1); p1c=p1[-1]['c']; p1v=sum(z['v'] for z in p1); p2v=sum(z['v'] for z in p2); p1cp=(p1c-p1l)/(p1h-p1l) if p1h>p1l else .5
        preopen=pre[0]['o']; lastmin=x['dt'].hour*60+x['dt'].minute
        feat=[ret(c,prev_close)/20,ret(c,preopen)/15,ret(ph,pl)/20,cp,ret(c,vwap)/10,math.log1p(pvf)/20,math.log1p(c*pvf)/20,ret(c,ago(5))/10,ret(c,ago(15))/15,ret(c,ago(30))/20,comp/15,math.log1p(max(prv,0))/3,math.log1p(max(vacc,0))/3,ret(p1c,p2[-1]['c'])/30,ret(p1h,p1l)/30,p1cp,math.log1p(p1v)/20,math.log1p(max(p1v/max(p2v,1),0))/3,min(len(pre),64)/64,max(0,CUTOFF-lastmin)/315,float(pv>0)]
        return {'feat':feat,'decisionBarUTC':datetime.fromtimestamp(x['t'],timezone.utc).isoformat(),'decisionBarET':x['dt'].isoformat(),'priceAtDecision':c,'preRvol':prv,'preVolumeObserved':bool(pv>0)},None
      reg=[x for x in a if OPEN<=x['dt'].hour*60+x['dt'].minute<16*60]
      if not reg:continue
      completed.append({'day':d,'reg':reg,'pre':pre}); completed=completed[-22:]
    return None,'TARGET_DAY_NOT_IN_FEED'

def load_model():
    a=readj(MODEL,{})
    assert a.get('schemaVersion')=='5.14-forward-only-frozen-model'
    assert a.get('featureNames')==EXPECTED, 'feature schema drift'
    raw=base64.b64decode(a['modelPayloadBase64']); assert hashlib.sha256(raw).hexdigest()==a['modelPayloadSha256'], 'model hash mismatch'
    p=pickle.loads(raw); return a,p['classifierEnsemble'],p['upsideRegressorEnsemble']

def score(mc,mr,feat):
    X=np.asarray([feat],float); Xs=mc[0].transform(X)
    ps=np.asarray([mc[1].predict_proba(X)[0,1],mc[2].predict_proba(X)[0,1],mc[3].predict_proba(Xs)[0,1]],float)
    s=float(.45*ps[0]+.40*ps[1]+.15*ps[2]); dis=float(np.std(ps)); up=float(.55*mr[0].predict(X)[0]+.45*mr[1].predict(X)[0])
    return s,dis,up

def self_test():
    a,mc,mr=load_model(); assert a['historicalHoldoutConsumed'] is True and a['mayRetuneFromForwardOutcomes'] is False
    assert len(a['featureNames'])==21
    # Synthetic timing guard: current target day may contain only premarket bars.
    target='2026-09-08'; bars=[]
    for day,base in [('2026-09-04',1.0),('2026-09-05',1.1)]:
      # Two prior completed regular bars each are enough to exercise sequencing.
      for hh,mm,c,v in [(9,30,base,200000),(15,55,base*1.02,200000)]:
        dt=datetime.fromisoformat(f'{day}T{hh:02d}:{mm:02d}:00').replace(tzinfo=NY); bars.append({'t':int(dt.timestamp()),'dt':dt,'o':c,'h':c*1.01,'l':c*.99,'c':c,'v':v})
    dt=datetime.fromisoformat(target+'T09:15:00').replace(tzinfo=NY); bars.append({'t':int(dt.timestamp()),'dt':dt,'o':1.2,'h':1.25,'l':1.18,'c':1.23,'v':100000})
    f,reason=feature_for_day(bars,target); assert f is not None, reason
    assert f['decisionBarET'].startswith(target)
    print('v5.15 model/schema/hash/timing self-test: OK')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--self-test',action='store_true'); ap.add_argument('--dry-run',action='store_true'); args=ap.parse_args()
    if args.self_test:self_test(); return
    now=datetime.now(timezone.utc); et=now.astimezone(NY); minute=et.hour*60+et.minute; today=et.date().isoformat()
    if not args.dry_run and not (550<=minute<=565): raise SystemExit(f'forward scoring refused outside 09:10-09:25 ET: {et:%H:%M}')
    art,mc,mr=load_model(); frozen=datetime.fromisoformat(art['frozenAtUTC'].replace('Z','+00:00'))
    if now<=frozen or today<=art['trainingCutoffDate']: raise SystemExit('forward evidence must be strictly post-freeze and post-training-cutoff')
    led=readj(CAP,{}); candidates=[c for c in led.get('captures') or [] if str(c.get('capturedAtET',''))[:10]==today and c.get('status')=='ELIGIBLE' and c.get('pointInTime') is True and c.get('universeIntegrityEligible') is True]
    if not candidates: raise SystemExit('no same-day eligible point-in-time universe capture')
    cap=max(candidates,key=lambda c:c.get('capturedAtUTC','')); captured=datetime.fromisoformat(cap['capturedAtUTC'].replace('Z','+00:00'))
    if captured<=frozen: raise SystemExit('pre-freeze capture cannot be forward scored')
    out=readj(OUT,{'schemaVersion':'5.15-forward-predictions','policy':'APPEND_ONLY_PREDICTIONS_BEFORE_OUTCOMES_NO_RETROSPECTIVE_SCORING','predictions':[]})
    key=today+'|'+art['modelPayloadSha256']; seen={x.get('predictionSetId') for x in out.get('predictions') or []}
    if key in seen: print(json.dumps({'status':'ALREADY_FROZEN','predictionSetId':key})); return
    rows=[]; errors={}; cfg=art['selectedConfig']
    for r in cap.get('rows') or []:
      sym=r.get('ticker'); bars,err=fetch(sym)
      if err:errors[sym]=err; continue
      f,reason=feature_for_day(bars,today)
      if not f: errors[sym]=reason; continue
      s,d,u=score(mc,mr,f['feat']); selected=bool(s>=cfg['minScore'] and d<=cfg['maxDisagreement'] and u>=cfg['minPredUpside'])
      rows.append({'ticker':sym,'score':s,'disagreement':d,'predictedUpsidePct':u,'selected':selected,'rank':None,**{k:v for k,v in f.items() if k!='feat'},'featureVector':f['feat']})
    ranked=sorted(rows,key=lambda x:(x['selected'],x['score'],x['predictedUpsidePct']),reverse=True)
    for i,r in enumerate(ranked,1):r['rank']=i
    entry={'predictionSetId':key,'predictionFrozenAtUTC':now.isoformat(),'predictionFrozenAtET':et.isoformat(),'targetCutoffET':'09:15','captureId':cap['captureId'],'captureTimestampUTC':cap['capturedAtUTC'],'modelPayloadSha256':art['modelPayloadSha256'],'featurePipelineSourceSha256':art['featurePipelineSourceSha256'],'trainingCutoffDate':art['trainingCutoffDate'],'selectedConfig':cfg,'universeCount':cap['universeCount'],'scoredCount':len(rows),'selectedCount':sum(r['selected'] for r in rows),'coveragePct':round(100*len(rows)/max(1,cap['universeCount']),2),'universeIntegrityEligible':True,'contextIntegrityEligible':cap.get('contextIntegrityEligible',False),'labelsPresent':False,'outcomesPresent':False,'errors':errors,'rows':ranked}
    print(json.dumps({**entry,'rows':f'<{len(rows)} scored rows>'},indent=2))
    if args.dry_run:return
    out.setdefault('predictions',[]).append(entry); OUT.write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()
