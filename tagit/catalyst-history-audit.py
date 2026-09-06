#!/usr/bin/env python3
import json, subprocess, pathlib
from datetime import datetime, timezone

DISC='tag/data/discovery-fast.json'; ENR='tag/data/enrichment.json'; OUT=pathlib.Path('tag/data/tagit-catalyst-history-audit.json')

def git(*args): return subprocess.check_output(['git',*args],text=True,stderr=subprocess.DEVNULL)
def parse(s):
    try:return datetime.fromisoformat(str(s).replace('Z','+00:00'))
    except:return None

def load_history(path):
    revs=git('log','--format=%H','--reverse','--',path).splitlines();out=[];fails=0
    for sha in revs:
        try:
            d=json.loads(git('show',f'{sha}:{path}'))
            iso=d.get('snapshotTimestampUTC') or d.get('updatedAt') or d.get('updatedAtUTC')
            dt=parse(iso)
            if not dt:continue
            out.append({'sha':sha,'dt':dt,'iso':iso,'data':d})
        except Exception:fails+=1
    out.sort(key=lambda x:x['dt']);return revs,out,fails

drevs,ds,df=load_history(DISC);erevs,es,ef=load_history(ENR)
# de-dup timestamps
seen=set();ds2=[]
for x in ds:
    if x['iso'] in seen:continue
    seen.add(x['iso']);ds2.append(x)
ds=ds2
seen=set();es2=[]
for x in es:
    if x['iso'] in seen:continue
    seen.add(x['iso']);es2.append(x)
es=es2

# Inventory discovery row fields to see whether catalyst-like data was ever embedded directly.
field_counts={};rows=0
for s in ds:
    for r in s['data'].get('rows',[]):
        rows+=1
        for k,v in r.items():
            if v not in (None,'',[],{}):field_counts[k]=field_counts.get(k,0)+1
keywords=('news','headline','catalyst','filing','sec','float','short','trade','atr','rsi','performance (1 minute)','performance (2 minutes)','performance (3 minutes)')
interesting={k:v for k,v in field_counts.items() if any(w in k.lower() for w in keywords)}

# For each discovery snapshot find the latest enrichment snapshot that already existed at that timestamp.
coverage=[];eidx=0;latest=None
for s in ds:
    while eidx<len(es) and es[eidx]['dt']<=s['dt']:
        latest=es[eidx];eidx+=1
    total=len(s['data'].get('rows',[]));tickers={str(r.get('Ticker') or '').upper() for r in s['data'].get('rows',[]) if r.get('Ticker')}
    enriched=0;fresh3h=0;fresh24=0;filing=0
    if latest:
        emap=latest['data'].get('rows') or {}
        if isinstance(emap,dict):
            for t in tickers:
                z=emap.get(t)
                if not z:continue
                enriched+=1
                if z.get('filings'):filing+=1
                for n in z.get('news') or []:
                    nd=parse(n.get('published'))
                    if nd and nd<=s['dt']:
                        age=(s['dt']-nd).total_seconds()/60
                        if age<=180:fresh3h+=1;break
                        if age<=1440:fresh24+=1
    coverage.append({'snapshot':s['iso'],'day':s['iso'][:10],'session':s['data'].get('session'),'rows':total,'matchedEnrichmentSnapshot':latest['iso'] if latest else None,'matchedTickerRows':enriched,'freshNews3hTickers':fresh3h,'freshNews24hAdditionalTickers':fresh24,'filingTickers':filing})

byday={}
for x in coverage:
    d=byday.setdefault(x['day'],{'snapshots':0,'rows':0,'matchedRows':0,'freshNews3h':0,'freshNews24Additional':0,'filingRows':0,'snapshotsWithPriorEnrichment':0})
    d['snapshots']+=1;d['rows']+=x['rows'];d['matchedRows']+=x['matchedTickerRows'];d['freshNews3h']+=x['freshNews3hTickers'];d['freshNews24Additional']+=x['freshNews24hAdditionalTickers'];d['filingRows']+=x['filingTickers'];d['snapshotsWithPriorEnrichment']+=1 if x['matchedEnrichmentSnapshot'] else 0
for d in byday.values():
    d['tickerMatchPct']=round(d['matchedRows']/d['rows']*100,2) if d['rows'] else 0

report={'schemaVersion':1,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'POINT_IN_TIME_CATALYST_HISTORY_COVERAGE_AUDIT',
'discovery':{'gitRevisions':len(drevs),'snapshots':len(ds),'rows':rows,'parseFailures':df},'enrichment':{'gitRevisions':len(erevs),'snapshots':len(es),'parseFailures':ef,'earliest':es[0]['iso'] if es else None,'latest':es[-1]['iso'] if es else None},
'discoveryEmbeddedInterestingFields':interesting,'byDay':byday,
'conclusion':{'historicalCatalystBacktestPossible':any(x['freshNews3hTickers'] or x['filingTickers'] for x in coverage),'rule':'Only enrichment snapshots timestamped <= discovery snapshot and news published <= discovery snapshot are eligible.'},
'limitations':['A later enrichment snapshot is never retroactively joined to an earlier discovery observation.','Headline publication time is not equivalent to first market availability; this audit is coverage-only, not yet performance attribution.']}
OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
