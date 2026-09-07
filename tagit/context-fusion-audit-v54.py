#!/usr/bin/env python3
"""TAGit v5.4 context-fusion audit.

Audits whether catalyst/SEC/float/short/execution context is actually available at
observation time and mature enough to be promoted from metadata into modeling.
Produces a derived readiness report only; no champion override.
"""
import json, pathlib, statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone

DATA=pathlib.Path('tag/data')
OUT=DATA/'tagit-v54-context-fusion-audit.json'

def read(name, default):
    p=DATA/name
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return default

ledger=read('tagit-shadow-learning-ledger.json',{})
rich=read('finviz-rich.json',{})
signals=read('tagit-signal-feed.json',{})
sec=read('tagit-sec-event-shadow.json',{})

records=ledger.get('records') or []
rows=rich.get('rows') or []
items=signals.get('items') or []
sec_items=sec.get('items') or []

def present(v):
    return v is not None and v!='' and v!=[] and v!={}

def cov(seq, key):
    n=len(seq);k=sum(1 for x in seq if present(x.get(key)))
    return {'count':k,'total':n,'pct':round(k/n*100,2) if n else 0.0}

ledger_cov={k:cov(records,k) for k in [
 'catalystTypeV2','catalystPolarity','catalystMateriality','catalystConfidence',
 'secLatestForm','secEventTypes','secRiskFlags','secFreshWithin72h',
 'float','shortFloat','shortRatio','bid','ask','bidAskSpread'
]}

# Current rich-feed coverage. Finviz keys vary, so accept known alternatives.
def first_present(d, keys):
    for k in keys:
        if present(d.get(k)):return d.get(k)
    return None
rich_norm=[]
for r in rows:
    t=r.get('_tagit') or {}
    rich_norm.append({
      'float':first_present(r,['Float','Shs Float','Float Shares']),
      'shortFloat':first_present(r,['Short Float','Short Float %']),
      'shortRatio':first_present(r,['Short Ratio']),
      'catalystType':t.get('catalystType'),
      'catalystConfidence':t.get('catalystConfidence'),
      'catalystMateriality':t.get('catalystMateriality'),
      'news':first_present(r,['News','Headline','Title']) or t.get('newsHeadline')
    })
rich_cov={k:cov(rich_norm,k) for k in rich_norm[0].keys()} if rich_norm else {}

# Mature event subset if outcome fields are present.
outcome_keys=['outcome10m','outcome30m','outcome60m','mfe60','futureMaxPct','hit10']
mature=[]
for r in records:
    if any(present(r.get(k)) for k in outcome_keys): mature.append(r)

# Simple stratified diagnostics, only on fields already frozen at observation.
def buckets(field):
    d=defaultdict(lambda:{'n':0,'wins':0})
    for r in mature:
        v=r.get(field)
        if not present(v):continue
        key=str(v)
        d[key]['n']+=1
        win=bool(r.get('hit10'))
        if not present(r.get('hit10')):
            candidates=[r.get('mfe60'),r.get('futureMaxPct'),r.get('outcome60m')]
            nums=[x for x in candidates if isinstance(x,(int,float))]
            win=bool(nums and max(nums)>=10)
        d[key]['wins']+=int(win)
    return {k:{'n':v['n'],'winRatePct':round(v['wins']/v['n']*100,2) if v['n'] else None} for k,v in sorted(d.items(), key=lambda kv:-kv[1]['n'])[:20]}

current_exec={
 'signalItems':len(items),
 'withCatalystShadow':sum(1 for x in items if present(x.get('catalystShadow'))),
 'withBidAskSpread':sum(1 for x in items if present(x.get('bidAskSpread'))),
 'withBid':sum(1 for x in items if present(x.get('bid'))),
 'withAsk':sum(1 for x in items if present(x.get('ask'))),
}

blockers=[]
if ledger_cov['catalystTypeV2']['pct']<50: blockers.append('Historical catalyst-at-observation coverage is too low for supervised fusion.')
if ledger_cov['secLatestForm']['pct']<50: blockers.append('Historical SEC-at-observation coverage is too low for supervised fusion.')
if ledger_cov['bidAskSpread']['pct']<50: blockers.append('Execution spread history is insufficient; execution-ready labels cannot be trusted.')
if len(mature)<100: blockers.append('Too few mature outcome-linked context records for credible context lift measurement.')

recommended=[
 'Freeze catalyst and SEC context into every new observation before outcomes mature.',
 'Persist float/short context as point-in-time values; never backfill future-known values into old observations.',
 'Add bid/ask/spread at signal emission and evaluate executable slippage separately from discovery precision.',
 'Train context as a second-stage meta-model after v5.3 market-pattern probability, not as a replacement for causal market features.',
 'Measure lift with chronological ablation: market-only vs +catalyst vs +SEC vs +float/short vs +execution.',
 'Use abstention: emit no high-confidence call when context coverage or model agreement is weak.'
]

report={
 'schemaVersion':'5.4-context-fusion-audit',
 'generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
 'ledgerRecords':len(records),'matureContextRecords':len(mature),
 'currentRichRows':len(rows),'currentSignalItems':len(items),'secItems':len(sec_items),
 'ledgerCoverage':ledger_cov,'currentRichCoverage':rich_cov,'currentExecutionCoverage':current_exec,
 'matureStratifiedDiagnostics':{
   'catalystTypeV2':buckets('catalystTypeV2'),
   'catalystMateriality':buckets('catalystMateriality'),
   'secLatestForm':buckets('secLatestForm'),
   'secFreshWithin72h':buckets('secFreshWithin72h')
 },
 'blockers':blockers,
 'recommendedNextArchitecture':'V53_MARKET_PATTERN_BASE + V54_POINT_IN_TIME_CONTEXT_META_MODEL + ABSTENTION + EXECUTION_GATE',
 'recommendedActions':recommended,
 'readyForSupervisedContextFusion': len(blockers)==0
}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
