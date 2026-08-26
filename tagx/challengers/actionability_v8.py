#!/usr/bin/env python3
import argparse, datetime as dt, json
from pathlib import Path


def load(p):
    q=Path(p)
    if not q.exists() or not q.stat().st_size: return {}
    return json.loads(q.read_text(encoding='utf-8'))

def num(v):
    try: return float(str(v).replace('%','').replace(',','').replace('$','').strip())
    except Exception: return None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--v7',default='tag/data/tagx-authoritative-peak-v7-challenger.json')
    ap.add_argument('--out',default='tag/data/tagx-actionability-v8-challenger.json')
    a=ap.parse_args(); v7=load(a.v7)
    if v7.get('schemaVersion')!=7: raise SystemExit('v7 unavailable')
    out=[]; actionable=0; blocked=0
    for x in v7.get('currentTop20') or []:
        origin=num(x.get('proactiveFirstChangePct')); cur=num(x.get('changePct')); peak=num(x.get('sessionPeakChangePct'))
        give=num(x.get('peakGivebackPts'))
        retention=(cur/peak) if cur is not None and peak and peak>0 else None
        score=45; up=[]; down=[]
        if origin is not None:
            if origin<5: score+=22; up.append('origin<5')
            elif origin<10: score+=14; up.append('origin<10')
            elif origin>=20: score-=28; down.append('late-origin')
        if cur is not None and 2<=cur<15: score+=12; up.append('current-early-zone')
        if peak is not None and peak<25: score+=8; up.append('peak<25')
        if retention is not None and .65<=retention<=1.10 and peak is not None and 8<=peak<25:
            score+=12; up.append('healthy-retention')
        if give is not None and give>=8: score-=24; down.append('giveback>=8pt')
        if peak is not None and peak>=25: score-=28; down.append('late-peak')
        if peak is not None and peak>=50: score-=22; down.append('exhaustion-peak')
        risk=x.get('peakMemoryRisk') or 'NONE'
        if risk!='NONE': score-=12; down.append(risk)
        score=max(0,min(100,round(score)))
        is_actionable=(score>=70 and risk=='NONE' and cur is not None and cur<25 and (origin is None or origin<10))
        critic='PASS' if is_actionable else 'REJECT'
        actionable+=int(is_actionable); blocked+=int(not is_actionable)
        out.append({**x,'retentionRatio':round(retention,3) if retention is not None else None,'actionabilityScore':score,'critic':critic,'actionableEarly':is_actionable,'trace':{'up':up,'down':down}})
    payload={'schemaVersion':8,'sessionDateET':v7.get('sessionDateET'),'updatedAtUTC':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'CHALLENGER_ONLY','trainingEligible':False,'groundTruthEligible':False,'source':'tagx-authoritative-peak-v7-challenger.json','actionableEarlyCount':actionable,'criticRejectedCount':blocked,'currentTop20':out,'policy':'Peak-aware actionability. Never promotes late/exhausted runners; evaluates signal-time origin, peak memory, giveback and retention. Thresholds are challenger-only until multi-session evidence.'}
    Path(a.out).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'top20':len(out),'actionableEarly':actionable,'criticRejected':blocked}))

if __name__=='__main__': main()
