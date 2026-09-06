#!/usr/bin/env python3
import json,pathlib,statistics
from datetime import datetime,timezone

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
OUT=pathlib.Path('tag/data/tagit-catalyst-calibration.json')

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def pct(n,d):return round(n/d*100,2) if d else None
ledger=read(LEDGER,{})
rows=[r for r in (ledger.get('records') or []) if r.get('hit10_60m') is not None]
groups={}
for r in rows:
    c=r.get('catalystTypeV2') or r.get('catalystClass') or 'UNKNOWN'
    groups.setdefault(c,[]).append(r)
summary={}
for c,a in sorted(groups.items()):
    wins=sum(bool(x.get('hit10_60m')) for x in a);h5=sum(bool(x.get('hit5_30m')) for x in a if x.get('hit5_30m') is not None);m30=[x for x in a if x.get('hit5_30m') is not None]
    mfes=[float(x['mfe60Pct']) for x in a if x.get('mfe60Pct') is not None];maes=[float(x['mae60Pct']) for x in a if x.get('mae60Pct') is not None]
    summary[c]={'n60':len(a),'wins10_60m':wins,'precision10_60mPct':pct(wins,len(a)),'n30':len(m30),'hit5_30mPct':pct(h5,len(m30)),'medianMfe60Pct':round(statistics.median(mfes),2) if mfes else None,'medianMae60Pct':round(statistics.median(maes),2) if maes else None,'promotionEligible':len(a)>=30}
out={'schemaVersion':1,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'objective':'+10% MFE within 60m by catalyst type','policy':'NO_MODEL_WEIGHT_UNTIL_N60_GE_30_PER_CATALYST','matureRecords':len(rows),'groups':summary}
OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','matureRecords':len(rows),'groups':{k:v['n60'] for k,v in summary.items()}}))
