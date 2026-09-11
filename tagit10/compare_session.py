"""One-session retrospective replay of two fixed model versions, no retuning."""
import json,urllib.request,urllib.parse,math
from datetime import datetime,timezone,timedelta
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from pathlib import Path
import numpy as np
from research import feature_vector,outcome
from continuous_learning import probability,summarize
from train_history import ET
ROOT=Path(__file__).resolve().parent

def fetch(symbol):
    now=datetime.now(timezone.utc);start=now-timedelta(days=7)
    url=f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?period1={int(start.timestamp())}&period2={int(now.timestamp())}&interval=5m&includePrePost=false'
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r:z=json.load(r)['chart']['result'][0]
        q=z['indicators']['quote'][0];bars=[]
        for i,t in enumerate(z.get('timestamp',[])):
            try:b={'t':t,**{k:float(q[a][i]) for k,a in [('o','open'),('h','high'),('l','low'),('c','close'),('v','volume')]}}
            except (KeyError,ValueError,IndexError,TypeError):continue
            dt=datetime.fromtimestamp(t,ET);today=now.astimezone(ET)
            if dt.date()==today.date() and (today.hour,today.minute)<(16,0):continue
            if (9,30)<=(dt.hour,dt.minute)<(16,0) and t+300<=now.timestamp() and all(math.isfinite(v) for v in b.values()) and b['l']>0 and b['v']>=0 and b['l']<=min(b['o'],b['c'])<=max(b['o'],b['c'])<=b['h']:bars.append(b)
        return symbol,bars,None
    except Exception as e:return symbol,[],str(e)

def trades(rows,p,threshold):return [dict(r,prob=float(v)) for r,v in zip(rows,p) if v>=threshold]
def portfolio(selected):
    # Long-only, one position at a time, whole shares; 1% risk and no borrowing.
    cash=200.;busy=0;peak=cash;dd=0;log=[];slip=.002
    for r in sorted(selected,key=lambda x:(x['decisionAt'],-x['prob'],x['symbol'])):
        if r['decisionAt']<busy:continue
        entry=r['entry']*(1+slip);stop=r['entry']*.98*(1-slip)
        qty=math.floor(min(cash/entry,cash*.01/(entry-stop)))
        if qty<1:continue
        pnl=qty*(r['exit']*(1-slip)-entry);cash+=pnl;busy=r['exitAt'];peak=max(peak,cash);dd=max(dd,(peak-cash)/peak*100)
        log.append({k:r[k] for k in ['symbol','decisionAt','exitAt','entry','exit','outcome']}|{'qty':qty,'pnl':pnl,'cashAfter':cash})
    return {'startCash':200,'endCash':cash,'netPnl':cash-200,'trades':len(log),'maxRealizedDrawdownPct':dd,'winRatePct':100*sum(t['pnl']>0 for t in log)/len(log) if log else None,'log':log}

def main():
    old=json.loads((ROOT/'reports/research-model.json').read_text());state=json.loads((ROOT/'learning/state.json').read_text());new=state.get('pending') or state.get('champion')
    if not new:raise RuntimeError('No saved learned model to compare')
    with ThreadPoolExecutor(max_workers=8) as ex:results=list(ex.map(fetch,new['symbols']))
    bars={s:bs for s,bs,e in results if bs};failed={s:e or 'NO_BARS' for s,bs,e in results if not bs}
    if len(bars)<len(results)*.8:raise RuntimeError('Coverage below 80%; comparison aborted')
    dates=sorted({datetime.fromtimestamp(b['t'],ET).date().isoformat() for bs in bars.values() for b in bs});day=dates[-1]
    if day<=new['cutoff'] or day<=max(old['calibrationDates']+old['trainingDates']):raise RuntimeError('Latest session overlaps model development; cannot make fair comparison')
    rows=[]
    for s,bs in bars.items():
        bs=sorted([b for b in bs if datetime.fromtimestamp(b['t'],ET).date().isoformat()==day],key=lambda b:b['t'])
        for i in range(11,len(bs)-6,6):
            x=feature_vector(bs[:i+1]);future=bs[i+1:i+7];label=outcome(future)
            if x is None or label is None or future[0]['t']!=bs[i]['t']+300:continue
            entry=future[0]['o'];exit=future[-1]['c'];exit_at=future[-1]['t']+300
            for b in future:
                if b['l']<=entry*.98:exit=min(b['o'],entry*.98);exit_at=b['t']+300;break
                if b['h']>=entry*1.03:exit=entry*1.03;exit_at=b['t']+300;break
            rows.append(dict(symbol=s,date=day,decisionAt=future[0]['t'],entry=entry,exit=exit,exitAt=exit_at,x=x,**label))
    if not rows:raise RuntimeError('No complete comparable windows')
    oldsel=trades(rows,probability(old,rows),old['threshold']);newsel=trades(rows,probability(new,rows),new['threshold'])
    report={'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'session':day,'mode':'RETROSPECTIVE_OUT_OF_DEVELOPMENT_REPLAY','newModel':new['id'],'newFrozenAt':new['frozenAtUTC'],'newCutoff':new['cutoff'],'oldCalibrationEnd':max(old['calibrationDates']),'requestedSymbols':len(results),'symbolsWithBars':len(bars),'failedSymbols':failed,'comparableExamples':len(rows),'before':{'threshold':old['threshold'],'signals':summarize(oldsel),'portfolio':portfolio(oldsel)},'after':{'threshold':new['threshold'],'signals':summarize(newsel),'portfolio':portfolio(newsel)},'baselineAll':summarize(rows),'assumptions':['Same bars and eligible universe for both fixed models; no retuning.','Target +3%, stop -2%, timeout 30 minutes; ambiguous bar stops first.','Signal mean returns deduct 0.4 percentage points round trip.','Portfolio starts $200, 1% risk per trade, whole shares, one position, 0.2% slippage per side, zero commission.','Tie-break by probability then symbol; no capital reuse until exit bar closes.','Liquidity, halts, market impact, settlement and intrabar execution are not modeled.','Retrospective replay is not prospective evidence or a guarantee.'], 'selectedBefore':oldsel,'selectedAfter':newsel}
    (ROOT/'reports/session-comparison.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['selectedBefore','selectedAfter']},indent=2))
if __name__=='__main__':main()
