#!/usr/bin/env python3
"""TAGit v5.23 causal recent-regime ensemble research validation.

Purpose: test whether temporal drift in v5.20-v5.21 is reduced by blending a long-history
pre-open model with a model trained only on the most recent completed development sessions.
All pre-market-volume fields remain neutral/missing-aware via v5.21. No research-tail feedback
is used for configuration selection; the historical tail is already consumed.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, pathlib
from collections import defaultdict
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v521.py')
spec=importlib.util.spec_from_file_location('v521',BASE); a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
v=a.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v523-free-pit-training.json'; CASES=ROOT/'tagit-v523-free-pit-cases.json'


def fit_recent(fit_rows, window_days):
    days=sorted({r['day'] for r in fit_rows})
    use=set(days[-min(window_days,len(days)):])
    rr=[r for r in fit_rows if r['day'] in use]
    if len(rr)<1200 or sum(int(r['hit20']) for r in rr)<12:
        return None,len(use),len(rr),sum(int(r['hit20']) for r in rr)
    return v.fit(rr),len(use),len(rr),sum(int(r['hit20']) for r in rr)


def blend_score(long_model,recent_model,val_rows,recent_weight):
    ls=v.score(long_model,val_rows)
    if recent_model is None:
        return [dict(r,regimeScore=r['score'],regimeDisagreement=r['disagreement'],longScore=r['score'],recentScore=None) for r in ls]
    rs=v.score(recent_model,val_rows)
    out=[]
    for l,r in zip(ls,rs):
        s=(1-recent_weight)*float(l['score'])+recent_weight*float(r['score'])
        # Abstain when the long/recent views materially disagree, even if each internal ensemble agrees.
        d=max(float(l['disagreement']),float(r['disagreement']),abs(float(l['score'])-float(r['score'])))
        z=dict(l); z['score']=s; z['disagreement']=d; z['regimeScore']=s; z['regimeDisagreement']=d
        z['longScore']=float(l['score']); z['recentScore']=float(r['score']); out.append(z)
    return out


def select(rows,thr,dismax,topn):
    by=defaultdict(list)
    for r in rows:
        if r['score']>=thr and r['disagreement']<=dismax: by[r['day']].append(r)
    out=[]
    for d,g in by.items(): out += sorted(g,key=lambda x:x['score'],reverse=True)[:topn]
    return out


def evaluate_blocks(blocks):
    candidates=[]
    for window in (10,14,18,24):
      for rw in (.25,.40,.55,.70):
        scored=[]; audits=[]
        for fit_rows,val_rows in blocks:
            lm=v.fit(fit_rows); rm,nd,nr,np_=fit_recent(fit_rows,window)
            if rm is None: scored=[]; break
            sc=blend_score(lm,rm,val_rows,rw); scored.append(sc)
            audits.append({'recentWindowRequested':window,'recentDaysUsed':nd,'recentRows':nr,'recentPositives':np_})
        if len(scored)!=len(blocks): continue
        allr=[r for b in scored for r in b]
        qs=np.quantile([r['score'] for r in allr],[.84,.88,.91,.94,.96,.98])
        for thr in qs:
          for dm in (.05,.08,.12,.16,.22):
            for topn in (2,3,5):
                ms=[]
                for sc in scored:
                    sel=select(sc,float(thr),dm,topn); ms.append(v.v.metrics(sel,sc))
                supports=[m['count'] for m in ms]; days=[m['activeDays'] for m in ms]
                lows=[float(m['dayBlockLower90Pct'] or 0) for m in ms]
                wil=[float(m['wilsonLower90Pct'] or 0) for m in ms]
                prec=[float(m['precision20Pct'] or 0) for m in ms]
                t3=[float(m['top3DailyPrecisionPct'] or 0) for m in ms]
                utility=8*min(lows)+4*min(wil)+1.5*min(prec)+.7*min(t3)-1.3*float(np.std(prec))
                utility += .04*sum(min(x,35) for x in supports)
                if min(supports)<12 or min(days)<5: utility-=250
                candidates.append((utility,window,rw,float(thr),dm,topn,ms,audits))
    if not candidates: raise RuntimeError('no supported recent-regime candidates')
    return max(candidates,key=lambda x:x[0])


def main():
    mode,syms,raw,errs,rows=a.fetch_rows()
    dates=sorted({r['day'] for r in rows})
    if len(dates)<40 or len(rows)<5000: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); dev_dates=dates[:cut]; research_dates=dates[cut:]
    seed=max(12,int(.45*len(dev_dates))); val_dates=dev_dates[seed:]
    bds=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    blocks=[]; foldInfo=[]
    for bd in bds:
        first=bd[0]; fd={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[r for r in rows if r['day'] in fd]; val_rows=[r for r in rows if r['day'] in vd]
        blocks.append((fit_rows,val_rows)); foldInfo.append({'fitDays':len(fd),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows)})
    _,window,rw,thr,dm,topn,foldMetrics,recentAudits=evaluate_blocks(blocks)

    dev=[r for r in rows if r['day'] in set(dev_dates)]; research=[r for r in rows if r['day'] in set(research_dates)]
    lm=v.fit(dev); rm,nd,nr,np_=fit_recent(dev,window)
    if rm is None: raise RuntimeError('selected recent window lacks final development support')
    rs=blend_score(lm,rm,research,rw); rsel=select(rs,thr,dm,topn); researchMetrics=v.v.metrics(rsel,rs)
    vol_obs=sum(1 for r in rows if r.get('feedAudit',{}).get('preVolumeObserved'))
    rep={
      'schemaVersion':'5.23-recent-regime-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['long-history plus recent-window causal ensemble','long-vs-recent disagreement abstention','configuration chosen by worst temporal development block','v5.21 feed-missingness protections retained'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows),'preVolumeObservedPct':round(100*vol_obs/len(rows),2)},
      'development':{'days':len(dev_dates),'folds':foldInfo,'foldMetrics':foldMetrics,'recentAudits':recentAudits},
      'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'scoreThreshold':round(thr,6),'maxLongRecentDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':researchMetrics,'finalRecentFit':{'days':nd,'rows':nr,'positives':np_},
      'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['09:15-only market features','recent model uses only completed sessions before each validation block','configuration selected on development folds only','research tail excluded from selection and already consumed','missing pre-volume is neutralized']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':foldMetrics,'selectedConfig':rep['selectedConfig']},indent=2))
    print(json.dumps(rep,indent=2))

if __name__=='__main__': main()
