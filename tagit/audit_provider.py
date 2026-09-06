import json,pathlib,datetime
root=pathlib.Path('.')
p=json.loads((root/'tag/data/finviz-rich.json').read_text())
rows=p.get('rows') or []
def present(v):return v not in (None,'','-','N/A')
def cov(path):
    ok=0
    for r in rows:
        x=r
        for key in path:
            if not isinstance(x,dict):x=None;break
            x=x.get(key)
        if present(x):ok+=1
    return round(ok/len(rows)*100,2) if rows else 0
fields={
 'symbol':(['Ticker'],True,'Finviz Elite'),
 'price':(['_tagit','price'],True,'Finviz Elite'),
 'dayChangePct':(['_tagit','dayChangePct'],True,'Finviz Elite'),
 'volume':(['_tagit','volume'],True,'Finviz Elite'),
 'averageVolume':(['_tagit','averageVolumeShares'],True,'Finviz Elite'),
 'relativeVolume':(['_tagit','relativeVolume'],True,'Finviz Elite'),
 'trades':(['_tagit','trades'],True,'Finviz Elite'),
 'momentum1m':(['_tagit','momentumPct','1'],True,'Finviz Elite'),
 'momentum2m':(['_tagit','momentumPct','2'],True,'Finviz Elite'),
 'momentum3m':(['_tagit','momentumPct','3'],True,'Finviz Elite'),
 'momentum5m':(['_tagit','momentumPct','5'],True,'Finviz Elite'),
 'momentum10m':(['_tagit','momentumPct','10'],True,'Finviz Elite'),
 'momentum30m':(['_tagit','momentumPct','30'],True,'Finviz Elite'),
 'momentum60m':(['_tagit','momentumPct','60'],True,'Finviz Elite'),
 'atrPct':(['_tagit','atrPct'],True,'Finviz Elite'),
 'gapPct':(['_tagit','gapPct'],True,'Finviz Elite'),
 'rsi14':(['_tagit','rsi14'],False,'Finviz Elite'),
 'floatShares':(['_tagit','floatShares'],False,'Finviz Elite'),
 'sharesOutstanding':(['_tagit','sharesOutstanding'],False,'Finviz Elite'),
 'marketCap':(['_tagit','marketCapUsd'],False,'Finviz Elite'),
 'shortFloatPct':(['_tagit','shortFloatPct'],False,'Finviz Elite'),
 'shortRatio':(['_tagit','shortRatio'],False,'Finviz Elite'),
 'afterHoursVolume':(['_tagit','afterHoursVolume'],False,'Finviz Elite'),
 'latestNewsTitle':(['_tagit','latestNewsTitle'],False,'Finviz Elite'),
 'exchange':(['_tagit','exchange'],False,'Finviz Elite'),
 'securityType':(['_tagit','securityType'],False,'Finviz Elite'),
}
audit={}
for name,(path,required,provider) in fields.items():
    c=cov(path);audit[name]={'coveragePct':c,'requiredForDiscovery':required,'provider':provider,'status':'PASS' if (c>=95 if required else c>0) else ('FAIL' if required else 'PARTIAL_OR_UNAVAILABLE')}
required_fail=[k for k,v in audit.items() if v['requiredForDiscovery'] and v['status']!='PASS']
out={
 'schemaVersion':1,
 'generatedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'provider':'Finviz Elite paid export → provider adapter → derived TAGit feed',
 'rowsAudited':len(rows),
 'discoveryContractStatus':'PASS' if not required_fail else 'FAIL',
 'requiredFailures':required_fail,
 'fields':audit,
 'execution':{
   'bidAskSpread':{'coveragePct':0,'provider':None,'status':'MISSING','policy':'Never infer or replace with zero. WATCH remains execution-unverified until a quote source supplies bid/ask.'},
   'lastTradeQuote':{'provider':'separate quote path / live-quotes where available','status':'SEPARATE_FROM_ELITE_ANALYTICS'}
 },
 'riskAuthority':{
   'dilutionFilings':'SEC enrichment; Finviz is not treated as authoritative for filing direction',
   'shortInterest':'Finviz Short Float/Short Ratio are context only; FINRA short-sale volume must never be interpreted as short interest',
   'float':'Finviz Shares Float when present; otherwise null'
 },
 'nullPolicy':'UNKNOWN_NOT_ZERO',
 'antiLeakage':'Cross-snapshot features may use current and prior snapshots only; future prices are evaluation labels only.',
 'publication':'Raw rich Elite rows are ephemeral in Actions; Pages consumes derived signals.'
}
(root/'tag/data/tagit-data-contract.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':out['discoveryContractStatus'],'requiredFailures':required_fail,'rows':len(rows)},indent=2))