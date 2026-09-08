#!/usr/bin/env python3
"""TAGit v5.31.1 asymmetric recurrent-veto PIT validation.

Computational repair of v5.31. The original exhaustive gate x threshold x disagreement grid hit the
GitHub Actions timeout. This version keeps identical causal features and outcome definitions but uses
a two-stage DEVELOPMENT-ONLY search: (1) coarse gate ranking at a fixed development quantile and
selection policy, then (2) full threshold/disagreement/top-N refinement only for the strongest gate
candidates. The consumed research tail is never used for either stage.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, pathlib
import numpy as np

P530=pathlib.Path('tagit/free-pit-training-v530.py')
spec=importlib.util.spec_from_file_location('v530',P530); a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
v=a.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v531-free-pit-training.json'; CASES=ROOT/'tagit-v531-free-pit-cases.json'


def asym_gate(base_sc,rec_sc,min_sessions,down_strength,up_strength,up_min_sessions,deadband):
    out=[]
    for bs,rs in zip(base_sc,rec_sc):
        n=int((rs.get('recurrenceAudit') or {}).get('priorSessions',0))
        rel=max(0.0,min(1.0,(n-min_sessions+1)/8.0)) if n>=min_sessions else 0.0
        coh=max(0.0,1.0-min(1.0,float(rs.get('disagreement',1.0))/0.22))
        delta=float(rs['score'])-float(bs['score']); g=0.0
        if delta < -deadband:
            g=down_strength*rel*coh
        elif delta > deadband and n>=up_min_sessions:
            uprel=max(0.0,min(1.0,(n-up_min_sessions+1)/10.0))
            g=up_strength*uprel*coh
        s=float(bs['score'])+g*delta
        d=max(float(bs['disagreement']),g*float(rs['disagreement']),g*abs(delta))
        z=dict(bs); z.update(score=s,disagreement=d,baseExpertScore=float(bs['score']),recurrentExpertScore=float(rs['score']),recurrentGate=g,recurrentDelta=delta,recurrentPriorSessions=n)
        out.append(z)
    return out


def utility(ms):
    supports=[x['count'] for x in ms]; days=[x['activeDays'] for x in ms]
    lows=[float(x['dayBlockLower90Pct'] or 0) for x in ms]
    wil=[float(x['wilsonLower90Pct'] or 0) for x in ms]
    prec=[float(x['precision20Pct'] or 0) for x in ms]
    t3=[float(x['top3DailyPrecisionPct'] or 0) for x in ms]
    u=8.5*min(lows)+4.5*min(wil)+1.6*min(prec)+.5*min(t3)-1.6*float(np.std(prec))+.04*sum(min(x,35) for x in supports)
    if min(supports)<12 or min(days)<5: u-=250
    return u


def evaluate(blocks):
    # Fit/score each expert exactly once per temporal fold/window/rw. No model refit inside gate search.
    score_cache={}; audits_cache={}
    for window in (14,18,24):
      for rw in (.25,.40,.55):
        scored=[]; audits=[]
        for fb,fr,vb,vr in blocks:
            bm=a.fit_expert(fb,window); rm=a.fit_expert(fr,window)
            if bm[1] is None or rm[1] is None: scored=[]; break
            scored.append((a.score_expert(bm,vb,rw),a.score_expert(rm,vr,rw)))
            audits.append({'recentWindowRequested':window,'baseRecentDays':bm[2],'recurrentRecentDays':rm[2]})
        if scored:
            score_cache[(window,rw)]=scored; audits_cache[(window,rw)]=audits

    # Stage 1: coarse DEVELOPMENT-only gate screening. Fixed policy prevents combinatorial explosion.
    coarse=[]; gate_count=0
    for (window,rw),scored in score_cache.items():
      for mins in (2,4,6):
        for downs in (.55,.75,1.0):
          for ups in (.10,.20,.35):
            for upmins in (6,8,10):
              for db in (.005,.015,.03):
                gate_count+=1
                gated=[asym_gate(x,y,mins,downs,ups,upmins,db) for x,y in scored]
                vals=[r['score'] for q in gated for r in q]
                thr=float(np.quantile(vals,.94))
                ms=[v.v.metrics(a.select(sc,thr,.16,5),sc) for sc in gated]
                coarse.append((utility(ms),window,rw,mins,downs,ups,upmins,db,gated,ms))

    if not coarse: raise RuntimeError('no supported v5.31 coarse candidates')
    # Keep diverse top candidates; 18 gives broad gate coverage while cutting full evaluations ~13x.
    coarse.sort(key=lambda x:x[0],reverse=True); shortlist=coarse[:18]

    # Stage 2: full DEVELOPMENT-only selection-policy refinement on shortlisted gates.
    refined=[]; refined_evals=0
    for _,window,rw,mins,downs,ups,upmins,db,gated,_ in shortlist:
        vals=[r['score'] for q in gated for r in q]
        qs=np.quantile(vals,[.84,.88,.91,.94,.96,.98])
        for thr in qs:
          for dm in (.08,.12,.16,.22):
            for topn in (3,5):
                refined_evals+=1
                ms=[v.v.metrics(a.select(sc,float(thr),dm,topn),sc) for sc in gated]
                refined.append((utility(ms),window,rw,mins,downs,ups,upmins,db,float(thr),dm,topn,ms,audits_cache[(window,rw)]))
    if not refined: raise RuntimeError('no supported v5.31 refined candidates')
    best=max(refined,key=lambda x:x[0])
    return best,{'gateCandidatesCoarse':gate_count,'gateShortlist':len(shortlist),'policyRefinements':refined_evals,'searchTailAccess':False}


def main():
    mode,syms,raw,errs,base,rec=a.paired_rows(); dates=sorted({x['day'] for x in base})
    if len(dates)<40 or len(base)<5000: raise RuntimeError(f'insufficient rows={len(base)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); devd=dates[:cut]; researchd=dates[cut:]; seed=max(12,int(.45*len(devd))); vald=devd[seed:]
    bds=[list(map(str,x.tolist())) for x in np.array_split(np.array(vald,dtype=object),3) if len(x)]
    blocks=[]; finfo=[]
    for bd in bds:
        fd={d for d in devd if d<bd[0]}; vd=set(bd)
        fb=[x for x in base if x['day'] in fd]; fr=[x for x in rec if x['day'] in fd]; vb=[x for x in base if x['day'] in vd]; vr=[x for x in rec if x['day'] in vd]
        blocks.append((fb,fr,vb,vr)); finfo.append({'fitDays':len(fd),'validationDays':len(vd),'fitRows':len(fb),'validationRows':len(vb)})
    best,search_audit=evaluate(blocks)
    _,window,rw,mins,downs,ups,upmins,db,thr,dm,topn,fmetrics,audits=best

    # Consumed research tail is accessed only once AFTER every configuration choice is frozen.
    devset=set(devd); researchset=set(researchd)
    devb=[x for x in base if x['day'] in devset]; devr=[x for x in rec if x['day'] in devset]; rb=[x for x in base if x['day'] in researchset]; rr=[x for x in rec if x['day'] in researchset]
    bm=a.fit_expert(devb,window); rm=a.fit_expert(devr,window); bs=a.score_expert(bm,rb,rw); rs=a.score_expert(rm,rr,rw)
    scores=asym_gate(bs,rs,mins,downs,ups,upmins,db); sel=a.select(scores,thr,dm,topn); hm=v.v.metrics(sel,scores)
    gv=[x['recurrentGate'] for x in scores]; neg=[x for x in scores if x['recurrentDelta']<0]; pos=[x for x in scores if x['recurrentDelta']>0]
    rep={'schemaVersion':'5.31.1-asymmetric-recurrent-veto-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['retain v5.30 separate baseline/recurrent experts','asymmetric recurrent veto','two-stage development-only gate search','cache expert predictions before gate/policy search','research tail accessed only after configuration freeze'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(base),'days':len(dates),'plus20':sum(int(x['hit20']) for x in base)},
      'development':{'days':len(devd),'folds':finfo,'foldMetrics':fmetrics,'recentAudits':audits,'searchAudit':search_audit},
      'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'minPriorSessionsForVeto':mins,'downStrength':downs,'upStrength':ups,'upMinPriorSessions':upmins,'deadband':db,'scoreThreshold':round(thr,6),'maxDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':hm,'gateAudit':{'meanGate':round(float(np.mean(gv)),4),'nonzeroGatePct':round(100*sum(x>0 for x in gv)/len(gv),2),'negativeDeltaRows':len(neg),'positiveDeltaRows':len(pos)},'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['all inference market features <=09:15 ET','baseline expert receives no recurrent features','recurrent expert memory prior completed sessions only','asymmetric gate uses only prior-session count and model scores/disagreement','coarse and refined search use development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':sel,'selectedConfig':rep['selectedConfig'],'foldMetrics':fmetrics,'gateAudit':rep['gateAudit'],'searchAudit':search_audit},indent=2)); print(json.dumps(rep,indent=2))
if __name__=='__main__': main()
