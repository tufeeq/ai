#!/usr/bin/env python3
"""TAGit v5.27 two-stage causal research validation.

Stage 1 preserves the strongest validated discovery target: raw +20% from the <=09:15 decision
state, with v5.23 long+recent regime adaptation. Stage 2 is an execution-quality hard-negative
gate trained ONLY on prior raw +20 winners, distinguishing actionable first-open paths from raw
winners that violate the fixed -8% pre-hit MAE rule. This avoids forcing one classifier to learn
both rare-event discovery and execution quality simultaneously.

The consumed historical tail remains comparison-only. All configuration selection uses contiguous
development folds only.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, pathlib
from collections import defaultdict
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

P522=pathlib.Path('tagit/free-pit-training-v522.py')
spec=importlib.util.spec_from_file_location('v522',P522); a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
P523=pathlib.Path('tagit/free-pit-training-v523.py')
spec2=importlib.util.spec_from_file_location('v523',P523); r=importlib.util.module_from_spec(spec2); spec2.loader.exec_module(r)
v=a.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v527-free-pit-training.json'; CASES=ROOT/'tagit-v527-free-pit-cases.json'

def detector_rows(rows):
    out=[]
    for x in rows:
        z=dict(x); z['actionableHit20']=bool(x['hit20']); z['hit20']=bool(x['rawHit20From0915']); out.append(z)
    return out

def fit_gate(rows):
    rr=[x for x in rows if x.get('rawHit20From0915')]
    y=np.asarray([int(x['hit20']) for x in rr],int)
    if len(rr)<80 or len(set(y.tolist()))<2:return None,len(rr),int(y.sum())
    X=np.asarray([x['feat'] for x in rr],float)
    sc=StandardScaler().fit(X); xs=sc.transform(X)
    et=ExtraTreesClassifier(n_estimators=350,max_depth=8,min_samples_leaf=5,max_features=.65,class_weight='balanced',n_jobs=-1,random_state=5271).fit(X,y)
    lr=LogisticRegression(max_iter=1000,C=.08,class_weight='balanced',random_state=5272).fit(xs,y)
    return (sc,et,lr),len(rr),int(y.sum())

def gate_score(model, rows):
    if model is None:return np.full(len(rows),.5)
    sc,et,lr=model; X=np.asarray([x['feat'] for x in rows],float); xs=sc.transform(X)
    return .72*et.predict_proba(X)[:,1]+.28*lr.predict_proba(xs)[:,1]

def score_fold(fit_rows,val_rows,window,rw):
    dfit=detector_rows(fit_rows); dval=detector_rows(val_rows)
    lm=v.fit(dfit); rm,_,_,_=r.fit_recent(dfit,window)
    if rm is None:return None,None
    ds=r.blend_score(lm,rm,dval,rw)
    gm,gn,gp=fit_gate(fit_rows); gs=gate_score(gm,val_rows)
    orig={(x['symbol'],x['day']):x for x in val_rows}; out=[]
    for d,g in zip(ds,gs):
        o=orig[(d['symbol'],d['day'])]; z=dict(d)
        z['rawHit20']=bool(d['hit20']); z['hit20']=bool(o['hit20']); z['actionableGateScore']=float(g)
        z['combinedScore']=float(d['score'])*float(.35+.65*g); z['score']=z['combinedScore']; out.append(z)
    return out,{'rawWinnersForGate':gn,'actionableAmongRaw':gp}

def select(rows,thr,gate_thr,dm,topn):
    by=defaultdict(list)
    for x in rows:
        if x['score']>=thr and x['actionableGateScore']>=gate_thr and x['disagreement']<=dm:by[x['day']].append(x)
    out=[]
    for d,g in by.items():out+=sorted(g,key=lambda x:x['score'],reverse=True)[:topn]
    return out

def evaluate(blocks):
    cand=[]
    for window in (14,18,24):
      for rw in (.4,.55,.7):
        scored=[]; audits=[]
        for fitr,valr in blocks:
            s,audit=score_fold(fitr,valr,window,rw)
            if s is None:scored=[];break
            scored.append(s);audits.append(audit)
        if len(scored)!=len(blocks):continue
        vals=[x['score'] for b in scored for x in b]; qs=np.quantile(vals,[.86,.90,.93,.96,.98])
        for thr in qs:
          for gt in (.35,.45,.55,.65):
            for dm in (.08,.12,.16):
              for topn in (2,3,5):
                ms=[v.v.metrics(select(s,float(thr),gt,dm,topn),s) for s in scored]
                counts=[m['count'] for m in ms]; days=[m['activeDays'] for m in ms]
                lows=[float(m['dayBlockLower90Pct'] or 0) for m in ms]; wil=[float(m['wilsonLower90Pct'] or 0) for m in ms]; prec=[float(m['precision20Pct'] or 0) for m in ms]
                util=8*min(lows)+4*min(wil)+1.5*min(prec)-1.2*float(np.std(prec))+.04*sum(min(c,30) for c in counts)
                if min(counts)<10 or min(days)<5:util-=250
                cand.append((util,window,rw,float(thr),gt,dm,topn,ms,audits))
    if not cand:raise RuntimeError('no supported two-stage candidates')
    return max(cand,key=lambda x:x[0])

def main():
    mode,syms,raw,errs,rows=a.fetch_rows(); dates=sorted({x['day'] for x in rows})
    if len(dates)<40 or len(rows)<5000:raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); devd=dates[:cut]; researchd=dates[cut:]
    seed=max(12,int(.45*len(devd))); vald=devd[seed:]
    bds=[list(map(str,x.tolist())) for x in np.array_split(np.array(vald,dtype=object),3) if len(x)]
    blocks=[]; finfo=[]
    for bd in bds:
        fd={d for d in devd if d<bd[0]}; vd=set(bd); fr=[x for x in rows if x['day'] in fd]; vr=[x for x in rows if x['day'] in vd]
        blocks.append((fr,vr));finfo.append({'fitDays':len(fd),'validationDays':len(vd),'fitRows':len(fr),'validationRows':len(vr)})
    _,window,rw,thr,gt,dm,topn,fmetrics,gaud=evaluate(blocks)
    dev=[x for x in rows if x['day'] in set(devd)]; research=[x for x in rows if x['day'] in set(researchd)]
    rs,ga=score_fold(dev,research,window,rw); sel=select(rs,thr,gt,dm,topn); rm=v.v.metrics(sel,rs)
    rep={'schemaVersion':'5.27-two-stage-hard-negative-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT','change':['raw +20 recent-regime discovery stage retained','execution-quality gate trained only on prior raw winners','fixed actionable -8% pre-hit MAE definition retained','two-stage score prevents target conflation'],'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'rawPlus20':sum(int(x['rawHit20From0915']) for x in rows),'actionablePlus20':sum(int(x['hit20']) for x in rows)},'development':{'days':len(devd),'folds':finfo,'foldMetrics':fmetrics,'gateAudits':gaud},'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'combinedScoreThreshold':round(thr,6),'gateThreshold':gt,'maxDetectorDisagreement':dm,'topNPerDay':topn},'researchHoldout':rm,'finalGateAudit':ga,'realDiscoveryPrecisionPct':None,'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},'antiLeakage':['all inference features frozen <=09:15 ET','gate labels use regular path only as outcomes','gate fit only on prior completed raw-winner sessions','configuration selected on development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(rep,indent=2));CASES.write_text(json.dumps({'selectedResearch':sel,'selectedConfig':rep['selectedConfig'],'foldMetrics':fmetrics},indent=2));print(json.dumps(rep,indent=2))
if __name__=='__main__':main()
