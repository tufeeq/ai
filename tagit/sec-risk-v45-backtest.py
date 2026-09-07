#!/usr/bin/env python3
"""TAGit v4.5 point-in-time SEC structural-risk backfill.

Goal: test whether *historically available* EDGAR filing context can reduce pre-market
false positives without changing the validated v4 discovery ranker.

Causality:
- Uses the frozen v3.9 ground truth/ranker only.
- Base pre-market events are expanding walk-forward before Aug27; final Aug27-Sep4
  evaluation is never used to choose the SEC policy.
- SEC submissions are filtered by acceptanceDateTime <= event timestamp.
- No current balance-sheet values, no future filing, no document text, no inferred zero.
- Only public filing metadata/forms/items are persisted as aggregate research results.
"""
import json, math, pathlib, runpy, time, urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta

G=runpy.run_path('tagit/event-conviction-v41-backtest.py')
data=G['data']; fit_score=G['fit_score']; enrich=G['enrich']; scode=G['scode']; metrics=G['metrics']; first_events=G['first_events']; sha=G['sha']
OUT=pathlib.Path('tag/data/tagit-v45-sec-risk-backtest.json')
UA='TAGit point-in-time research github.com/tufeeq/ai contact: github-user-tufeeq'
CAP_FORMS={'S-1','S-1/A','S-3','S-3/A','F-1','F-1/A','F-3','F-3/A','424B3','424B4','424B5','EFFECT'}
OFFER_FORMS={'424B3','424B4','424B5'}
REG_FORMS={'S-1','S-1/A','S-3','S-3/A','F-1','F-1/A','F-3','F-3/A','EFFECT'}


def get_json(url,retries=4):
    err=None
    for i in range(retries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/json','Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=15) as r:return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            err=e; time.sleep(0.7*(i+1))
    raise err

def parse_ts(s):
    if not s:return None
    s=str(s).replace('Z','+00:00')
    try:
        d=datetime.fromisoformat(s)
        if d.tzinfo is None:d=d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    except:return None

def event_ts(x):return parse_ts(x.get('ts'))

def ticker_map():
    # Prefer the SEC's own ticker map. GitHub-hosted runners can occasionally
    # receive 403 from www.sec.gov/files, so fall back only for identifier
    # resolution to sec-cik-mapper's pre-generated mapping. Filing/event data
    # itself still comes exclusively from data.sec.gov below.
    try:
        raw=get_json('https://www.sec.gov/files/company_tickers.json')
        out={str(v.get('ticker','')).upper():str(v.get('cik_str','')).zfill(10) for v in raw.values() if isinstance(v,dict)}
        if out:return out
    except Exception:
        pass
    from sec_cik_mapper import StockMapper
    raw=StockMapper().ticker_to_cik
    return {str(t).upper():str(c).zfill(10) for t,c in raw.items() if t and c}

def submissions(cik):
    raw=get_json(f'https://data.sec.gov/submissions/CIK{cik}.json')
    r=(raw.get('filings') or {}).get('recent') or {}
    keys=('form','filingDate','acceptanceDateTime','accessionNumber','items')
    n=max([len(r.get(k) or []) for k in keys] or [0]);out=[]
    for i in range(n):
        z={k:((r.get(k) or [])[i] if i<len(r.get(k) or []) else None) for k in keys}
        at=parse_ts(z.get('acceptanceDateTime'))
        if at:z['acceptedAt']=at
        out.append(z)
    return out

def filing_context(ev, filings):
    t=event_ts(ev)
    if not t:return {'status':'NO_EVENT_TIMESTAMP','riskScore':None}
    prior=[]
    for f in filings:
        at=f.get('acceptedAt')
        if not at or at>t or at<t-timedelta(days=45):continue
        form=str(f.get('form') or '').upper();items=str(f.get('items') or '')
        age=(t-at).total_seconds()/86400.0
        prior.append((age,form,items,at))
    immediate=[];registration=[];capital=[];item302=[]
    for age,form,items,at in prior:
        if form in CAP_FORMS:capital.append((age,form))
        if form in OFFER_FORMS and age<=7:immediate.append((age,form))
        if form in REG_FORMS and age<=14:registration.append((age,form))
        if form=='8-K' and '3.02' in items and age<=14:item302.append((age,form))
    score=0
    if capital:score=max(score,1)
    if registration:score=max(score,2)
    if immediate or item302:score=max(score,3)
    freshest=min([a for a,_,_,_ in prior],default=None)
    return {'status':'PASS','riskScore':score,'immediateOffering7d':bool(immediate),'registration14d':bool(registration),'item302_14d':bool(item302),'capitalMarkets45dCount':len(capital),'freshestFilingAgeDays':round(freshest,2) if freshest is not None else None}

def pre_events(xs):return first_events([x for x in xs if scode(x['session'])==0 and x['gate']])
def active_days(a):return len({x['day'] for x in a})
def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    p=tp/n;den=1+z*z/n;center=p+z*z/(2*n);adj=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)
    return max(0,(center-adj)/den)

# Expanding base-ranker OOF before holdout.
prehold=sorted({x['day'] for x in data if x['day']<='2026-08-26'});oof=[];used=[]
for d in prehold:
    tr=[x for x in data if x['day']<d];te=[x for x in data if x['day']==d]
    if len({x['day'] for x in tr})<4 or sum(bool(x['target']) for x in tr)<12 or not te:continue
    ev=pre_events(enrich(fit_score(tr,te)))
    if ev:oof.extend(ev);used.append(d)
fit=[x for x in data if x['day']<='2026-08-26'];hold=[x for x in data if x['day']>='2026-08-27'];hp=enrich(fit_score(fit,hold));he=pre_events(hp)
all_events=oof+he
symbols=sorted({str(x.get('ticker') or '').upper() for x in all_events if x.get('ticker')})

# Fetch each ticker once; filtering by each event acceptance timestamp happens locally.
tmap=ticker_map();cache={};errors={}
for j,sym in enumerate(symbols):
    cik=tmap.get(sym)
    if not cik:errors[sym]='NO_CIK';continue
    try:cache[sym]=submissions(cik)
    except Exception as e:errors[sym]=type(e).__name__
    time.sleep(0.12)

def attach(events):
    out=[]
    for x in events:
        sym=str(x.get('ticker') or '').upper();fs=cache.get(sym)
        ctx=filing_context(x,fs) if fs is not None else {'status':'UNAVAILABLE','riskScore':None}
        out.append({**x,'secRisk':ctx})
    return out
oof=attach(oof);he=attach(he)

# Candidate vetoes are chosen on OOF only. Unknown context is never treated as safe.
def filt(xs,mode):
    out=[]
    for x in xs:
        r=x['secRisk'].get('riskScore')
        if mode=='BASE':out.append(x);continue
        if r is None:continue
        if mode=='VETO_IMMEDIATE' and r<3:out.append(x)
        elif mode=='VETO_REGISTRATION' and r<2:out.append(x)
        elif mode=='ONLY_CLEAN' and r==0:out.append(x)
    return out
modes=['BASE','VETO_IMMEDIATE','VETO_REGISTRATION','ONLY_CLEAN'];cands=[];baseM=metrics(oof,oof)
for mode in modes:
    a=filt(oof,mode);m=metrics(a,oof);lb=wilson(m['tp'],m['count']);days=active_days(a)
    # reward precision confidence while requiring useful winner retention/support
    rec=(m['recallTickerDayPct'] or 0);support=min(1,m['count']/40)*min(1,m['tp']/8)*min(1,days/5)
    utility=100*lb*support+rec*.12+m['tp']*.8
    cands.append((utility,mode,m,round(lb*100,2),days))
valid=[z for z in cands if z[2]['count']>=30 and z[2]['tp']>=6 and (z[2]['recallTickerDayPct'] or 0)>=60]
best=max(valid if valid else cands,key=lambda z:z[0]);mode=best[1]
ha=filt(he,mode)

def risk_counts(xs):
    d=defaultdict(lambda:{'events':0,'winners':0})
    for x in xs:
        r=x['secRisk'].get('riskScore');k='UNKNOWN' if r is None else str(r)
        d[k]['events']+=1;d[k]['winners']+=int(bool(x['target']))
    return dict(d)
report={
 'schemaVersion':'4.5-research','method':'TAGIT_V45_POINT_IN_TIME_SEC_STRUCTURAL_RISK','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
 'antiLeakage':['frozen v3.9 ranker/ground truth','base OOF day trained only on earlier days','SEC acceptanceDateTime must be <= event timestamp','SEC policy selected on pre-Aug27 OOF only','Aug27-Sep4 evaluation not used to select SEC policy','no filing document text/current financial values/future filings'],
 'secSource':'SEC submissions metadata via data.sec.gov; ticker-to-CIK resolution prefers SEC and may fall back to sec-cik-mapper','riskDefinition':{'1':'capital-markets form within 45d','2':'registration/EFFECT within 14d','3':'424B3/B4/B5 within 7d or 8-K Item 3.02 within 14d'},
 'coverage':{'oofDays':used,'oofEvents':len(oof),'holdoutEvents':len(he),'uniqueSymbols':len(symbols),'mappedSymbols':sum(s in cache for s in symbols),'unavailableSymbols':len(errors),'unavailableExamples':dict(list(errors.items())[:15])},
 'oofRiskDistribution':risk_counts(oof),'holdoutRiskDistribution':risk_counts(he),
 'oofCandidates':[{'mode':z[1],'metrics':z[2],'wilsonLower90Pct':z[3],'activeDays':z[4]} for z in cands],
 'selectedPolicy':mode,
 'holdout':{'basePreFirstEvent':metrics(he,he),'v45SecFilteredFirstEvent':metrics(ha,he),'selectedCount':len(ha)},
 'promotionRule':{'autoPromotion':False,'minHoldoutEvents':15,'minHoldoutWinners':4,'mustImprovePrecisionByPp':2,'retainAtLeastHalfBaseRecall':True},
 'verdict':None
}
b=report['holdout']['basePreFirstEvent'];v=report['holdout']['v45SecFilteredFirstEvent'];pp=(v['precisionPct'] or 0)-(b['precisionPct'] or 0);support=v['count']>=15 and v['tp']>=4;rec=(v['recallTickerDayPct'] or 0)>=.5*(b['recallTickerDayPct'] or 0)
report['verdict']='V45_FORWARD_SHADOW_CONTEXT_CANDIDATE' if mode!='BASE' and pp>=2 and support and rec else 'DO_NOT_PROMOTE_V45_SEC_FILTER'
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
