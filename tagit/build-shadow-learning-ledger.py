#!/usr/bin/env python3
import json, math, pathlib, re
from datetime import datetime, timezone, timedelta

RICH=pathlib.Path('tag/data/finviz-rich.json')
SIGNALS=pathlib.Path('tag/data/tagit-signal-feed.json')
V3=pathlib.Path('tag/data/tagit-v3-shadow.json')
OUT=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')

def read(p,d):
    try:return json.loads(p.read_text())
    except:return d

def finite(v):
    try:return v is not None and v!='' and math.isfinite(float(v))
    except:return False

def pct_rank(vals,v,invert=False):
    a=sorted(float(x) for x in vals if finite(x))
    if not a or not finite(v):return None
    x=float(v); lo=0;hi=len(a)
    while lo<hi:
        m=(lo+hi)//2
        if a[m]<=x:lo=m+1
        else:hi=m
    p=lo/len(a)
    return round((1-p if invert else p)*100,2)

def catalyst_class(title):
    t=(title or '').lower()
    if not t:return 'NONE'
    rules=[
      ('DILUTION_FINANCING',r'\b(offering|registered direct|private placement|atm |at-the-market|warrant|convertible|financing|raises? \$|public offering)\b'),
      ('FDA_CLINICAL',r'\b(fda|phase [123]|clinical|trial|endpoint|drug|therapy|biologic|clearance|approval)\b'),
      ('CONTRACT_ORDER',r'\b(contract|award|purchase order|order worth|selected by|government contract|framework agreement)\b'),
      ('EARNINGS_GUIDANCE',r'\b(earnings|revenue|eps|guidance|quarter|financial results|profit|sales)\b'),
      ('M_AND_A',r'\b(merger|acquisition|acquire|buyout|takeover|strategic combination|business combination)\b'),
      ('PARTNERSHIP_LICENSING',r'\b(partnership|collaboration|licensing|license agreement|strategic alliance|distribution agreement)\b'),
      ('LEGAL_REGULATORY',r'\b(lawsuit|settlement|patent|court|nasdaq compliance|delisting|regulatory)\b')]
    for c,p in rules:
        if re.search(p,t):return c
    return 'OTHER_NEWS'

def momentum_shape(m):
    vals=[m.get(str(k)) for k in (1,2,3,5,10)] if isinstance(m,dict) else []
    xs=[float(x) for x in vals if finite(x)]
    if len(xs)<2:return 'UNKNOWN'
    pos=sum(x>0 for x in xs)/len(xs)
    m1=float(m.get('1')) if finite(m.get('1')) else None
    m5=float(m.get('5')) if finite(m.get('5')) else None
    if pos>=.8 and m1 is not None and m5 is not None and m1>m5/5:return 'ACCELERATING_UP'
    if pos>=.8:return 'CONSISTENT_UP'
    if pos<=.2:return 'WEAK_DOWN'
    return 'MIXED'

rich=read(RICH,{}); sig=read(SIGNALS,{}); v3=read(V3,{})
session=str(rich.get('session') or sig.get('session') or 'unknown').lower();ts=rich.get('updatedAt') or sig.get('updatedAt')
ledger=read(OUT,{'schemaVersion':1,'policy':'DERIVED_FEATURES_ONLY_NO_RAW_ELITE_ROWS','records':[]})
if session not in ('pre-market','regular','after-hours'):
    ledger['lastSkipped']={'timestamp':ts,'session':session,'reason':'inactive_session'}
    OUT.write_text(json.dumps(ledger,indent=2)+'\n');print(json.dumps({'skipped':True,'session':session}));raise SystemExit(0)
rows=rich.get('rows') or []
items={str(x.get('symbol') or '').upper():x for x in (sig.get('items') or [])}
v3items={str(x.get('symbol') or '').upper():x for x in (v3.get('items') or [])}
fields={
 'rvol':[(r.get('_tagit') or {}).get('relativeVolume') for r in rows],
 'volume':[(r.get('_tagit') or {}).get('volume') for r in rows],
 'dollar':[(r.get('_tagit') or {}).get('dollarVolume') for r in rows],
 'trades':[(r.get('_tagit') or {}).get('trades') for r in rows],
 'atr':[(r.get('_tagit') or {}).get('atrPct') for r in rows],
 'float':[(r.get('_tagit') or {}).get('floatShares') for r in rows],
 'short':[(r.get('_tagit') or {}).get('shortFloatPct') for r in rows],
 'accel':[(r.get('_tagit') or {}).get('priceAccelerationPctPerMin') for r in rows],
 'm1':[((r.get('_tagit') or {}).get('momentumPct') or {}).get('1') for r in rows],
 'm3':[((r.get('_tagit') or {}).get('momentumPct') or {}).get('3') for r in rows],
 'm5':[((r.get('_tagit') or {}).get('momentumPct') or {}).get('5') for r in rows],
 'm10':[((r.get('_tagit') or {}).get('momentumPct') or {}).get('10') for r in rows]}
N=max(1,len(rows)); heat=round(100*(.30*sum(finite(x) and float(x)>=2 for x in fields['rvol'])/N + .20*sum(finite(x) and float(x)>=.15 for x in fields['m1'])/N + .20*sum(finite(x) and float(x)>=.5 for x in fields['m5'])/N + .15*sum(finite(x) and float(x)>=1.5 for x in fields['atr'])/N + .15*sum(finite(x) and float(x)>=0 for x in fields['accel'])/N),2)
new=[]
for r in rows:
    t=r.get('_tagit') or {}; sym=str(r.get('Ticker') or '').upper(); s=items.get(sym)
    if not sym or not s:continue
    vr=v3items.get(sym) or {};m=t.get('momentumPct') or {}
    rec={'timestamp':ts,'session':session,'symbol':sym,'referencePrice':round(float(t['price']),6) if finite(t.get('price')) else None,
      'state':s.get('state'),'phase':s.get('phase'),'precursorScore':s.get('precursorScore'),'continuationScore':s.get('continuationScore'),'tradabilityScore':s.get('tradabilityScore'),'riskScore':s.get('riskScore'),
      'v3State':vr.get('state'),'v3Rank':vr.get('rank'),'v3RankScorePct':vr.get('rankScorePct'),'v3ModelDisagreement':vr.get('modelDisagreement'),'v3RawRelevanceScore':vr.get('rawRelevanceScore'),
      'v3Tracked':bool(vr),'v3Policy':v3.get('policy'),'marketHeat':heat,'featurePercentiles':{
        'rvol':pct_rank(fields['rvol'],t.get('relativeVolume')),'volume':pct_rank(fields['volume'],t.get('volume')),'dollarVolume':pct_rank(fields['dollar'],t.get('dollarVolume')),
        'trades':pct_rank(fields['trades'],t.get('trades')),'atr':pct_rank(fields['atr'],t.get('atrPct')),'floatTightness':pct_rank(fields['float'],t.get('floatShares'),True),
        'shortFloat':pct_rank(fields['short'],t.get('shortFloatPct')),'priceAcceleration':pct_rank(fields['accel'],t.get('priceAccelerationPctPerMin')),
        'm1':pct_rank(fields['m1'],m.get('1')),'m3':pct_rank(fields['m3'],m.get('3')),'m5':pct_rank(fields['m5'],m.get('5')),'m10':pct_rank(fields['m10'],m.get('10'))},
      'microShape':momentum_shape(m),'catalystClass':catalyst_class(t.get('latestNewsTitle')),'hasFreshNewsField':bool(t.get('latestNewsTitle')),'recentDilutionFlag':bool(t.get('recentDilutionFiling')),
      'signalSources':r.get('_signals') or [],'label':None}
    new.append(rec)
records=ledger.get('records') or []; keys={(x.get('timestamp'),x.get('symbol')) for x in records}
records.extend(x for x in new if (x['timestamp'],x['symbol']) not in keys)
try: cutoff=datetime.now(timezone.utc)-timedelta(days=60);records=[x for x in records if datetime.fromisoformat(str(x.get('timestamp')).replace('Z','+00:00'))>=cutoff]
except: pass
records=records[-50000:]
ledger.update({'schemaVersion':3,'updatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'DERIVED_FEATURES_ONLY_NO_RAW_ELITE_ROWS','session':session,'latestSnapshot':ts,'latestMarketHeat':heat,'latestRecordsAdded':len(new),'v3TrackingEnabled':True,'records':records})
OUT.write_text(json.dumps(ledger,separators=(',',':'))+'\n')
print(json.dumps({'recordsTotal':len(records),'added':len(new),'session':session,'marketHeat':heat,'v3Tracked':sum(bool(x.get('v3Tracked')) for x in new)}))
