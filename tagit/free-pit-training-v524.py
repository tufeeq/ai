#!/usr/bin/env python3
"""TAGit v5.24 free SEC point-in-time context research validation.

Adds only SEC filings whose exact EDGAR acceptance timestamp is <= the 09:15 ET decision cutoff.
Current ticker->CIK mapping is used only as an identity bridge and does NOT upgrade universe
integrity. Same-day filings lacking an exact timestamp are excluded. The consumed research tail
remains comparison-only.
"""
from __future__ import annotations
import datetime as dt, importlib.util, json, math, pathlib, time, urllib.request
from collections import defaultdict
from zoneinfo import ZoneInfo
import numpy as np

BASE=pathlib.Path('tagit/free-pit-training-v521.py')
spec=importlib.util.spec_from_file_location('v521',BASE); a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
p=a.p; q=a.q; v=a.v
ROOT=pathlib.Path('tag/data'); OUT=ROOT/'tagit-v524-free-pit-training.json'; CASES=ROOT/'tagit-v524-free-pit-cases.json'
NY=ZoneInfo('America/New_York'); UTC=dt.timezone.utc
SEC_UA='TAGit-research/5.24 tufeeq-ai@users.noreply.github.com'


def sec_json(url,timeout=30):
    req=urllib.request.Request(url,headers={'User-Agent':SEC_UA,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return json.loads(r.read().decode())


def parse_acceptance(x):
    if x is None:return None
    s=str(x).strip()
    if not s:return None
    try:
        if len(s)==14 and s.isdigit():
            return dt.datetime.strptime(s,'%Y%m%d%H%M%S').replace(tzinfo=NY).astimezone(UTC)
        z=dt.datetime.fromisoformat(s.replace('Z','+00:00'))
        if z.tzinfo is None:z=z.replace(tzinfo=NY)
        return z.astimezone(UTC)
    except Exception:return None


def load_ticker_cik():
    d=sec_json('https://www.sec.gov/files/company_tickers.json')
    out={}
    vals=d.values() if isinstance(d,dict) else d
    for z in vals:
        try:
            t=str(z.get('ticker') or '').upper().strip(); cik=int(z.get('cik_str'))
            if t:out[t]=f'{cik:010d}'
        except Exception:continue
    return out


def fetch_company_filings(cik):
    d=sec_json(f'https://data.sec.gov/submissions/CIK{cik}.json')
    r=((d.get('filings') or {}).get('recent') or {})
    forms=r.get('form') or []; acc=r.get('acceptanceDateTime') or []; filed=r.get('filingDate') or []; accession=r.get('accessionNumber') or []
    n=max(len(forms),len(acc),len(filed),len(accession),0); out=[]
    for i in range(n):
        form=str(forms[i] if i<len(forms) else '').upper().strip()
        at=parse_acceptance(acc[i] if i<len(acc) else None)
        # Fail closed: without exact acceptance timestamp the record is never used as a feature.
        if at is None:continue
        out.append({'acceptedUTC':at,'form':form,'filingDate':str(filed[i] if i<len(filed) else ''),'accession':str(accession[i] if i<len(accession) else '')})
    return out


def collect_sec(symbols):
    mapping=load_ticker_cik(); out={}; errors={}; mapped=0
    for i,s in enumerate(symbols):
        cik=mapping.get(s)
        if not cik:continue
        mapped+=1
        try: out[s]=fetch_company_filings(cik)
        except Exception as e: errors[s]=f'{type(e).__name__}:{e}'
        # SEC fair-access friendly sequential pacing; no burst concurrency.
        time.sleep(.12)
    return out,errors,mapped


def is_financing_form(form):
    f=form.upper()
    return f.startswith(('S-1','S-3','F-1','F-3','424B')) or f in {'EFFECT','POS AM','RW'}


def sec_features(filings,day):
    cut=dt.datetime.combine(dt.date.fromisoformat(day),dt.time(9,15),NY).astimezone(UTC)
    usable=[x for x in filings if x['acceptedUTC']<=cut]
    h24=[x for x in usable if x['acceptedUTC']>=cut-dt.timedelta(hours=24)]
    h72=[x for x in usable if x['acceptedUTC']>=cut-dt.timedelta(hours=72)]
    d7=[x for x in usable if x['acceptedUTC']>=cut-dt.timedelta(days=7)]
    same=[x for x in usable if x['acceptedUTC'].astimezone(NY).date()==dt.date.fromisoformat(day)]
    fin72=[x for x in h72 if is_financing_form(x['form'])]
    return [
        min(len(h24),5)/5.0,
        min(len(h72),10)/10.0,
        math.log1p(len(d7))/3.0,
        float(bool(fin72)),
        min(len(fin72),4)/4.0,
        float(any(x['form'].startswith('8-K') for x in h24)),
        float(any(x['form'].startswith('6-K') for x in h24)),
        float(any(x['form'].startswith(('10-Q','10-K','20-F','40-F')) for x in d7)),
        min(len(same),3)/3.0,
    ],{'filings24h':len(h24),'filings72h':len(h72),'filings7d':len(d7),'financing72h':len(fin72),'sameDayPre0915':len(same)}


def attach_sec(rows,sec_by_symbol):
    out=[]; withctx=0; with_recent=0
    for r in rows:
        fs=sec_by_symbol.get(r['symbol'])
        mapped=fs is not None
        feat,audit=sec_features(fs or [],r['day'])
        if mapped:withctx+=1
        if audit['filings7d']>0:with_recent+=1
        z=dict(r); z['feat']=list(r['feat'])+feat+[float(mapped)]
        z['secAudit']=dict(audit,identityMapped=mapped,exactAcceptanceOnly=True)
        out.append(z)
    return out,withctx,with_recent


def main():
    mode,syms,raw,errs,rows=a.fetch_rows()
    sec_by_symbol,sec_errors,mapped=collect_sec(syms)
    rows,ctx_rows,recent_rows=attach_sec(rows,sec_by_symbol)
    dates=sorted({r['day'] for r in rows})
    if len(dates)<40 or len(rows)<5000:raise RuntimeError(f'insufficient rows={len(rows)} days={len(dates)}')
    cut=max(1,int(.80*len(dates))); dev_dates=dates[:cut]; research_dates=dates[cut:]
    seed=max(12,int(.45*len(dev_dates))); val_dates=dev_dates[seed:]
    blocks=[list(map(str,x.tolist())) for x in np.array_split(np.array(val_dates,dtype=object),3) if len(x)]
    scored_blocks=[]; fold_meta=[]
    for bd in blocks:
        first=bd[0]; fit_days={d for d in dev_dates if d<first}; vd=set(bd)
        fit_rows=[r for r in rows if r['day'] in fit_days]; val_rows=[r for r in rows if r['day'] in vd]
        scored,n_oof,n_pos=p.build_meta_from_fit(fit_rows,val_rows)
        scored_blocks.append(scored); fold_meta.append({'fitDays':len(fit_days),'validationDays':len(vd),'fitRows':len(fit_rows),'validationRows':len(val_rows),'oofRows':n_oof,'oofPositives':n_pos})
    grid=p.candidate_grid(scored_blocks); _,mt,bt,dm,topn,fold_metrics=grid[0]
    dev=[r for r in rows if r['day'] in set(dev_dates)]; research=[r for r in rows if r['day'] in set(research_dates)]
    oof=q.expanding_oof(dev); meta=q.fit_meta(oof); base=v.fit(dev)
    rs=q.apply_meta(meta,v.score(base,research)); rsel=q.select_meta(rs,mt,bt,dm,topn); rm=v.v.metrics(rsel,rs)
    rep={
      'schemaVersion':'5.24-sec-pit','generatedAtUTC':dt.datetime.now(UTC).isoformat(),'status':'COMPLETE','dataMode':mode,
      'validationStatus':'RESEARCH_COMPARISON_ONLY','holdoutStatus':'CONSUMED_RESEARCH_HOLDOUT',
      'change':['free SEC submissions context','exact EDGAR acceptance-time cutoff <=09:15 ET','financing/dilution-form risk context','8-K/6-K/periodic-filing recency context','v5.21 feed-aware ranks retained'],
      'population':{'symbolsRequested':len(syms),'symbolsSucceeded':sum(bool(x) for x in raw.values()),'independentTickerDays':len(rows),'days':len(dates),'plus20':sum(r['hit20'] for r in rows)},
      'secCoverage':{'tickerCikMappedSymbols':mapped,'submissionsFetchedSymbols':len(sec_by_symbol),'fetchErrors':len(sec_errors),'rowsIdentityMapped':ctx_rows,'rowsWithExactAcceptedFiling7d':recent_rows,'rowsWithExactAcceptedFiling7dPct':round(100*recent_rows/len(rows),2)},
      'development':{'days':len(dev_dates),'folds':fold_meta,'foldMetrics':fold_metrics},
      'selectedConfig':{'metaThreshold':round(mt,6),'baseThreshold':round(bt,6),'maxDisagreement':dm,'topNPerDay':topn},
      'researchHoldout':rm,'realDiscoveryPrecisionPct':None,
      'providerIntegrity':{'historicalPointInTimeUniverse':False,'survivorshipSafe':False,'secContextPointInTime':True,'marketWidePrecisionClaimAllowed':False},
      'antiLeakage':['market features <=09:15 ET','SEC feature includes only exact acceptance timestamps <=09:15 ET','filings without exact acceptance timestamp excluded','SEC context never uses future filings','configuration selected on development folds only','research tail excluded from selection and already consumed']}
    ROOT.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(rep,indent=2)); CASES.write_text(json.dumps({'selectedResearch':rsel,'foldMetrics':fold_metrics,'selectedConfig':rep['selectedConfig']},indent=2))
    print(json.dumps(rep,indent=2))

if __name__=='__main__':main()
