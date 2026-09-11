"""Nightly research: recurring patterns, frozen prospective challengers, auditable lessons.
No production ranking or brokerage execution is modified.
"""
import gzip,json,hashlib,math
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from research import FEATURES
ROOT=Path(__file__).resolve().parent

def probability(model,rows):
    if not rows:return np.array([])
    z=((np.array([r['x'] for r in rows])-model['mean'])/model['scale'])@np.array(model['weights'])+model['intercept']
    return 1/(1+np.exp(-np.clip(z,-40,40)))

def summarize(rows):
    days=defaultdict(list)
    for r in rows:days[r['date']].append(r['returnPct'])
    means=[float(np.mean(v)) for v in days.values()]
    return {'selected':len(rows),'sessions':len(days),'precisionPct':100*sum(r['y'] for r in rows)/len(rows) if rows else None,
      'meanNetReturnPct':float(np.mean([r['returnPct'] for r in rows])) if rows else None,
      'positiveSessions':sum(v>0 for v in means),'dailyMeanLowerBound':float(np.mean(means)-2.776*np.std(means,ddof=1)/math.sqrt(len(means))) if len(means)>=5 else None}

def pattern(r):
    x=r['x'];return '/'.join(['rising' if x[1]>0 else 'falling','volume_expansion' if x[4]>=1.5 else 'normal_volume','dollar_volume_high' if x[5]>=math.log1p(1_000_000) else 'dollar_volume_low','above_vwap' if x[6]>0 else 'below_vwap'])

def pattern_report(rows):
    groups=defaultdict(list)
    for r in rows:groups[pattern(r)].append(r)
    return sorted([{'pattern':k,**summarize(v)} for k,v in groups.items() if len(set(r['date'] for r in v))>=3],key=lambda g:g['selected'],reverse=True)

def build_candidate(rows,cutoff):
    dates=sorted(set(r['date'] for r in rows));caldays=dates[-5:];train=[r for r in rows if r['date']<caldays[0]];cal=[r for r in rows if r['date'] in caldays]
    if len(dates)<15 or len(train)<500 or len(set(r['y'] for r in train))<2:return None
    scaler=StandardScaler().fit([r['x'] for r in train]);trials=[]
    for c in [.03,.3,3.0]:
        fit=LogisticRegression(C=c,max_iter=600,random_state=42).fit(scaler.transform([r['x'] for r in train]),[r['y'] for r in train])
        m={'features':FEATURES,'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),'weights':fit.coef_[0].tolist(),'intercept':float(fit.intercept_[0]),'C':c,'cutoff':cutoff,'symbols':sorted(set(r['symbol'] for r in rows))}
        p=probability(m,cal)
        for th in [.1,.15,.2,.3,.4,.5,.6,.7,.8,.9]:
            selected=[r for r,v in zip(cal,p) if v>=th];s=summarize(selected)
            if s['selected']>=30 and s['sessions']>=3:trials.append((s['meanNetReturnPct'],{**m,'threshold':th,'calibration':s}))
    if not trials:return None
    m=max(trials,key=lambda v:v[0])[1];m['id']=hashlib.sha256(json.dumps(m,sort_keys=True).encode()).hexdigest()[:16]
    # All dates through cutoff have been seen. Evaluation starts only AFTER cutoff.
    m['frozenAtUTC']=datetime.now(timezone.utc).isoformat();return m

def update(state,rows,now=None):
    now=now or datetime.now(timezone.utc).isoformat();dates=sorted(set(r['date'] for r in rows))
    if not dates:return state,{'status':'NO_DATA','updatedAtUTC':now}
    last=dates[-1];events=state.setdefault('lessons',[]);champ=state.get('champion');pending=state.get('pending');evaluation=None
    if pending:
        # Entry is after model freeze in real time as well as after the data cutoff.
        frozen=datetime.fromisoformat(pending['frozenAtUTC']).timestamp()
        future=[r for r in rows if r['date']>pending['cutoff'] and r['decisionAt']>frozen and r['symbol'] in pending['symbols']]
        seen=sorted(set(r['date'] for r in future));p=probability(pending,future)
        selected=[r for r,v in zip(future,p) if v>=pending['threshold']];evaluation=summarize(selected)
        evaluation.update(observedSessions=len(seen),candidate=pending['id'])
        if len(seen)>=5:
            # Frozen evaluation closes once, never re-test failed candidates on later data.
            window=set(seen[:5]);future=[r for r in future if r['date'] in window];p=probability(pending,future)
            selected=[r for r,v in zip(future,p) if v>=pending['threshold']];s=summarize(selected)
            baseline=summarize(future);inc=None
            if champ:inc=summarize([r for r,v in zip(future,probability(champ,future)) if v>=champ['threshold']])
            accepted=(s['selected']>=100 and s['sessions']>=5 and s['positiveSessions']>=4 and (s['dailyMeanLowerBound'] or -1)>0 and s['meanNetReturnPct']>baseline['meanNetReturnPct'] and (not inc or inc['meanNetReturnPct'] is None or s['meanNetReturnPct']>inc['meanNetReturnPct']))
            events.append({'at':now,'model':pending['id'],'decision':'SHADOW_ACCEPTED' if accepted else 'REJECTED','evaluationDates':sorted(window),'result':s,'baseline':baseline,'incumbent':inc,'lesson':'Require positive conservative session return, sufficient coverage and improvement over baselines; target-hit precision alone is insufficient.'})
            if accepted:state['champion']=pending
            state['pending']=None;pending=None
    # Idempotent for repeated executions with no new complete market session.
    if not pending and state.get('lastFitDate')!=last:
        state['pending']=build_candidate(rows,last);state['lastFitDate']=last
        if state['pending']:events.append({'at':now,'model':state['pending']['id'],'decision':'FROZEN_FOR_FUTURE_SESSIONS','cutoff':last,'calibration':state['pending']['calibration']})
    state['lastDataDate']=last
    recent=[r for r in rows if r['date'] in dates[-20:]];groups=pattern_report(recent)
    reference=[r for r in rows if r['date'] in dates[-25:-5]];latest=[r for r in rows if r['date'] in dates[-5:]]
    drift={}
    if reference and latest:
        a=np.array([r['x'] for r in reference]);b=np.array([r['x'] for r in latest]);shift=np.abs(b.mean(axis=0)-a.mean(axis=0))/np.maximum(a.std(axis=0),1e-6)
        drift={f:round(float(v),3) for f,v in zip(FEATURES,shift)}
    report={'updatedAtUTC':now,'status':'SHADOW_LEARNING','productionRankingChanged':False,'lastDataDate':last,'sessions':len(dates),'examples':len(rows),'pendingModel':state.get('pending',{}),'champion':state.get('champion',{}),'prospectiveEvaluation':evaluation,'patterns':groups,'featureDriftStandardDeviations':drift,'driftAlert':any(v>1 for v in drift.values()),'lessons':events[-20:],'schedule':'17 2 * * 2-6 UTC','notes':['Liquidity uses traded dollar volume as a proxy; no order-book liquidity data.','Patterns are retrospective descriptions, not validated buy signals.','Daily modeling is research only; accepted candidates become shadow champions, not live trading signals.','Evaluation needs five future sessions; minimum 100 selections and positive conservative session mean.','Historical cohort bias, source revisions and execution limitations remain.']}
    return state,report

def main():
    root=ROOT/'learning';root.mkdir(exist_ok=True);p=root/'state.json';state=json.loads(p.read_text()) if p.exists() else {}
    with gzip.open(ROOT/'history/training-examples.jsonl.gz','rt') as f:rows=[json.loads(line) for line in f]
    state,report=update(state,rows)
    for path,data in [(p,state),(ROOT/'reports/continuous-learning.json',report)]:path.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
    # Immutable report snapshots keyed by content, retained across nightly runs.
    digest=hashlib.sha256(json.dumps(report,sort_keys=True).encode()).hexdigest()[:12]
    (root/(report['updatedAtUTC'][:10]+'-'+digest+'.json')).write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:report[k] for k in ['status','lastDataDate','sessions','examples','driftAlert']}))
if __name__=='__main__':main()
