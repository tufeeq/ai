#!/usr/bin/env python3
import json,re,pathlib,sys
from datetime import datetime,timezone

PATH=pathlib.Path('tag/data/finviz-rich.json')

RULES=[
 ('DILUTION_FINANCING','NEGATIVE',0.95,[r'\bregistered direct\b',r'\bpublic offering\b',r'\bprivate placement\b',r'\bat-the-market\b',r'\bconvertible\b',r'\bwarrants?\b',r'\bfinancing\b',r'\boffering\b']),
 ('FDA_CLINICAL','POSITIVE',0.94,[r'\bfda\b',r'\bphase\s*[123]\b',r'\bclinical trial\b',r'\bprimary endpoint\b',r'\bclearance\b',r'\bapproval\b']),
 ('CONTRACT_ORDER','POSITIVE',0.90,[r'\bgovernment contract\b',r'\bpurchase order\b',r'\bcontract award\b',r'\bawarded?\b',r'\bselected by\b',r'\bnew contract\b']),
 ('M_AND_A','POSITIVE',0.91,[r'\bmerger\b',r'\bacquisition\b',r'\bacquire[sd]?\b',r'\bbuyout\b',r'\btakeover\b',r'\bbusiness combination\b']),
 ('EARNINGS_GUIDANCE','MIXED',0.86,[r'\bearnings\b',r'\bfinancial results\b',r'\bguidance\b',r'\brevenue\b',r'\beps\b',r'\bquarterly results\b']),
 ('PARTNERSHIP_LICENSING','POSITIVE',0.78,[r'\bpartnership\b',r'\bcollaboration\b',r'\blicensing agreement\b',r'\blicense agreement\b',r'\bstrategic alliance\b',r'\bdistribution agreement\b']),
 ('LEGAL_REGULATORY','MIXED',0.82,[r'\blawsuit\b',r'\bsettlement\b',r'\bpatent\b',r'\bcourt\b',r'\bnasdaq compliance\b',r'\bdelisting\b',r'\bregulatory\b']),
 ('CAPITAL_STRUCTURE','MIXED',0.83,[r'\breverse split\b',r'\bstock split\b',r'\bshare consolidation\b',r'\bdividend\b',r'\bbuyback\b'])]

STRONG_POS=[r'\bapproval\b',r'\bclearance\b',r'\bmet primary endpoint\b',r'\bawarded\b',r'\bdefinitive agreement\b',r'\brecord revenue\b',r'\braises guidance\b']
STRONG_NEG=[r'\bprices? offering\b',r'\bgoing concern\b',r'\bdelisting\b',r'\bmisses?\b',r'\blowers guidance\b',r'\bdefault\b']

def classify(title,dilution=False):
    text=' '.join(str(title or '').lower().split())
    if dilution:
        return {'type':'DILUTION_FINANCING','polarity':'NEGATIVE','materiality':0.90,'confidence':0.98,'strength':0.15,'authority':'SEC_FLAG_PLUS_NEWS_TITLE'}
    if not text:
        return {'type':'NONE','polarity':'UNKNOWN','materiality':0.0,'confidence':1.0,'strength':None,'authority':'NO_NEWS_TITLE'}
    chosen=None
    for typ,pol,conf,pats in RULES:
        hits=sum(bool(re.search(p,text)) for p in pats)
        if hits:
            score=(hits,conf)
            if chosen is None or score>chosen[0]:chosen=(score,typ,pol,conf)
    if chosen is None:
        return {'type':'OTHER_NEWS','polarity':'UNKNOWN','materiality':0.35,'confidence':0.45,'strength':0.45,'authority':'TITLE_HEURISTIC'}
    _,typ,pol,conf=chosen
    positive=any(re.search(p,text) for p in STRONG_POS)
    negative=any(re.search(p,text) for p in STRONG_NEG)
    if positive and not negative:pol='POSITIVE'
    elif negative and not positive:pol='NEGATIVE'
    materiality={'FDA_CLINICAL':0.90,'CONTRACT_ORDER':0.82,'M_AND_A':0.90,'EARNINGS_GUIDANCE':0.78,'PARTNERSHIP_LICENSING':0.68,'DILUTION_FINANCING':0.90,'LEGAL_REGULATORY':0.72,'CAPITAL_STRUCTURE':0.66}.get(typ,0.5)
    if positive or negative:materiality=min(1,materiality+.06);conf=min(.99,conf+.03)
    strength=None
    if pol=='POSITIVE':strength=round(.50+.45*materiality,3)
    elif pol=='NEGATIVE':strength=round(.30*(1-materiality),3)
    elif pol=='MIXED':strength=round(.42+.18*materiality,3)
    return {'type':typ,'polarity':pol,'materiality':round(materiality,3),'confidence':round(conf,3),'strength':strength,'authority':'TITLE_HEURISTIC'}

def self_test():
    cases=[
      ('Company receives FDA approval for therapy','FDA_CLINICAL','POSITIVE'),
      ('Company prices $12 million registered direct offering','DILUTION_FINANCING','NEGATIVE'),
      ('Company awarded new government contract','CONTRACT_ORDER','POSITIVE'),
      ('Company announces definitive merger agreement','M_AND_A','POSITIVE'),
      ('Company reports quarterly financial results','EARNINGS_GUIDANCE','MIXED')]
    bad=[]
    for title,t,p in cases:
        r=classify(title)
        if r['type']!=t or r['polarity']!=p:bad.append((title,r,t,p))
    if bad:raise SystemExit(f'catalyst self-test failed: {bad}')
    print(json.dumps({'selfTest':'PASS','cases':len(cases)}))

if '--self-test' in sys.argv:
    self_test();raise SystemExit(0)

if not PATH.exists():
    print(json.dumps({'status':'SKIP','reason':'rich input missing'}));raise SystemExit(0)
raw=json.loads(PATH.read_text(encoding='utf-8'));rows=raw.get('rows') or [];counts={}
for row in rows:
    t=row.get('_tagit') or {}; c=classify(t.get('latestNewsTitle'),bool(t.get('recentDilutionFiling')))
    t['catalystType']=c['type'];t['catalystPolarity']=c['polarity'];t['catalystMateriality']=c['materiality'];t['catalystConfidence']=c['confidence'];t['catalystStrengthShadow']=c['strength'];t['catalystAuthority']=c['authority'];t['catalystFreshnessMin']=None
    row['_tagit']=t;counts[c['type']]=counts.get(c['type'],0)+1
raw['catalystIntelligence']={'version':'shadow-v1','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'SHADOW_ONLY_TITLE_HEURISTIC_NO_CHAMPION_OVERRIDE','counts':counts}
PATH.write_text(json.dumps(raw,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'status':'PASS','rows':len(rows),'counts':counts},ensure_ascii=False))
