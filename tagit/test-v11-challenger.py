#!/usr/bin/env python3
import json, math, pathlib, urllib.request, urllib.parse, concurrent.futures, datetime
import numpy as np, pandas as pd
from zoneinfo import ZoneInfo
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import RobustScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import precision_score, recall_score, fbeta_score

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'tag'/'data'; OUT=DATA/'tagit-v11-challenger-test.json'; MODEL=DATA/'tagit-v11-challenger-model.json'
ET=ZoneInfo('America/New_York')

def load(p):
    try:return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    except:return {}
def sym(r):return str((r or {}).get('ticker') or (r or {}).get('Ticker') or (r or {}).get('symbol') or (r or {}).get('Symbol') or '').upper().strip()
def universe():
    out=[]; seen=set()
    for p in [DATA/'finviz.json',DATA/'discovery-fast.json',DATA/'discovery.json',DATA/'live-quotes.json']:
        d=load(p); rows=[]
        q=d.get('quotes') or {}
        if isinstance(q,dict): rows += [{'ticker':k} for k in q]
        rr=d.get('rows') or d.get('data') or []
        rows += list(rr.values()) if isinstance(rr,dict) else rr
        for r in rows:
            t=sym(r)
            if t and t not in seen and 1<=len(t)<=7 and t.replace('.','').replace('-','').isalnum():seen.add(t);out.append(t)
    return out[:320]
def fetch(t):
    try:
        u='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(t)+'?interval=5m&range=60d&includePrePost=false&events=div%2Csplits'
        req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 TAGit-V11-Test','Accept':'application/json'})
        with urllib.request.urlopen(req,timeout=8) as r:j=json.loads(r.read().decode())
        z=((j.get('chart') or {}).get('result') or [None])[0]
        if not z:return t,None
        ts=z.get('timestamp') or []; q=((z.get('indicators') or {}).get('quote') or [{}])[0]
        vals=[]
        for i,x in enumerate(ts):
            c=(q.get('close') or []); h=(q.get('high') or []); l=(q.get('low') or []); v=(q.get('volume') or [])
            if i>=len(c) or c[i] is None:continue
            dt=datetime.datetime.fromtimestamp(x,datetime.timezone.utc).astimezone(ET)
            if dt.weekday()<5 and datetime.time(9,30)<=dt.time()<=datetime.time(16,0):
                vals.append((dt,float(h[i] or c[i]),float(l[i] or c[i]),float(c[i]),float(v[i] or 0)))
        return t,vals
    except Exception:return t,None

def build(raw):
    rows=[]
    for t,a in raw.items():
        bd={}
        for x in a:bd.setdefault(x[0].date(),[]).append(x)
        for day,rs in bd.items():
            rs=sorted(rs,key=lambda x:x[0])
            if len(rs)<36:continue
            hi=np.array([x[1] for x in rs]); lo=np.array([x[2] for x in rs]); cl=np.array([x[3] for x in rs]); vo=np.array([x[4] for x in rs])
            basev=max(1,float(np.median(vo[:min(12,len(vo))]) or 1))
            for i in range(6,len(rs)-12,2):
                px=cl[i]
                if not .08<=px<=80:continue
                daychg=(px/cl[0]-1)*100 if cl[0] else 0
                if not -5<=daychg<10:continue
                def ret(k):
                    j=max(0,i-k);return (px/cl[j]-1)*100 if cl[j] else 0
                r5=ret(1); r15=ret(3); r30=ret(6)
                w15=slice(max(0,i-2),i+1); w30=slice(max(0,i-5),i+1)
                rg15=(hi[w15].max()-lo[w15].min())/px*100; rg30=(hi[w30].max()-lo[w30].min())/px*100
                v15=vo[max(0,i-2):i+1].sum(); pv15=vo[max(0,i-5):max(0,i-2)].sum(); acc15=v15/pv15 if pv15>0 else 1
                v5=vo[i]; pv5=vo[i-1] if i else 0; acc5=v5/pv5 if pv5>0 else 1
                rv=float(np.mean(vo[max(0,i-5):i+1]))/basev
                sv=math.log1p(vo[:i+1].sum())
                pressure=(max(acc5-1,0)+.7*max(acc15-1,0)+.55*max(rv-1,0))/(1+max(rg15,0))
                quiet=(max(acc5,0)+.7*max(acc15,0)+.4*max(rv,0))*max(0,1-min(abs(r5)/2.5,1))
                volcomp=(max(acc15-1,0)+max(rv-1,0))/(1+rg15+0.35*rg30)
                late=max(daychg,0)/10.0
                future60=hi[i+1:min(len(hi),i+13)]
                futureday=hi[i+1:]
                f60=(future60.max()/px-1)*100 if len(future60) else 0
                fday=(futureday.max()/px-1)*100 if len(futureday) else 0
                y=int(f60>=8 or fday>=15)
                first_cross=None
                for j,h in enumerate(future60,1):
                    if (h/px-1)*100>=8:first_cross=j*5;break
                rows.append({'ticker':t,'day':str(day),'minute':i*5,'ret5':r5,'ret15':r15,'ret30':r30,'range15':rg15,'range30':rg30,'acc5':acc5,'acc15':acc15,'relVol':rv,'sessionVolLog':sv,'dayChange':daychg,'pressureCompression':pressure,'quietPressure':quiet,'volumeCompression':volcomp,'latePenalty':late,'label':y,'leadMinutes':first_cross})
    return pd.DataFrame(rows).replace([np.inf,-np.inf],np.nan).dropna(subset=['label'])

def choose_threshold(model,dv,F):
    p=model.predict_proba(dv[F])[:,1]; base=max(float(dv.label.mean()),1e-6); best=None
    for th in np.linspace(.20,.90,71):
        pred=p>=th; n=int(pred.sum())
        if n<30:continue
        pr=precision_score(dv.label,pred,zero_division=0); rc=recall_score(dv.label,pred,zero_division=0); f2=fbeta_score(dv.label,pred,beta=2,zero_division=0)
        # Favor recall but require useful enrichment and bounded alert rate.
        alert=n/len(dv)
        if pr < base*1.35 or alert>.18:continue
        score=f2 + .15*rc + .05*pr
        if best is None or score>best[0]:best=(score,float(th),pr,rc,f2,alert)
    return best

def metrics(model,df,F,th):
    p=model.predict_proba(df[F])[:,1]; pred=p>=th
    pr=precision_score(df.label,pred,zero_division=0);rc=recall_score(df.label,pred,zero_division=0);f2=fbeta_score(df.label,pred,beta=2,zero_division=0)
    pre5=df.dayChange<5; pos5=(df.label==1)&pre5
    pre5rec=float(((pred)&pos5).sum()/max(1,pos5.sum()))
    sel=df[pred]
    leads=[x for x in sel.loc[sel.label==1,'leadMinutes'].tolist() if pd.notna(x)]
    return {'rows':len(df),'positives':int(df.label.sum()),'selected':int(pred.sum()),'precisionPct':round(pr*100,2),'recallPct':round(rc*100,2),'f2':round(float(f2),4),'pre5RecallPct':round(pre5rec*100,2),'alertRatePct':round(float(pred.mean())*100,2),'medianLeadMin':round(float(np.median(leads)),1) if leads else None}

def export_logistic(pipe,F):
    scaler=pipe.named_steps['robustscaler']; lr=pipe.named_steps['logisticregression']
    # RobustScaler transform=(x-center)/scale; directly compatible with TAGit JSON normalizer.
    return {'features':F,'normalization':{k:{'median':float(scaler.center_[i]),'scale':float(max(scaler.scale_[i],1e-6))} for i,k in enumerate(F)},'weights':{k:float(lr.coef_[0][i]) for i,k in enumerate(F)},'bias':float(lr.intercept_[0])}

def main():
    syms=universe(); print('universe',len(syms))
    raw={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as ex:
        for t,a in ex.map(fetch,syms):
            if a and len(a)>200:raw[t]=a
    df=build(raw)
    days=sorted(df.day.unique())
    if len(days)<20 or len(df)<3000:raise SystemExit(f'insufficient historical support days={len(days)} rows={len(df)}')
    d1=days[int(len(days)*.60)]; d2=days[int(len(days)*.80)]
    tr=df[df.day<d1].copy();dv=df[(df.day>=d1)&(df.day<d2)].copy();ho=df[df.day>=d2].copy()
    BASE=['ret5','ret15','ret30','range15','acc15','relVol','sessionVolLog','dayChange','minute']
    CH=BASE+['range30','acc5','pressureCompression','quietPressure','volumeCompression','latePenalty']
    results={}; models={}; thresholds={}
    for name,F in [('baseline',BASE),('challenger',CH)]:
        m=make_pipeline(RobustScaler(),LogisticRegression(max_iter=1200,class_weight='balanced',C=.7,random_state=42))
        m.fit(tr[F],tr.label);pick=choose_threshold(m,dv,F)
        if not pick:raise SystemExit(name+' threshold selection failed')
        th=pick[1]; thresholds[name]=th;models[name]=m
        results[name]={'threshold':round(th,4),'development':metrics(m,dv,F,th),'holdout':metrics(m,ho,F,th)}
    b=results['baseline']['holdout'];c=results['challenger']['holdout']
    gates={
      'holdoutDaysAtLeast10':len(sorted(ho.day.unique()))>=10,
      'holdoutPositivesAtLeast100':c['positives']>=100,
      'pre5RecallNoWorse':c['pre5RecallPct']>=b['pre5RecallPct'],
      'overallRecallGain5pp':c['recallPct']>=b['recallPct']+5,
      'precisionNoMaterialDrop':c['precisionPct']>=b['precisionPct']-2,
      'f2Improves':c['f2']>b['f2'],
      'alertRateBounded':c['alertRatePct']<=min(18.0,b['alertRatePct']*1.35+1),
    }
    promote=all(gates.values())
    report={'schemaVersion':11,'generatedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'testDesign':'chronological 60/20/20 day split; holdout untouched during threshold selection','target':'while current day change is <10%, future +8% within 60m OR +15% later same session','universeSymbols':len(raw),'datasetRows':len(df),'days':len(days),'trainDays':len(sorted(tr.day.unique())),'devDays':len(sorted(dv.day.unique())),'holdoutDays':len(sorted(ho.day.unique())),'baselineFeatures':BASE,'challengerFeatures':CH,'results':results,'promotionGates':gates,'promotionApproved':promote,'notes':['Future returns are labels only; no future prices are features.','Universe is built from currently available TAGit/Finviz/discovery symbols, so this test does not prove full-market discovery recall.','Production must not change unless all gates pass.']}
    OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if promote:
        spec=export_logistic(models['challenger'],CH);spec.update({'schemaVersion':11,'modelType':'PIT_LOGISTIC_EARLY_BREAKOUT_CHALLENGER','generatedAtUTC':report['generatedAtUTC'],'threshold':thresholds['challenger'],'candidateCap':30,'guardrails':{'changePctMin':-5,'changePctMaxExclusive':10,'maxQuoteAgeMin':4,'noFutureFeatures':True},'validation':results,'promotionEvidence':'tagit-v11-challenger-test.json'})
        MODEL.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    elif MODEL.exists(): MODEL.unlink()
    print(json.dumps({'promotionApproved':promote,'gates':gates,'baseline':b,'challenger':c},indent=2))
if __name__=='__main__':main()
