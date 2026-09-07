#!/usr/bin/env python3
"""Official SEC event clock for TAGit v4 Top-20 research candidates.

Uses SEC public submissions data only. Persists derived event context, never raw filings.
No SEC event changes v4/v4.1 eligibility; this is forward-measurement context only.
Ticker-to-CIK resolution prefers SEC; a public pre-generated mapping is only a fallback
for identifier resolution when www.sec.gov/files blocks a hosted runner.
"""
import json, os, pathlib, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

V4=pathlib.Path('tag/data/tagit-v4-shadow.json')
OUT=pathlib.Path('tag/data/tagit-sec-event-shadow.json')
MAP_URLS=['https://www.sec.gov/files/company_tickers.json','https://www.sec.gov/files/company_tickers_exchange.json']
FALLBACK_MAP_URL='https://raw.githubusercontent.com/jadchaar/sec-cik-mapper/main/mappings/stocks/ticker_to_cik.json'
SUB_URL='https://data.sec.gov/submissions/CIK{cik:010d}.json'
UA=os.environ.get('SEC_USER_AGENT','TAGit/4.5 tufeeq@users.noreply.github.com')
MAX_CANDIDATES=20
LOOKBACK_DAYS=7
FRESH_HOURS=72

ITEM_MAP={
 '1.01':('MATERIAL_AGREEMENT','CONTEXT'),'1.03':('BANKRUPTCY_RECEIVERSHIP','CRITICAL_RISK'),
 '2.01':('M_AND_A_ASSET_EVENT','CONTEXT'),'2.02':('EARNINGS_RESULTS','CONTEXT'),'2.03':('DEBT_OBLIGATION','RISK_CONTEXT'),
 '3.01':('LISTING_COMPLIANCE','RISK_CONTEXT'),'3.02':('UNREGISTERED_EQUITY_SALE','DILUTION_RISK'),
 '5.02':('MANAGEMENT_BOARD_CHANGE','CONTEXT'),'7.01':('REG_FD','CONTEXT'),'8.01':('OTHER_MATERIAL_EVENT','CONTEXT')}
OFFER_FORMS={'S-1','S-1/A','S-3','S-3/A','F-1','F-1/A','F-3','F-3/A','424B1','424B2','424B3','424B4','424B5','424B7','424B8','FWP','POS AM'}

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def parse_dt(v):
    if not v:return None
    s=str(v).strip()
    try:
        z=datetime.fromisoformat(s.replace('Z','+00:00'));return z.replace(tzinfo=timezone.utc) if z.tzinfo is None else z.astimezone(timezone.utc)
    except Exception:
        try:return datetime.strptime(s[:19],'%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
        except Exception:return None

def get_json(url,retries=4):
    err=None
    for i in range(retries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity','Accept':'application/json,text/plain,*/*','Connection':'close'})
            with urllib.request.urlopen(req,timeout=15) as r:return json.loads(r.read().decode('utf-8'))
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError) as e:
            err=f'{type(e).__name__}:{getattr(e,"code","")}:{str(e)[:120]}';time.sleep(1.0*(i+1))
    raise RuntimeError(err or 'SEC_FETCH_FAILED')

def parse_mapping(m):
    out={}
    if isinstance(m,dict) and isinstance(m.get('data'),list) and isinstance(m.get('fields'),list):
        fields=m['fields'];idx={k:i for i,k in enumerate(fields)}
        for row in m['data']:
            try:t=str(row[idx['ticker']]).upper();c=int(row[idx['cik']]);out[t]=c
            except Exception:continue
        return out
    if isinstance(m,dict):
        for z in m.values():
            if not isinstance(z,dict):continue
            t=str(z.get('ticker') or '').upper();c=z.get('cik_str')
            if t and c is not None:
                try:out[t]=int(c)
                except:pass
    return out

def parse_fallback_mapping(m):
    out={}
    if not isinstance(m,dict):return out
    for t,c in m.items():
        try:
            t=str(t).upper().strip();ci=int(str(c).lstrip('0') or '0')
            if t and ci>0:out[t]=ci
        except Exception:continue
    return out

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
    form=str(f.get('form') or '').upper().strip();items=[];raw=str(f.get('items') or '')
    for p in raw.replace(';',',').split(','):
        p=p.strip()
        if p:items.append(p)
    event_types=[];risk=[];contexts=[]
    if form in OFFER_FORMS or form.startswith('424B'):event_types.append('OFFERING_REGISTRATION');risk.append('OFFERING_DILUTION_RISK')
    if form=='EFFECT':contexts.append('REGISTRATION_EFFECTIVE')
    if form in ('10-K','10-Q','20-F','40-F','6-K'):contexts.append('PERIODIC_OR_FOREIGN_REPORT')
    for it in items:
        if it in ITEM_MAP:
            et,kind=ITEM_MAP[it];event_types.append(et)
            if kind in ('CRITICAL_RISK','DILUTION_RISK','RISK_CONTEXT'):risk.append(kind+':'+et)
            else:contexts.append(et)
    if form=='8-K' and not event_types:contexts.append('8K_UNCLASSIFIED')
    return sorted(set(event_types)),sorted(set(risk)),sorted(set(contexts)),items

v4=read(V4,{});asof=parse_dt(v4.get('updatedAt')) or datetime.now(timezone.utc);session=str(v4.get('session') or 'unknown').lower();day=v4.get('tradingDateET')
candidates=[]
for x in v4.get('items') or []:
    if x.get('shadowGatePassed') or int(x.get('rank') or 999)<=MAX_CANDIDATES:candidates.append((int(x.get('rank') or 999),str(x.get('symbol') or '').upper()))
candidates=sorted({(r,s) for r,s in candidates if s})[:MAX_CANDIDATES]
payload={'schemaVersion':2,'source':'SEC data.sec.gov submissions derived event clock','sourceOfficial':True,'updatedAtUTC':datetime.now(timezone.utc).isoformat(),'asOfUTC':asof.isoformat(),'tradingDateET':day,'session':session,'policy':'SHADOW_CONTEXT_ONLY_NO_ALERT_OVERRIDE','futureSafe':True,'rawFilingsPersisted':False,'candidateLimit':MAX_CANDIDATES,'lookbackDays':LOOKBACK_DAYS,'freshHours':FRESH_HOURS,'counts':{'requested':len(candidates),'mapped':0,'succeeded':0,'withRecentEvent':0,'withFreshEvent':0,'withRiskFlag':0},'errors':{},'items':[]}
if not candidates:
    payload['status']='PASS';OUT.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(payload,indent=2));raise SystemExit(0)

by_ticker={};map_errors=[];map_source=None
for url in MAP_URLS:
    try:
        m=get_json(url);z=parse_mapping(m)
        if z:by_ticker=z;map_source=url;break
        map_errors.append(url+':EMPTY_MAPPING')
    except Exception as e:map_errors.append(url+':'+str(e)[:180])
if not by_ticker:
    try:
        z=parse_fallback_mapping(get_json(FALLBACK_MAP_URL))
        if z:
            by_ticker=z;map_source='sec-cik-mapper-pre-generated-fallback'
        else:map_errors.append(FALLBACK_MAP_URL+':EMPTY_MAPPING')
    except Exception as e:map_errors.append(FALLBACK_MAP_URL+':'+str(e)[:180])
if not by_ticker:
    payload['status']='DEGRADED';payload['reason']='SEC_TICKER_MAP_UNAVAILABLE';payload['errors']['mapping']=map_errors;payload['mappingUserAgent']=UA
    OUT.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(payload,indent=2));raise SystemExit(0)
payload['mappingSource']=map_source
payload['mappingFallbackUsed']=map_source=='sec-cik-mapper-pre-generated-fallback'
if map_errors:payload['mappingPrimaryErrors']=map_errors

cut=asof-timedelta(days=LOOKBACK_DAYS)
for rank,sym in candidates:
    cik=by_ticker.get(sym);base={'symbol':sym,'rank':rank,'cik':cik,'sourceOfficial':True,'asOfUTC':asof.isoformat(),'eventTypes':[],'riskFlags':[],'contextFlags':[],'latestForm':None,'latestAcceptedAt':None,'latestItems':[],'freshWithin72h':False,'filingsConsidered':0}
    if cik is None:base['status']='NO_SEC_TICKER_MAPPING';payload['items'].append(base);continue
    payload['counts']['mapped']+=1
    try:sub=get_json(SUB_URL.format(cik=cik));payload['counts']['succeeded']+=1
    except Exception as e:base['status']='SEC_SUBMISSIONS_FETCH_FAILED';payload['errors'][sym]=str(e)[:180];payload['items'].append(base);time.sleep(.18);continue
    filings=[]
    for f in rows_from_recent(((sub.get('filings') or {}).get('recent') or {})):
        accepted=parse_dt(f.get('acceptanceDateTime'))
        if accepted is None or accepted>asof or accepted<cut:continue
        et,risk,ctx,its=classify(f);filings.append({'acceptedAt':accepted,'form':str(f.get('form') or ''),'items':its,'eventTypes':et,'riskFlags':risk,'contextFlags':ctx})
    filings.sort(key=lambda z:z['acceptedAt'],reverse=True);base['filingsConsidered']=len(filings);all_ev=[];all_risk=[];all_ctx=[]
    for f in filings:all_ev+=f['eventTypes'];all_risk+=f['riskFlags'];all_ctx+=f['contextFlags']
    base['eventTypes']=sorted(set(all_ev));base['riskFlags']=sorted(set(all_risk));base['contextFlags']=sorted(set(all_ctx))
    if filings:
        f=filings[0];base['latestForm']=f['form'];base['latestAcceptedAt']=f['acceptedAt'].isoformat();base['latestItems']=f['items'];base['latestEventTypes']=f['eventTypes'];base['latestRiskFlags']=f['riskFlags'];base['latestContextFlags']=f['contextFlags'];base['freshWithin72h']=(asof-f['acceptedAt']).total_seconds()<=FRESH_HOURS*3600;payload['counts']['withRecentEvent']+=1
        if base['freshWithin72h']:payload['counts']['withFreshEvent']+=1
    if base['riskFlags']:payload['counts']['withRiskFlag']+=1
    base['status']='PASS';payload['items'].append(base);time.sleep(.18)
payload['status']='PASS' if payload['counts']['succeeded'] else 'DEGRADED'
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in payload.items() if k!='items'},ensure_ascii=False,indent=2))
