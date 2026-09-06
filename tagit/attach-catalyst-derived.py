#!/usr/bin/env python3
import json,pathlib

RICH=pathlib.Path('tag/data/finviz-rich.json')
SIGNALS=pathlib.Path('tag/data/tagit-signal-feed.json')
LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

rich=read(RICH,{})
by={str(r.get('Ticker') or '').upper():(r.get('_tagit') or {}) for r in (rich.get('rows') or [])}

sig=read(SIGNALS,{})
for x in sig.get('items') or []:
    t=by.get(str(x.get('symbol') or '').upper(),{})
    x['catalystShadow']={
      'type':t.get('catalystType'),'polarity':t.get('catalystPolarity'),'materiality':t.get('catalystMateriality'),
      'confidence':t.get('catalystConfidence'),'strength':t.get('catalystStrengthShadow'),'freshnessMin':t.get('catalystFreshnessMin'),
      'authority':t.get('catalystAuthority'),'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE'}
sig['catalystShadowPolicy']='COLLECT_AND_EVALUATE_BEFORE_PROMOTION'
if sig: SIGNALS.write_text(json.dumps(sig,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

ledger=read(LEDGER,{})
latest=str(ledger.get('latestSnapshot') or '')
patched=0
for rec in ledger.get('records') or []:
    if latest and str(rec.get('timestamp') or '')!=latest:continue
    t=by.get(str(rec.get('symbol') or '').upper(),{})
    if not t:continue
    rec['catalystTypeV2']=t.get('catalystType');rec['catalystPolarity']=t.get('catalystPolarity');rec['catalystMateriality']=t.get('catalystMateriality');rec['catalystConfidence']=t.get('catalystConfidence');rec['catalystStrengthShadow']=t.get('catalystStrengthShadow');rec['catalystAuthority']=t.get('catalystAuthority');patched+=1
if ledger: LEDGER.write_text(json.dumps(ledger,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'signalItems':len(sig.get('items') or []),'ledgerRecordsPatched':patched,'latestSnapshot':latest}))
