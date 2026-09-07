#!/usr/bin/env python3
"""Evaluate when v4.9 independent forward evidence is ready for policy research.

No automatic production promotion. Candidate evidence overlays are selected on
chronologically earlier mature trading dates and evaluated once on later dates.
The evaluator deliberately returns NOT_READY until support is meaningful.
"""
import json, math, pathlib
from datetime import datetime, timezone

SRC=pathlib.Path('tag/data/tagit-v49-forward-evidence.json')
OUT=pathlib.Path('tag/data/tagit-v49-policy-readiness.json')
POLICY='RESEARCH_READINESS_ONLY_NO_LIVE_OVERRIDE'

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def outcome(x):return x.get('outcome') or {}
def evidence(x):return x.get('evidence') or {}
def positive(x):return outcome(x).get('hit10_60m') is True
def clean(x):return outcome(x).get('cleanWinner10_60_mae4') is True

def wilson(tp,n,z=1.645):
    if n<=0:return 0.0
    p=tp/n; den=1+z*z/n
    return max(0.0,(p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)

def met(xs):
    n=len(xs);tp=sum(positive(x) for x in xs);cl=sum(clean(x) for x in xs)
    return {'count':n,'tp':tp,'precisionPct':round(100*tp/n,2) if n else None,'cleanTp':cl,'cleanPrecisionPct':round(100*cl/n,2) if n else None,'wilsonLower90Pct':round(100*wilson(tp,n),2) if n else None,'tradingDays':len({evidence(x).get('tradingDateET') for x in xs})}

def evfilter(name,x):
    e=evidence(x);cat=e.get('catalyst') or {};sec=e.get('sec') or {};sess=str(e.get('session') or '')
    mat=cat.get('materiality'); observed=bool(cat.get('observedAtEvent')); risk=sec.get('riskLevel')
    try:mat=float(mat)
    except:mat=0.0
    rules={
      'PRE_ONLY':sess=='pre-market',
      'CATALYST_HIGH':observed and mat>=.70,
      'CATALYST_VERY_HIGH':observed and mat>=.85,
      'SEC_NOT_ELEVATED':risk in ('NONE','CONTEXT','UNKNOWN'),
      'PRE_AND_CATALYST_HIGH':sess=='pre-market' and observed and mat>=.70,
      'PRE_AND_SEC_NOT_ELEVATED':sess=='pre-market' and risk in ('NONE','CONTEXT','UNKNOWN'),
      'CATALYST_HIGH_AND_SEC_NOT_ELEVATED':observed and mat>=.70 and risk in ('NONE','CONTEXT','UNKNOWN')}
    return bool(rules.get(name))

raw=read(SRC,{}); mature=[x for x in (raw.get('events') or []) if outcome(x).get('status')=='MATURE']
days=sorted({evidence(x).get('tradingDateET') for x in mature if evidence(x).get('tradingDateET')})
base=met(mature)
min_ready={'matureEvents':60,'tradingDays':8,'winners':8}
ready=len(mature)>=60 and len(days)>=8 and sum(positive(x) for x in mature)>=8
report={'schemaVersion':'4.9-policy-readiness','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':POLICY,'minimumEvidence':min_ready,'current':base,'status':'NOT_READY','selection':None,'validation':None,'candidateDiagnostics':[],'autoPromotion':False}
if ready:
    # Chronological 70/30 day split, never event-random split.
    cut=max(1,min(len(days)-2,math.ceil(len(days)*.70)))
    trdays=set(days[:cut]);vadays=set(days[cut:])
    tr=[x for x in mature if evidence(x).get('tradingDateET') in trdays];va=[x for x in mature if evidence(x).get('tradingDateET') in vadays]
    bm=met(tr); bva=met(va)
    names=['PRE_ONLY','CATALYST_HIGH','CATALYST_VERY_HIGH','SEC_NOT_ELEVATED','PRE_AND_CATALYST_HIGH','PRE_AND_SEC_NOT_ELEVATED','CATALYST_HIGH_AND_SEC_NOT_ELEVATED']
    candidates=[]
    for name in names:
        a=[x for x in tr if evfilter(name,x)];m=met(a); pp=(m['precisionPct'] or 0)-(bm['precisionPct'] or 0)
        support=m['count']>=20 and m['tp']>=3 and m['tradingDays']>=4
        conf=(m['wilsonLower90Pct'] or 0)>(bm['wilsonLower90Pct'] or 0)
        score=(m['wilsonLower90Pct'] or 0)+.15*(m['precisionPct'] or 0)+.2*m['tp'] if support and pp>=3 and conf else -1e6
        candidates.append({'name':name,'train':m,'precisionImprovementPp':round(pp,2),'supportPass':support,'confidencePass':conf,'score':score})
    report['candidateDiagnostics']=candidates
    viable=[x for x in candidates if x['score']>-1e5]
    if viable:
        chosen=max(viable,key=lambda x:x['score']);z=[x for x in va if evfilter(chosen['name'],x)];vm=met(z);pp=(vm['precisionPct'] or 0)-(bva['precisionPct'] or 0)
        # Independent validation requirements. Still shadow research only.
        passv=vm['count']>=10 and vm['tp']>=2 and pp>=3 and (vm['wilsonLower90Pct'] or 0)>=(bva['wilsonLower90Pct'] or 0)
        report['selection']={'name':chosen['name'],'train':chosen['train'],'trainBase':bm,'trainDays':sorted(trdays)}
        report['validation']={'candidate':vm,'base':bva,'precisionImprovementPp':round(pp,2),'validationDays':sorted(vadays),'pass':passv}
        report['status']='VALIDATED_SHADOW_CANDIDATE' if passv else 'REJECTED_ON_FORWARD_VALIDATION'
    else:
        report['status']='NO_TRAIN_CANDIDATE'
        report['selection']={'trainBase':bm,'trainDays':sorted(trdays)};report['validation']={'base':bva,'validationDays':sorted(vadays)}
OUT.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':report['status'],'current':report['current'],'selection':report.get('selection'),'validation':report.get('validation')}))
