#!/usr/bin/env python3
"""TAGit v5.26 ordinal path continuation research validation.

Targets a concrete false-positive pattern observed in v5.23: many selected names ignite to +10..+19%
but fail to complete the actionable +20% path. v5.26 learns three nested execution-aware path labels
(+10%, +15%, +20%), all from first regular-session open with a fixed pre-hit MAE floor of -8%.
A causal long+recent ensemble is fit separately for each stage. The final score is a fixed geometric
combination that favors +20 while requiring support from +15/+10; monotonic probability violations
and long-vs-recent disagreement are included in abstention. Development-fold selection only; consumed
research tail remains comparison-only.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, pathlib
from collections import defaultdict
import numpy as np

P522=pathlib.Path('tagit/free-pit-training-v522.py')
spec=importlib.util.spec_from_file_location('v522',P522); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
P523=pathlib.Path('tagit/free-pit-training-v523.py')
spec2=importlib.util.spec_from_file_location('v523',P523); c=importlib.util.module_from_spec(spec2); spec2.loader.exec_module(c)
v=b.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v526-free-pit-training.json'; CASES=ROOT/'tagit-v526-free-pit-cases.json'
MAE_FLOOR=-8.0


def pct(a,b): return (a/b-1.0)*100.0 if a and b else 0.0


def path_label(reg,entry,target_pct):
    target=entry*(1.0+target_pct/100.0); min_before=entry; first=None
    for z in reg:
        min_before=min(min_before,float(z[3]))
        if float(z[2])>=target:
            first=z; break
    mae=pct(min_before,entry)
    ok=bool(first is not None and mae>=MAE_FLOOR)
    return ok,mae,first


def make_rows_ordinal(sym,bars):
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
        entry=float(reg[0][1]); fut_hi=max(x[2] for x in reg); fut_lo=min(x[3] for x in reg)
        a10,m10,h10=path_label(reg,entry,10.0); a15,m15,h15=path_label(reg,entry,15.0); a20,m20,h20=path_label(reg,entry,20.0)
        lead20=None
        if a20:
            lead20=(dt.datetime.fromtimestamp(h20[0],v.v.UTC).astimezone(v.v.NY)-dt.datetime.combine(dt.date.fromisoformat(day),v.v.CUT,v.v.NY)).total_seconds()/60.0
        raw_mfe=pct(max(x[2] for x in reg),px)
        rows.append({'symbol':sym,'day':day,'feat':feat,'hit20':a20,'hit10':a10,'path10':a10,'path15':a15,'path20':a20,
                     'mfe':pct(fut_hi,entry),'mae':pct(fut_lo,entry),'lead20':lead20,'decisionPrice':px,'entryPrice':entry,
                     'preBars':len(pre),'preVol':pv,'rawHit20From0915':raw_mfe>=20.0,'rawMfeFrom0915':raw_mfe,
                     'preHitMae10':m10,'preHitMae15':m15,'preHitMae20':m20})
        prev=reg
    return rows


def fetch_rows():
    mode,syms,raw,errs,_=b.p.fetch_rows()
    rows=[]
    for s,bars in raw.items():
        if bars: rows.extend(make_rows_ordinal(s,bars))
    rows=b.r.augment_feed_aware(rows)
    return mode,syms,raw,errs,rows


def relabel(rows,key):
    return [dict(r,hit20=bool(r[key])) for r in rows]


def fit_recent_target(rows,key,window):
    days=sorted({r['day'] for r in rows}); use=set(days[-min(window,len(days)):]); rr=[r for r in rows if r['day'] in use]
    mapped=relabel(rr,key); pos=sum(int(x['hit20']) for x in mapped)
    if len(mapped)<1200 or pos<12:return None,len(use),len(mapped),pos
    return v.fit(mapped),len(use),len(mapped),pos


def stage_score(fit_rows,val_rows,key,window,rw):
    lm=v.fit(relabel(fit_rows,key)); rm,nd,nr,np_=fit_recent_target(fit_rows,key,window)
    if rm is None:return None,(nd,nr,np_)
    return c.blend_score(lm,rm,val_rows,rw),(nd,nr,np_)


def combine(s10,s15,s20):
    out=[]
    for a,d,e in zip(s10,s15,s20):
        p10=max(float(a['score']),1e-6); p15=max(float(d['score']),1e-6); p20=max(float(e['score']),1e-6)
        score=(p20**0.60)*(p15**0.25)*(p10**0.15)
        violation=max(0.0,p20-p15)+max(0.0,p15-p10)
        disagreement=max(float(a['disagreement']),float(d['disagreement']),float(e['disagreement']),violation)
        z=dict(e); z['score']=score; z['disagreement']=disagreement; z['path10Score']=p10; z['path15Score']=p15; z['path20Score']=p20; z['ordinalViolation']=violation
        out.append(z)
    return out


def select(rows,thr,dm,topn):
    by=defaultdict(list)
    for r in rows:
        if r['score']>=thr and r['disagreement']<=dm: by[r['day']].append(r)
    out=[]
    for day,g in by.items():out+=sorted(g,key=lambda x:x['score'],reverse=True)[:topn]
    return out


def evaluate(blocks):
    cand=[]
    for window in (14,18,24):
      for rw in (.40,.55,.70):
        scored=[]; audits=[]
        for fit_rows,val_rows in blocks:
            x10,a10=stage_score(fit_rows,val_rows,'path10',window,rw); x15,a15=stage_score(fit_rows,val_rows,'path15',window,rw); x20,a20=stage_score(fit_rows,val_rows,'path20',window,rw)
            if x10 is None or x15 is None or x20 is None: scored=[]; break
            scored.append(combine(x10,x15,x20)); audits.append({'path10':a10,'path15':a15,'path20':a20})
        if len(scored)!=len(blocks):continue
        allr=[r for z in scored for r in z]; qs=np.quantile([r['score'] for r in allr],[.84,.88,.91,.94,.96,.98])
        for thr in qs:
          for dm in (.05,.08,.12,.16,.22):
            for topn in (2,3,5):
                ms=[v.v.metrics(select(sc,float(thr),dm,topn),sc) for sc in scored]
                supports=[m['count'] for m in ms]; days=[m['activeDays'] for m in ms]
                lows=[float(m['dayBlockLower90Pct'] or 0) for m in ms]; wil=[float(m['wilsonLower90Pct'] or 0) for m in ms]
                prec=[float(m['precision20Pct'] or 0) for m in ms]; t3=[float(m['top3DailyPrecisionPct'] or 0) for m in ms]
                utility=8*min(lows)+4*min(wil)+1.5*min(prec)+.7*min(t3)-1.3*float(np.std(prec))+.04*sum(min(x,35) for x in supports)
                if min(supports)<10 or min(days)<5:utility-=250
                cand.append((utility,window,rw,float(thr),dm,topn,ms,audits))
    if not cand:raise RuntimeError('no supported ordinal path candidates')
    return max(cand,key=lambda x:x[0])


def main():
    mode,syms,raw,errs,rows=fetch_rows(); dates=sorted({r['day'] for r in rows})
    if len(dates)<40 or len(rows)<5000:raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); dev_dates=dates[:cut]; research_dates=dates[cut:]
    seed=max(12,int(.45*len(dev_dates))); val_dates=dev_dates[seed:]
    bds=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    blocks=[]; fold_info=[]
    for bd in bds:
        first=bd[0]; fd={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[r for r in rows if r['day'] in fd]; val_rows=[r for r in rows if r['day'] in vd]
        blocks.append((fit_rows,val_rows)); fold_info.append({'fitDays':len(fd),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows)})
    _,window,rw,thr,dm,topn,fold_metrics,audits=evaluate(blocks)
    dev=[r for r in rows if r['day'] in set(dev_dates)]; research=[r for r in rows if r['day'] in set(research_dates)]
    scores=[]; final_aud={}
    for key in ('path10','path15','path20'):
        lm=v.fit(relabel(dev,key)); rm,nd,nr,np_=fit_recent_target(dev,key,window)
        if rm is None:raise RuntimeError(f'{key} recent model lacks support')
        scores.append(c.blend_score(lm,rm,research,rw)); final_aud[key]={'days':nd,'rows':nr,'positives':np_}
    rs=combine(*scores); rsel=select(rs,thr,dm,topn); rm=v.v.metrics(rsel,rs)
    rep={'schemaVersion':'5.26-ordinal-path-pit','generatedAtUTC':dt.datetime.now(v.v.UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
         'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
         'change':['execution-aware +10/+15/+20 nested path labels','fixed geometric ordinal path score','monotonicity-violation abstention','long+recent causal models at each stage','missing-volume protections retained'],
         'label':{'entry':'first regular-session open','targetsPct':[10,15,20],'preHitMaeFloorPct':MAE_FLOOR,'thresholdTuned':False},
         'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'path10':sum(r['path10'] for r in rows),'path15':sum(r['path15'] for r in rows),'path20':sum(r['path20'] for r in rows)},
         'development':{'days':len(dev_dates),'folds':fold_info,'foldMetrics':fold_metrics,'stageAudits':audits},
         'selectedConfig':{'recentWindowDays':window,'recentWeight':rw,'scoreThreshold':round(thr,6),'maxCombinedDisagreement':dm,'topNPerDay':topn,'pathWeights':{'p20':.60,'p15':.25,'p10':.15}},
         'researchHoldout':rm,'finalStageFits':final_aud,'realDiscoveryPrecisionPct':None,
         'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'marketWidePrecisionClaimAllowed':False},
         'antiLeakage':['all features frozen <=09:15 ET','regular-session path used only for labels','nested path thresholds fixed ex ante','recent models use only completed sessions before each validation block','configuration selected on development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(rep,indent=2));CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':fold_metrics,'selectedConfig':rep['selectedConfig']},indent=2));print(json.dumps(rep,indent=2))

if __name__=='__main__':main()
