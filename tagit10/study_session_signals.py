"""One fixed experiment on the stored cohort; no new download or auto-promotion."""
import gzip, hashlib, importlib.util, json, math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from explosive import ET, reference, slot, pct
from session_signals import SCHEMA, FEATURES, HYPOTHESES, vector, domain, families, volume_baseline, hard_negative, outcome, predict_net

ROOT=Path(__file__).resolve().parent;DATA=ROOT/'history/explosive';OUT=ROOT/'reports'
spec=importlib.util.spec_from_file_location('calendar_guard',ROOT.parent/'tagit/market-calendar-guard.py')
calendar=importlib.util.module_from_spec(spec);spec.loader.exec_module(calendar)

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')

def collect():
    manifest=json.loads((DATA/'manifest.json').read_text());rows=[];events=[];counts=Counter()
    if {p.name for p in DATA.glob('bars-*.jsonl.gz')}!=set(manifest['artifacts']):raise RuntimeError('Missing historical shards')
    for path in sorted(DATA.glob('bars-*.jsonl.gz')):
        expected=manifest['artifacts'][path.name]['sha256']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise RuntimeError('Historical shard digest mismatch: '+path.name)
        with gzip.open(path,'rt') as stream:
            for line in stream:
                item=json.loads(line);byday=defaultdict(list)
                splitdays={datetime.fromtimestamp(v['date'],ET).date().isoformat() for v in item.get('splitEvents',{}).values()}
                for b in item['bars']:
                    if 570<=slot(b['t'])<960:byday[datetime.fromtimestamp(b['t'],ET).date().isoformat()].append(b)
                prior=[]
                for day,bars in sorted(byday.items()):
                    bars=sorted(bars,key=lambda b:b['t'])
                    info=calendar.calendar_info(datetime.fromisoformat(day+'T12:00:00').replace(tzinfo=ET))
                    if not info['verifiedYear'] or not info['regularCloseET'] or info['session']=='closed':continue
                    close_at=int(datetime.fromisoformat(day+'T'+info['regularCloseET']).replace(tzinfo=ET).timestamp())
                    bars=[b for b in bars if b['t']<close_at]
                    if day in splitdays:prior=[];counts['excludedSplitDays']+=1;continue
                    if not bars or slot(bars[0]['t'])!=570:counts['missingOpeningBarDays']+=1;continue
                    peak=max(b['h'] for b in bars);move=pct(peak,bars[0]['o'])
                    ref=reference(prior)
                    if ref:
                        events.append({'symbol':item['symbol'],'date':day,'observedOpenToHighPct':move})
                        for i,b in enumerate(bars):
                            decision=b['t']+300
                            if decision+2100>close_at or b['c']*b['v']<100000:continue
                            x=vector(bars[:i+1],ref)
                            if not domain(x,b['c']):counts['unavailableFeatureWindows']+=1;continue
                            names=families(x);baseline=volume_baseline(x);negative=hard_negative(x)
                            if not(names or baseline or negative):continue
                            future=[v for v in bars[i+1:] if v['t']>=decision+300]
                            out=outcome(future,decision,close_at)
                            large={str(target):outcome(future,decision,close_at,target,None) for target in (10,20)}
                            rows.append({'symbol':item['symbol'],'date':day,'decisionAt':decision,'x':x,
                                'families':names,'volumeBaseline':baseline,'hardNegative':negative,
                                'outcome':out,'largeOutcomes':large,'dayMovePct':move})
                    else:counts['priorBaselineWarmupDays']+=1
                    if bars[-1]['t']+300==close_at:prior.append(bars)
                    prior=prior[-10:]
                counts['symbols']+=1
        print(json.dumps({'shard':path.name,'examples':len(rows),'symbols':counts['symbols']}),flush=True)
    return rows,events,manifest,dict(counts)

def select(rows,scores,threshold,mode='setups',cap=5):
    chosen=[];seen=set();daily=Counter()
    order=sorted(range(len(rows)),key=lambda i:(rows[i]['date'],rows[i]['decisionAt'],-float(scores[i]),rows[i]['symbol']))
    for i in order:
        r=rows[i];eligible=bool(r['families']) if mode=='setups' else r['volumeBaseline']
        key=(r['date'],r['symbol'])
        if not eligible or scores[i]<threshold or key in seen or daily[r['date']]>=cap:continue
        seen.add(key);daily[r['date']]+=1;chosen.append({**r,'estimatedNet30mPct':float(scores[i])})
    return chosen

def summarize(rows,dates):
    known=[r for r in rows if r['outcome'] is not None];nets=[r['outcome']['grossReturnPct']-.4 for r in known]
    daily=defaultdict(list)
    for r in rows:daily[r['date']].append(r['outcome']['grossReturnPct']-.4 if r['outcome'] is not None else -100)
    means=np.array([np.mean(daily[d]) if daily[d] else 0 for d in dates])
    rng=np.random.default_rng(10600)
    lower=float(np.quantile(np.mean(rng.choice(means,(1000,len(means))),axis=1),.05)) if len(means)>=3 else None
    return {'alerts':len(rows),'scorable':len(known),'unscorable':len(rows)-len(known),
        'target3Hits':sum(r['outcome']['label']=='TARGET_FIRST' for r in known),
        'positiveNetPct':round(100*sum(n>0 for n in nets)/len(nets),3) if nets else None,
        'meanNetPct':round(float(np.mean(nets)),4) if nets else None,
        'meanStressNetPct':round(float(np.mean(nets))-.6,4) if nets else None,
        'worstNetPct':round(min(nets),4) if nets else None,
        'target3PrecisionAllAlertsPct':round(100*sum(r['outcome']['label']=='TARGET_FIRST' for r in known)/len(rows),3) if rows else None,
        'outcomes':dict(Counter(r['outcome']['label'] if r['outcome'] else 'UNSCORABLE' for r in rows)),
        'families':dict(Counter(n for r in rows for n in r['families'])),
        'sessionsWithAlerts':len(daily),'evaluationSessions':len(dates),
        'dailyMeanLower95Pct':round(lower,4) if lower is not None else None,
        'largeMoves':{target:{'hits':sum(r['largeOutcomes'][target] is not None and r['largeOutcomes'][target]['label']=='TARGET_FIRST' for r in rows),
            'unscorable':sum(r['largeOutcomes'][target] is None for r in rows)} for target in ('10','20')}}

def portable(fit):
    trees=[]
    for stage in fit._predictors:
        trees.append([{'leaf':bool(n['is_leaf']),'value':float(n['value']),
            'feature':int(n['feature_idx']),'threshold':float(n['num_threshold']),
            'left':int(n['left']),'right':int(n['right'])} for n in stage[0].nodes])
    return {'kind':'net_return_regressor','intercept':float(fit._baseline_prediction[0,0]),'trees':trees}

def main():
    rows,events,manifest,counts=collect();dates=sorted({r['date'] for r in rows})
    if len(dates)<25:raise RuntimeError('Insufficient chronological dates')
    # Predeclared final 6 test dates, previous 6 calibration dates, one-day gaps.
    test_dates=dates[-6:];cal_dates=dates[-13:-7];train_dates=dates[:-14]
    train=[r for r in rows if r['date'] in train_dates and r['outcome'] is not None]
    cal=[r for r in rows if r['date'] in cal_dates];test=[r for r in rows if r['date'] in test_dates]
    x=np.asarray([r['x'] for r in train],dtype=np.float32);y=np.asarray([r['outcome']['grossReturnPct']-.4 for r in train])
    perday=Counter((r['symbol'],r['date']) for r in train);weights=np.array([1/perday[(r['symbol'],r['date'])] for r in train]);weights*=len(weights)/weights.sum()
    fit=HistGradientBoostingRegressor(max_iter=90,max_leaf_nodes=7,max_depth=3,min_samples_leaf=100,
        l2_regularization=10,learning_rate=.05,early_stopping=False,random_state=10600)
    fit.fit(x,y,sample_weight=weights);model=portable(fit)
    scores=fit.predict(np.asarray([r['x'] for r in cal],dtype=np.float32))
    probes=np.linspace(0,len(cal)-1,min(100,len(cal)),dtype=int)
    error=max(abs(scores[i]-predict_net(model,cal[i]['x'])) for i in probes)
    if error>1e-5:raise RuntimeError('Portable net-return inference mismatch')
    thresholds=[]
    for threshold in (0,.2,.4,.6):
        chosen=select(cal,scores,threshold);s=summarize(chosen,cal_dates)
        supported=(s['alerts']>=10 and s['sessionsWithAlerts']>=3 and s['unscorable']<=.1*s['alerts']
            and s['meanStressNetPct'] is not None and s['meanStressNetPct']>0 and (s['dailyMeanLower95Pct'] or -1)>0)
        thresholds.append({'threshold':threshold,'supported':supported,**s})
    supported=[s for s in thresholds if s['supported']]
    best=max(supported,key=lambda s:s['dailyMeanLower95Pct']) if supported else thresholds[0]
    tp=fit.predict(np.asarray([r['x'] for r in test],dtype=np.float32))
    picked=select(test,tp,best['threshold']);holdout=summarize(picked,test_dates)
    baseline_scores=[r['x'][0] for r in test]
    baselines={'volumeMomentum':summarize(select(test,baseline_scores,0,'volume'),test_dates),
        'unweightedSetups':summarize(select(test,baseline_scores,0),test_dates)}
    provisional=(bool(supported) and holdout['scorable']>=10 and holdout['unscorable']<=.1*max(holdout['alerts'],1)
        and holdout['meanStressNetPct'] is not None and holdout['meanStressNetPct']>0
        and (holdout['dailyMeanLower95Pct'] or -1)>0
        and holdout['meanNetPct']>max(b['meanNetPct'] if b['meanNetPct'] is not None else -100 for b in baselines.values()))
    status='RETROSPECTIVE_SUPPORT_ONLY' if provisional else 'NOT_SUPPORTED_FOR_TRADING'
    bundle={'schema':SCHEMA,'features':FEATURES,'model':model,'threshold':best['threshold'],
        'trainingCutoff':train_dates[-1],'evaluatedThrough':test_dates[-1],'validationStatus':status,
        'tradeEligible':False,'promoted':False,'meaning':'Estimated net return under OHLC/cost assumptions; not a calibrated success probability'}
    bundle['id']=hashlib.sha256(json.dumps(bundle,sort_keys=True).encode()).hexdigest()[:16]
    frozen={}
    for r in sorted(train,key=lambda r:(r['date'],r['decisionAt'],r['symbol'])):
        for n in r['families']:frozen.setdefault((r['date'],r['symbol'],n),r)
    patterns={n:summarize([r for k,r in frozen.items() if k[2]==n],train_dates) for n in HYPOTHESES}
    report={'schema':SCHEMA,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'modelId':bundle['id'],
        'validationStatus':status,'promoted':False,'tradeEligible':False,'collection':{'bars':manifest['bars'],'symbols':manifest['successfulSymbols'],'newDownloads':0,'shardsVerified':16},
        'splits':{'train':train_dates,'calibration':cal_dates,'test':test_dates,'embargo':[dates[-14],dates[-7]]},
        'examples':{'train':len(train),'calibration':len(cal),'test':len(test),'hardNegativesInTraining':sum(r['hardNegative'] for r in train)},
        'hypotheses':HYPOTHESES,'trainingPatterns':patterns,'calibrationThresholds':thresholds,'selectedThreshold':best['threshold'],
        'holdout':holdout,'baselines':baselines,'counts':counts,'portableMaxError':error,
        'definition':'Closed 5m decisions including first five minutes; one full 5m entry delay; +3% before -2% in 30 minutes from entry; stop-first ambiguous bars and adverse gaps; 0.4% assumed cost, 1.0% stress cost. +10/+20% before -2% until close reported separately. Five daily alerts; first alert per stock-session.',
        'limitations':['Historical dates were already examined by earlier TAGit experiments; this is a new fixed experiment on known dates, not prospective proof.',
            'Current-survivor 2,000-equity cohort; no historical delisted-universe completeness, executable bid/ask, news timestamps or historical float.',
            'Historical 5m bars and live aggregation of 1m bars can differ; late source revisions are not immutable original observations.',
            'Missing future bars consume alert capacity and cannot count as wins; -100% unknown penalty is a selection stress assumption, not an observed return.',
            'Pattern groups overlap and are descriptive. A positive mean or passing software tests cannot approve trading.'],
        'testAlerts':[{k:v for k,v in r.items() if k!='x'} for r in picked]}
    save(OUT/'session-model.json',bundle);save(OUT/'session-study.json',report)
    print(json.dumps({'status':status,'modelId':bundle['id'],'holdout':holdout,'baselines':baselines}),flush=True)

if __name__=='__main__':main()
