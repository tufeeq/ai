#!/usr/bin/env python3
"""TAGit v5.22 actionable execution-aware label validation.

Repairs a label weakness in v5.17-v5.21. Previously hit20 meant only same-session MFE >=20%
from the 09:15 decision price, so a symbol could crash deeply before later rallying and still be
labeled a success. v5.22 trains on an executable-proxy primary label:
  * prediction state frozen at <=09:15 ET,
  * entry proxy = first regular-session bar open (>=09:30 ET),
  * +20% must be reached from that entry proxy,
  * MAE before first +20% hit must be >= -8%, fixed ex ante (not tuned),
  * raw +20% from the 09:15 reference is retained only as a secondary diagnostic.
No regular-session value is added to model features.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, os, pathlib
from collections import defaultdict
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v521.py')
spec=importlib.util.spec_from_file_location('v521',BASE); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
p=r.p; q=r.q; v=r.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v522-free-pit-training.json'; CASES=ROOT/'tagit-v522-free-pit-cases.json'
MAX_PREHIT_MAE=-8.0


def pct(a,b): return (a/b-1.0)*100.0 if a and b else 0.0


def make_rows_actionable(sym,bars):
    by=defaultdict(list)
    for z in bars:
        local=dt.datetime.fromtimestamp(z[0],v.v.UTC).astimezone(v.v.NY)
        by[local.date().isoformat()].append((z,local))
    rows=[]; prev=None
    for day in sorted(by):
        arr=sorted(by[day],key=lambda x:x[0][0]); pre=[]; reg=[]
        for z,local in arr:
            tm=local.time().replace(tzinfo=None)
            if dt.time(4,0)<=tm<=v.v.CUT: pre.append(z)
            elif v.v.OPEN<=tm<v.v.CLOSE: reg.append(z)
        if not pre or not reg:
            if reg: prev=reg
            continue
        if prev is None:
            prev=reg; continue
        pc=prev[-1][4]; prev_hi=max(x[2] for x in prev); prev_lo=min(x[3] for x in prev); prev_vol=sum(x[5] for x in prev)
        px=pre[-1][4]; po=pre[0][1]; hi=max(x[2] for x in pre); lo=min(x[3] for x in pre); pv=sum(x[5] for x in pre)
        def rback(n):
            xs=pre[-n:]; return pct(xs[-1][4],xs[0][1]) if xs else 0.0
        r5=rback(1); r15=rback(3); pret=pct(px,po); gap=pct(px,pc); prng=pct(prev_hi,prev_lo)
        feat=[pret/20,r5/10,r15/15,pct(hi,lo)/20,math.log1p(pv)/20,(px-lo)/(hi-lo) if hi>lo else .5,len(pre)/64,gap/30,prng/20,math.log1p(prev_vol)/20,math.log1p((pv+1)/(prev_vol+1)),(r5-r15/3)/10]

        # Secondary legacy label from 09:15 reference, retained for diagnostics only.
        raw_mfe=pct(max(x[2] for x in reg),px); raw_hit20=raw_mfe>=20.0

        # Primary execution-aware outcome from first regular-session open.
        entry=float(reg[0][1]); fut_hi=max(x[2] for x in reg); fut_lo=min(x[3] for x in reg)
        mfe=pct(fut_hi,entry); mae=pct(fut_lo,entry); hit10=mfe>=10.0
        target=entry*1.20; first_hit=None; min_before=entry
        for z in reg:
            min_before=min(min_before,float(z[3]))
            if float(z[2])>=target:
                first_hit=z; break
        prehit_mae=pct(min_before,entry)
        actionable=bool(first_hit is not None and prehit_mae>=MAX_PREHIT_MAE)
        lead=None
        if actionable:
            lead=(dt.datetime.fromtimestamp(first_hit[0],v.v.UTC).astimezone(v.v.NY)-dt.datetime.combine(dt.date.fromisoformat(day),v.v.CUT,v.v.NY)).total_seconds()/60.0
        rows.append({
            'symbol':sym,'day':day,'feat':feat,'hit20':actionable,'hit10':bool(hit10),'mfe':mfe,'mae':mae,'lead20':lead,
            'decisionPrice':px,'entryPrice':entry,'preBars':len(pre),'preVol':pv,
            'rawHit20From0915':bool(raw_hit20),'rawMfeFrom0915':raw_mfe,'preHitMaeFromOpen':prehit_mae,
            'openGapFromDecisionPct':pct(entry,px),'labelSpec':{'targetPctFromOpen':20.0,'minPreHitMaePct':MAX_PREHIT_MAE}
        })
        prev=reg
    return rows


def fetch_rows():
    mode,syms,raw,errs,_=p.fetch_rows()
    rows=[]
    for s,bars in raw.items():
        if bars: rows.extend(make_rows_actionable(s,bars))
    rows=r.augment_feed_aware(rows)
    return mode,syms,raw,errs,rows


def main():
    mode,syms,raw,errs,rows=fetch_rows()
    dates=sorted({x['day'] for x in rows})
    if len(dates)<40 or len(rows)<5000: raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); dev_dates=dates[:cut]; research_dates=dates[cut:]
    seed=max(12,int(.45*len(dev_dates))); val_dates=dev_dates[seed:]
    blocks=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    scored_blocks=[]; fold_meta=[]
    for bd in blocks:
        first=bd[0]; fit_days={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[x for x in rows if x['day'] in fit_days]; val_rows=[x for x in rows if x['day'] in vd]
        scored,n_oof,n_pos=p.build_meta_from_fit(fit_rows,val_rows)
        scored_blocks.append(scored)
        fold_meta.append({'fitDays':len(fit_days),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows),'oofRows':n_oof,'oofPositives':n_pos})
    grid=p.candidate_grid(scored_blocks); _,mt,bt,dm,topn,fold_metrics=grid[0]
    dev=[x for x in rows if x['day'] in set(dev_dates)]; research=[x for x in rows if x['day'] in set(research_dates)]
    oof=q.expanding_oof(dev); meta=q.fit_meta(oof); base=v.fit(dev)
    rs=q.apply_meta(meta,v.score(base,research)); rsel=q.select_meta(rs,mt,bt,dm,topn); rm=v.v.metrics(rsel,rs)
    raw20=sum(int(x['rawHit20From0915']) for x in rows); act20=sum(int(x['hit20']) for x in rows)
    rejected_path=sum(1 for x in rows if x['rawHit20From0915'] and not x['hit20'])
    rep={
      'schemaVersion':'5.22-actionable-label-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['first-regular-open execution proxy','+20 target measured from execution proxy','fixed pre-hit MAE floor -8%','legacy 09:15 raw hit retained secondary only','feed-aware deterministic ranks retained'],
      'label':{'primary':'first regular open -> +20% with pre-hit MAE >= -8%','secondary':'raw +20% from 09:15 reference','maeThresholdPct':MAX_PREHIT_MAE,'thresholdTuned':False},
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'rawPlus20From0915':raw20,'actionablePlus20':act20,'rawWinsRejectedByExecutionPath':rejected_path},
      'development':{'days':len(dev_dates),'rows':len(dev),'folds':fold_meta,'foldMetrics':fold_metrics},
      'selectedConfig':{'metaThreshold':round(mt,6),'baseThreshold':round(bt,6),'maxDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':rm,'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['all model features frozen at <=09:15 ET','regular-session open/path used only to construct outcome label','no regular-session values enter feat vector','MAE threshold fixed ex ante and never tuned','each validation fold fit strictly on earlier days','configuration chosen from development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':fold_metrics,'selectedConfig':rep['selectedConfig']},indent=2))
    print(json.dumps(rep,indent=2))

if __name__=='__main__': main()
