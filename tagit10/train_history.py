#!/usr/bin/env python3
import csv,gzip,hashlib,json,math,time,urllib.request,urllib.parse
from collections import defaultdict,Counter
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import average_precision_score,brier_score_loss
from research import FEATURES,feature_vector,outcome
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tagit10/reports';DATA=ROOT/'tagit10/history';ET=ZoneInfo('America/New_York')
def download(symbol):
    end=datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0);start=end-timedelta(days=45)
    url=f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?period1={int(start.timestamp())}&period2={int(end.timestamp())}&interval=5m&includePrePost=false'
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 TAGit personal research'})
        with urllib.request.urlopen(req,timeout=18) as r:raw=json.loads(r.read())
        z=raw['chart']['result'][0];q=z['indicators']['quote'][0];bars=[]
        for i,t in enumerate(z.get('timestamp',[])):
            try:b={'t':t,**{k:float(q[a][i]) for k,a in [('o','open'),('h','high'),('l','low'),('c','close'),('v','volume')]}}
            except (TypeError,IndexError,KeyError,ValueError):continue
            dt=datetime.fromtimestamp(t,ET)
            if dt.weekday()<5 and (9,30)<=(dt.hour,dt.minute)<(16,0) and all(math.isfinite(v) for v in b.values()) and b['l']>0 and b['v']>=0 and b['l']<=min(b['o'],b['c'])<=max(b['o'],b['c'])<=b['h']:bars.append(b)
        return symbol,bars,None
    except Exception as e:return symbol,[],type(e).__name__
def metrics(rows,p,threshold):
    chosen=[(r,float(v)) for r,v in zip(rows,p) if v>=threshold];y=np.array([r['y'] for r in rows]);tp=sum(r['y'] for r,_ in chosen)
    returns=[r['returnPct'] for r,_ in chosen]
    return {'samples':len(rows),'positives':int(sum(y)),'selected':len(chosen),'precisionPct':round(100*tp/len(chosen),2) if chosen else None,
      'recallPct':round(100*tp/sum(y),2) if sum(y) else None,'meanNetReturnPct':round(float(np.mean(returns)),4) if returns else None,
      'averagePrecision':round(float(average_precision_score(y,p)),5) if len(set(y))>1 else None,'brierScore':round(float(brier_score_loss(y,p)),5),
      'note':'Per-example results, not a portfolio backtest. Overlap and concurrent capital needs are not tradable returns.'}
def main():
    OUT.mkdir(parents=True,exist_ok=True);DATA.mkdir(parents=True,exist_ok=True)
    source_files=sorted((ROOT/'tag/data/training-ledger').glob('*.ndjson'));symbols=set();input_count=0
    with gzip.open(DATA/'archived-observations.jsonl.gz','wt') as archive:
        for path in source_files:
            for line in path.read_text().splitlines():
                snap=json.loads(line)
                for x in snap.get('rows',[]):
                    input_count+=1;symbol=x.get('ticker','')
                    archive.write(json.dumps({'source':str(path.relative_to(ROOT)),'capturedAtUTC':snap.get('capturedAtUTC'),'row':x},separators=(',',':'))+'\n')
                    if symbol.isalpha() and len(symbol)<=5:symbols.add(symbol)
    # Fixed hash sample: no ranking by realized return or known winners.
    symbols=sorted(symbols,key=lambda s:hashlib.sha256(s.encode()).hexdigest())[:160]
    bars_by={};failed={}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for f in as_completed([ex.submit(download,s) for s in symbols]):
            symbol,bars,error=f.result()
            if bars:bars_by[symbol]=bars
            else:failed[symbol]=error or 'NO_BARS'
    with gzip.open(DATA/'intraday-bars.jsonl.gz','wt') as f:
        for s,b in sorted(bars_by.items()):f.write(json.dumps({'symbol':s,'bars':b},separators=(',',':'))+'\n')
    examples=[]
    for s,bars in sorted(bars_by.items()):
        days=defaultdict(list)
        for b in sorted(bars,key=lambda x:x['t']):days[datetime.fromtimestamp(b['t'],ET).date().isoformat()].append(b)
        for day,bs in days.items():
            for i in range(11,len(bs)-6,6):
                x=feature_vector(bs[:i+1]);future=bs[i+1:i+7];label=outcome(future)
                if x is None or label is None or future[0]['t']!=bs[i]['t']+300:continue
                examples.append({'symbol':s,'date':day,'decisionAt':bs[i]['t']+300,'x':x,**label})
    with gzip.open(DATA/'training-examples.jsonl.gz','wt') as f:
        for r in examples:f.write(json.dumps(r,separators=(',',':'))+'\n')
    dates=sorted(set(r['date'] for r in examples));report={'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'status':'INSUFFICIENT_DATA','promoted':False,
        'archiveObservations':input_count,'requestedSymbols':len(symbols),'symbolsWithBars':len(bars_by),'barCount':sum(map(len,bars_by.values())),'examples':len(examples),'dates':dates,
        'failedSymbols':failed,'featureNames':FEATURES,'target':'Next 30min: +3% before -2%, stop-first on ambiguous bar; next bar open reference; 0.4% assumed round-trip cost',
        'limitations':['Retrospective symbol cohort selected from September archives; survivor/selection bias remains','Yahoo 5m bars are not consolidated executable bid/ask data','Features are closed bars only; splits handled only as supplied by source','No broker fills, halt model, settlement checks or market impact','Results are research; no live ranking promotion or profit guarantee']}
    if len(dates)>=12 and len(examples)>=500:
        i=max(1,int(len(dates)*.6));j=max(i+1,int(len(dates)*.8));parts=[[r for r in examples if r['date'] in ds] for ds in [dates[:i],dates[i:j],dates[j:]]];train,cal,test=parts
        if all(len(set(r['y'] for r in p))==2 for p in parts):
            scaler=StandardScaler().fit([r['x'] for r in train]);model=LogisticRegression(C=.3,max_iter=600,random_state=42).fit(scaler.transform([r['x'] for r in train]),[r['y'] for r in train])
            probs=[model.predict_proba(scaler.transform([r['x'] for r in p]))[:,1] for p in parts]
            # One predeclared family; select threshold using calibration only.
            trials=[]
            for th in np.linspace(.1,.9,33):
                m=metrics(cal,probs[1],float(th))
                if m['selected']>=30:trials.append((m['meanNetReturnPct'],float(th)))
            threshold=max(trials)[1] if trials else .9
            holdout=metrics(test,probs[2],threshold);byday={d:metrics([r for r in test if r['date']==d],probs[2][[r['date']==d for r in test]],threshold) for d in dates[j:]}
            model_data={'status':'RESEARCH_ONLY','features':FEATURES,'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),'weights':model.coef_[0].tolist(),'intercept':float(model.intercept_[0]),'threshold':threshold,'trainingDates':dates[:i],'calibrationDates':dates[i:j],'testDates':dates[j:]}
            (OUT/'research-model.json').write_text(json.dumps(model_data,indent=2)+'\n')
            report.update(status='TRAINED_RESEARCH_ONLY',splits={'train':dates[:i],'calibration':dates[i:j],'test':dates[j:]},threshold=threshold,train=metrics(train,probs[0],threshold),calibration=metrics(cal,probs[1],threshold),test=holdout,testByDay=byday,baselineTest=metrics(test,np.full(len(test),sum(r['y'] for r in train)/len(train)),0),stability={'testSessions':len(byday),'sessionsWithSelections':sum(m['selected']>0 for m in byday.values()),'positiveMeanSessions':sum((m['meanNetReturnPct'] or 0)>0 for m in byday.values())})
    for name in ['archived-observations.jsonl.gz','intraday-bars.jsonl.gz','training-examples.jsonl.gz']:
        report.setdefault('artifacts',{})[name]={'bytes':(DATA/name).stat().st_size,'sha256':hashlib.sha256((DATA/name).read_bytes()).hexdigest()}
    (OUT/'historical-training.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['failedSymbols','testByDay']},indent=2))
if __name__=='__main__':main()
