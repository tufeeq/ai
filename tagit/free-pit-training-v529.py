#!/usr/bin/env python3
"""TAGit v5.29 reliability-gated recurrent continuation PIT validation.

Refines v5.28 without using research-tail feedback. Recurrent symbol memory is shrunk by
independent prior-session support, carryover features are reliability gated, and prior-day
opportunity context is normalized by that prior day's candidate population rather than raw counts.
All outcome memory is revealed only after the current day's features are frozen.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, pathlib
from collections import defaultdict, deque
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v528.py')
spec=importlib.util.spec_from_file_location('v528',BASE); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
r=b.r; v=b.v; a=b.a
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v529-free-pit-training.json'; CASES=ROOT/'tagit-v529-free-pit-cases.json'

def augment_reliable(rows):
    byday=defaultdict(list)
    for x in rows: byday[x['day']].append(x)
    hist=defaultdict(lambda:deque(maxlen=20))
    prev={'n':0,'w20':0,'w10':0,'near':0}
    out=[]
    for day in sorted(byday):
        g=sorted(byday[day],key=lambda x:x['symbol']); frozen=[]
        for x in g:
            h=list(hist[x['symbol']]); n=len(h)
            support=n/(n+8.0)
            w20=sum(int(z['hit20']) for z in h); w10=sum(int(z['hit10']) for z in h)
            near=sum(int((not z['hit20']) and float(z['mfe'])>=15.0) for z in h)
            fail10=sum(int(not z['hit10']) for z in h)
            p20=(w20+1.0)/(n+8.0); p10=(w10+1.0)/(n+6.0); pnear=(near+1.0)/(n+10.0); pfail10=(fail10+1.0)/(n+8.0)
            weights=[.5**((n-1-i)/4.0) for i in range(n)] if n else []
            den=sum(weights) or 1.0
            rw20=sum(w*int(z['hit20']) for w,z in zip(weights,h))/den if h else 0.0
            rw10=sum(w*int(z['hit10']) for w,z in zip(weights,h))/den if h else 0.0
            rmfe=sum(w*max(-1,min(4,float(z['mfe'])/20.0)) for w,z in zip(weights,h))/den if h else 0.0
            rmae=sum(w*max(-3,min(1,float(z['mae'])/20.0)) for w,z in zip(weights,h))/den if h else 0.0
            def last(k,key): return float(h[-k][key]) if n>=k else 0.0
            # Require repeat evidence before strong continuation carryover is allowed.
            pair20=float(n>=2 and bool(last(1,'hit20')) and bool(last(2,'hit20')))
            pair10=float(n>=2 and bool(last(1,'hit10')) and bool(last(2,'hit10')))
            tri10=float(n>=3 and bool(last(1,'hit10')) and bool(last(2,'hit10')) and bool(last(3,'hit10')))
            streak=0
            for z in reversed(h):
                if z['hit10']: streak+=1
                else: break
            pdn=max(1,prev['n'])
            prev20=prev['w20']/pdn if prev['n'] else 0.0
            prev10=prev['w10']/pdn if prev['n'] else 0.0
            prevnear=prev['near']/pdn if prev['n'] else 0.0
            extra=[
                math.log1p(n)/3.5,support,
                p20,p10,pnear,pfail10,
                support*rw20,support*rw10,support*rmfe,support*rmae,
                support*last(1,'hit20'),support*last(1,'hit10'),
                support*pair20,support*pair10,support*tri10,
                support*min(streak,5)/5.0,
                prev20,prev10,prevnear,math.log1p(prev['n'])/7.0,
                # hard-negative memory: recurrent near-misses without actual +20 continuation.
                support*max(0.0,pnear-p20),
                support*max(0.0,p10-p20),
            ]
            z=dict(x); z['feat']=list(x['feat'])+extra
            z['reliabilityAudit']={'priorSessions':n,'supportWeight':round(support,4),'priorWins20':w20,'priorWins10':w10,'priorNear20':near,'pair20':bool(pair20),'pair10':bool(pair10),'previousDayPopulation':prev['n'],'previousDayWin20Rate':prev20}
            frozen.append(z)
        out.extend(frozen)
        nw20=nw10=nnear=0
        for x in g:
            hist[x['symbol']].append({'hit20':bool(x['hit20']),'hit10':bool(x['hit10']),'mfe':float(x['mfe']),'mae':float(x['mae'])})
            nw20+=int(x['hit20']); nw10+=int(x['hit10']); nnear+=int((not x['hit20']) and float(x['mfe'])>=15.0)
        prev={'n':len(g),'w20':nw20,'w10':nw10,'near':nnear}
    return out

def fetch_rows():
    mode,syms,raw,errs,rows=a.fetch_rows()
    return mode,syms,raw,errs,augment_reliable(rows)

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
    rep={'schemaVersion':'5.29-reliability-recurrent-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['reliability-gated recurrent symbol memory','Bayesian-style shrinkage for sparse symbol histories','2/3-session persistence features','normalized prior-day simultaneous-opportunity density','recurrent near-miss hard-negative memory','v5.23 recent-regime ensemble retained'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(int(x['hit20']) for x in rows)},
      'development':{'days':len(devd),'folds':finfo,'foldMetrics':fmetrics,'recentAudits':audits},
      'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'scoreThreshold':round(thr,6),'maxLongRecentDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':hm,'finalRecentFit':{'days':nd,'rows':nr,'positives':np_},'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['all inference market features <=09:15 ET','recurrent memory uses prior completed sessions only','sparse recurrence is explicitly reliability-shrunk','prior-day opportunity rates only','recent model uses only completed prior sessions','configuration selected on development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':sel,'selectedConfig':rep['selectedConfig'],'foldMetrics':fmetrics},indent=2)); print(json.dumps(rep,indent=2))
if __name__=='__main__': main()
