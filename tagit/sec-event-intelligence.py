#!/usr/bin/env python3
"""Official SEC event clock for TAGit v4 Top-20 research candidates.

Uses SEC public submissions data only. Persists derived event context, never raw filings.
No SEC event changes v4/v4.1 eligibility; this is forward-measurement context only.
"""
import json, os, pathlib, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

V4=pathlib.Path('tag/data/tagit-v4-shadow.json')
OUT=pathlib.Path('tag/data/tagit-sec-event-shadow.json')
MAP_URL='https://www.sec.gov/files/company_tickers.json'
SUB_URL='https://data.sec.gov/submissions/CIK{cik:010d}.json'
UA=os.environ.get('SEC_USER_AGENT','TAGit/4.4 personal-research https://tufeeq.github.io/ai/')
MAX_CANDIDATES=20
LOOKBACK_DAYS=7
FRESH_HOURS=72

ITEM_MAP={
 '1.01':('MATERIAL_AGREEMENT','CONTEXT'),
 '1.03':('BANKRUPTCY_RECEIVERSHIP','CRITICAL_RISK'),
 '2.01':('M_AND_A_ASSET_EVENT','CONTEXT'),
 '2.02':('EARNINGS_RESULTS','CONTEXT'),
 '2.03':('DEBT_OBLIGATION','RISK_CONTEXT'),
 '3.01':('LISTING_COMPLIANCE','RISK_CONTEXT'),
 '3.02':('UNREGISTERED_EQUITY_SALE','DILUTION_RISK'),
 '5.02':('MANAGEMENT_BOARD_CHANGE','CONTEXT'),
 '7.01':('REG_FD','CONTEXT'),
 '8.01':('OTHER_MATERIAL_EVENT','CONTEXT'),
}
OFFER_FORMS={'S-1','S-1/A','S-3','S-3/A','F-1','F-1/A','F-3','F-3/A','424B1','424B2','424B3','424B4','424B5','424B7','424B8','FWP','POS AM'}


def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def parse_dt(v):
    if not v:return None
    s=str(v).strip()
    try:
        # SEC acceptanceDateTime is usually YYYY-MM-DDTHH:MM:SS.sssZ or offset-aware.
        z=datetime.fromisoformat(s.replace('Z','+00:00'))
        return z.replace(tzinfo=timezone.utc) if z.tzinfo is None else z.astimezone(timezone.utc)
    except Exception:
        try:return datetime.strptime(s[:19],'%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
        except Exception:return None

def get_json(url,retries=3):
    err=None
    for i in range(retries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'gzip, deflate','Accept':'application/json','Host':urllib.request.urlparse(url).netloc if hasattr(urllib.request,'urlparse') else ''})
            # Rebuild without an empty Host header: urllib sets it correctly.
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=12) as r:return json.loads(r.read().decode('utf-8'))
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError) as e:
            err=f'{type(e).__name__}:{getattr(e,"code","")}'
            time.sleep(0.7*(i+1))
    raise RuntimeError(err or 'SEC_FETCH_FAILED')

def rows_from_recent(recent):
    if not isinstance(recent,dict):return []
    n=max([len(v) for v in recent.values() if isinstance(v,list)] or [0]);out=[]
    for i in range(n):
        z={}
        for k,v in recent.items():
            if isinstance(v,list):z[k]=v[i] if i<len(v) else None
        out.append(z)
    return out

def classify(f):
    form=str(f.get('form') or '').upper().strip();items=[]
    raw=str(f.get('items') or '')
    for p in raw.replace(';',',').split(','):
        p=p.strip()
        if p:items.append(p)
    event_types=[];risk=[];contexts=[]
    if form in OFFER_FORMS or form.startswith('424B'):
        event_types.append('OFFERING_REGISTRATION');risk.append('OFFERING_DILUTION_RISK')
    if form=='EFFECT':contexts.append('REGISTRATION_EFFECTIVE')
    if form in ('10-K','10-Q','20-F','40-F','6-K'):contexts.append('PERIODIC_OR_FOREIGN_REPORT')
    for it in items:
        if it in ITEM_MAP:
            et,kind=ITEM_MAP[it];event_types.append(et)
            if kind in ('CRITICAL_RISK','DILUTION_RISK','RISK_CONTEXT'):risk.append(kind+':'+et)
            else:contexts.append(et)
    # Generic 8-K without item metadata is still a recent event, not a positive signal.
    if form=='8-K' and not event_types:contexts.append('8K_UNCLASSIFIED')
    return sorted(set(event_types)),sorted(set(risk)),sorted(set(contexts)),items

v4=read(V4,{})
asof=parse_dt(v4.get('updatedAt')) or datetime.now(timezone.utc)
session=str(v4.get('session') or 'unknown').lower();day=v4.get('tradingDateET')
candidates=[]
for x in v4.get('items') or []:
    if x.get('shadowGatePassed') or int(x.get('rank') or 999)<=MAX_CANDIDATES:
        candidates.append((int(x.get('rank') or 999),str(x.get('symbol') or '').upper()))
candidates=sorted({(r,s) for r,s in candidates if s})[:MAX_CANDIDATES]

payload={'schemaVersion':1,'source':'SEC data.sec.gov submissions derived event clock','sourceOfficial':True,'updatedAtUTC':datetime.now(timezone.utc).isoformat(),'asOfUTC':asof.isoformat(),'tradingDateET':day,'session':session,
 'policy':'SHADOW_CONTEXT_ONLY_NO_ALERT_OVERRIDE','futureSafe':True,'rawFilingsPersisted':False,'candidateLimit':MAX_CANDIDATES,'lookbackDays':LOOKBACK_DAYS,'freshHours':FRESH_HOURS,
 'counts':{'requested':len(candidates),'mapped':0,'succeeded':0,'withRecentEvent':0,'withFreshEvent':0,'withRiskFlag':0},'errors':{},'items':[]}

if not candidates:
    OUT.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(payload,indent=2));raise SystemExit(0)

try:
    mapping=get_json(MAP_URL)
except Exception as e:
    payload['status']='DEGRADED';payload['reason']='SEC_TICKER_MAP_UNAVAILABLE';payload['errors']['mapping']=type(e).__name__
    OUT.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(payload,indent=2));raise SystemExit(0)

by_ticker={}
for z in (mapping.values() if isinstance(mapping,dict) else []):
    if not isinstance(z,dict):continue
    t=str(z.get('ticker') or '').upper();c=z.get('cik_str')
    if t and c is not None:
        try:by_ticker[t]=int(c)
        except:pass

cut=asof-timedelta(days=LOOKBACK_DAYS)
for rank,sym in candidates:
    cik=by_ticker.get(sym)
    base={'symbol':sym,'rank':rank,'cik':cik,'sourceOfficial':True,'asOfUTC':asof.isoformat(),'eventTypes':[],'riskFlags':[],'contextFlags':[],'latestForm':None,'latestAcceptedAt':None,'latestItems':[],'freshWithin72h':False,'filingsConsidered':0}
    if cik is None:
        base['status']='NO_SEC_TICKER_MAPPING';payload['items'].append(base);continue
    payload['counts']['mapped']+=1
    try:
        sub=get_json(SUB_URL.format(cik=cik));payload['counts']['succeeded']+=1
    except Exception as e:
        base['status']='SEC_SUBMISSIONS_FETCH_FAILED';payload['errors'][sym]=type(e).__name__;payload['items'].append(base);time.sleep(.13);continue
    filings=[]
    for f in rows_from_recent(((sub.get('filings') or {}).get('recent') or {})):
        accepted=parse_dt(f.get('acceptanceDateTime'))
        if accepted is None:
            # filingDate has day precision; never infer intraday causality from it.
            continue
        if accepted>asof or accepted<cut:continue
        et,risk,ctx,its=classify(f)
        filings.append({'acceptedAt':accepted,'form':str(f.get('form') or ''),'accessionNumber':f.get('accessionNumber'),'items':its,'eventTypes':et,'riskFlags':risk,'contextFlags':ctx})
    filings.sort(key=lambda z:z['acceptedAt'],reverse=True);base['filingsConsidered']=len(filings)
    all_ev=[];all_risk=[];all_ctx=[]
    for f in filings:
        all_ev+=f['eventTypes'];all_risk+=f['riskFlags'];all_ctx+=f['contextFlags']
    base['eventTypes']=sorted(set(all_ev));base['riskFlags']=sorted(set(all_risk));base['contextFlags']=sorted(set(all_ctx))
    if filings:
        f=filings[0];base['latestForm']=f['form'];base['latestAcceptedAt']=f['acceptedAt'].isoformat();base['latestItems']=f['items'];base['latestEventTypes']=f['eventTypes'];base['latestRiskFlags']=f['riskFlags'];base['latestContextFlags']=f['contextFlags'];base['freshWithin72h']=(asof-f['acceptedAt']).total_seconds()<=FRESH_HOURS*3600
        payload['counts']['withRecentEvent']+=1
        if base['freshWithin72h']:payload['counts']['withFreshEvent']+=1
    if base['riskFlags']:payload['counts']['withRiskFlag']+=1
    base['status']='PASS';payload['items'].append(base);time.sleep(.13)

payload['status']='PASS' if payload['counts']['succeeded'] else 'DEGRADED'
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in payload.items() if k!='items'},ensure_ascii=False,indent=2))
