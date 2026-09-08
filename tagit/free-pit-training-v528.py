#!/usr/bin/env python3
"""TAGit v5.28 recurrent continuation memory PIT validation.

Builds on v5.23 (best recent-regime discovery result) and adds only causal prior-session context:
- symbol recurrence counts/rates over prior completed sessions,
- 1/2/3-session hit and near-hit carryover,
- streak/decay of prior MFE and drawdown quality,
- same-day market opportunity density computed from PRIOR completed day outcomes only.
No current-day or future regular-session outcome enters features. The consumed research tail remains
comparison-only; all configuration selection occurs inside contiguous development folds.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, pathlib
from collections import defaultdict, deque
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v523.py')
spec=importlib.util.spec_from_file_location('v523',BASE); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
a=r.a; v=r.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v528-free-pit-training.json'; CASES=ROOT/'tagit-v528-free-pit-cases.json'

def augment_recurrence(rows):
    byday=defaultdict(list)
    for x in rows: byday[x['day']].append(x)
    hist=defaultdict(lambda:deque(maxlen=12))
    prev_day_stats={'n':0,'wins20':0,'wins10':0,'near20':0}
    out=[]
    for day in sorted(byday):
        g=sorted(byday[day],key=lambda x:x['symbol'])
        frozen=[]
        for x in g:
            h=list(hist[x['symbol']]); n=len(h)
            def last(k,key,default=0.0):
                return float(h[-k].get(key,default)) if n>=k else default
            wins20=sum(int(z['hit20']) for z in h); wins10=sum(int(z['hit10']) for z in h)
            near=sum(1 for z in h if (not z['hit20']) and float(z['mfe'])>=15.0)
            # recency-weighted continuation memory; strictly prior sessions.
            weights=[.5**((n-1-i)/3.0) for i in range(n)] if n else []
            wr=sum(w*int(z['hit20']) for w,z in zip(weights,h))/sum(weights) if weights else 0.0
            mfe_decay=sum(w*max(-1,min(4,float(z['mfe'])/20.0)) for w,z in zip(weights,h))/sum(weights) if weights else 0.0
            mae_decay=sum(w*max(-3,min(1,float(z['mae'])/20.0)) for w,z in zip(weights,h))/sum(weights) if weights else 0.0
            streak=0
            for z in reversed(h):
                if z['hit10']: streak+=1
                else: break
            extra=[
                math.log1p(n)/3.0,
                (wins20+1)/(n+8) if n else .125,
                (wins10+1)/(n+6) if n else 1/6,
                (near+1)/(n+10) if n else .10,
                wr,mfe_decay,mae_decay,
                last(1,'hit20'),last(2,'hit20'),last(3,'hit20'),
                last(1,'hit10'),last(2,'hit10'),last(3,'hit10'),
                max(0,min(streak,5))/5.0,
                max(-2,min(4,last(1,'mfe')/20.0)),
                max(-3,min(1,last(1,'mae')/20.0)),
                min(prev_day_stats['wins20'],20)/20.0,
                min(prev_day_stats['wins10'],40)/40.0,
                min(prev_day_stats['near20'],30)/30.0,
                math.log1p(prev_day_stats['n'])/7.0,
            ]
            z=dict(x); z['feat']=list(x['feat'])+extra
            z['recurrenceAudit']={'priorSessions':n,'priorWins20':wins20,'priorWins10':wins10,'priorNear20':near,'hit10Streak':streak,'previousDayWins20':prev_day_stats['wins20']}
            frozen.append(z)
        out.extend(frozen)
        # Reveal outcomes only after today's features are frozen.
        wins20=wins10=near20=0
        for x in g:
            hist[x['symbol']].append({'hit20':bool(x['hit20']),'hit10':bool(x['hit10']),'mfe':float(x['mfe']),'mae':float(x['mae'])})
            wins20+=int(x['hit20']); wins10+=int(x['hit10']); near20+=int((not x['hit20']) and float(x['mfe'])>=15.0)
        prev_day_stats={'n':len(g),'wins20':wins20,'wins10':wins10,'near20':near20}
    return out

def fetch_rows():
    mode,syms,raw,errs,rows=a.fetch_rows()
    return mode,syms,raw,errs,augment_recurrence(rows)

def main():
    mode,syms,raw,errs,rows=fetch_rows(); dates=sorted({x['day'] for x in rows})
    if len(dates)<40 or len(rows)<5000: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); devd=dates[:cut]; researchd=dates[cut:]
    seed=max(12,int(.45*len(devd))); vald=devd[seed:]
    bds=[list(map(str,x.tolist())) for x in np.array_split(np.array(vald,dtype=object),3) if len(x)]
    blocks=[]; finfo=[]
    for bd in bds:
        fd={d for d in devd if d<bd[0]}; vd=set(bd)
        fr=[x for x in rows if x['day'] in fd]; vr=[x for x in rows if x['day'] in vd]
        blocks.append((fr,vr)); finfo.append({'fitDays':len(fd),'validationDays':len(vd),'fitRows':len(fr),'validationRows':len(vr)})
    _,window,rw,thr,dm,topn,fmetrics,audits=r.evaluate_blocks(blocks)
    dev=[x for x in rows if x['day'] in set(devd)]; research=[x for x in rows if x['day'] in set(researchd)]
    lm=v.fit(dev); rm,nd,nr,np_=r.fit_recent(dev,window)
    if rm is None: raise RuntimeError('selected recent window lacks support')
    rs=r.blend_score(lm,rm,research,rw); sel=r.select(rs,thr,dm,topn); hm=v.v.metrics(sel,rs)
    rep={'schemaVersion':'5.28-recurrent-continuation-memory-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['prior-only recurrent symbol memory','1/2/3-session continuation carryover','recency-weighted MFE/MAE memory','prior-day opportunity-density context','v5.23 recent-regime ensemble retained'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(int(x['hit20']) for x in rows)},
      'development':{'days':len(devd),'folds':finfo,'foldMetrics':fmetrics,'recentAudits':audits},
      'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'scoreThreshold':round(thr,6),'maxLongRecentDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':hm,'finalRecentFit':{'days':nd,'rows':nr,'positives':np_},'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['all inference market features <=09:15 ET','recurrence memory updated only after each completed day','current-day opportunity density never used','recent model uses only completed prior sessions','configuration selected on development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':sel,'selectedConfig':rep['selectedConfig'],'foldMetrics':fmetrics},indent=2)); print(json.dumps(rep,indent=2))
if __name__=='__main__': main()
