#!/usr/bin/env python3
import argparse, datetime as dt, json
from pathlib import Path


def load(p):
    q=Path(p)
    if not q.exists() or not q.stat().st_size:return {}
    return json.loads(q.read_text(encoding='utf-8'))

def num(v):
    try:return float(str(v).replace('%','').replace(',','').replace('$','').strip())
    except:return None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--v8',default='tag/data/tagx-actionability-v8-challenger.json')
    ap.add_argument('--out',default='tag/data/tagx-missed-mover-replay-v9-challenger.json')
    a=ap.parse_args(); v8=load(a.v8)
    if v8.get('schemaVersion')!=8: raise SystemExit('v8 unavailable')
    rows=[]; early=late=missed=unverified=0
    for x in v8.get('currentTop20') or []:
        first=num(x.get('proactiveFirstChangePct')); cur=num(x.get('changePct')); peak=num(x.get('sessionPeakChangePct'))
        src=x.get('proactiveFirstSource') or x.get('firstSource') or 'UNKNOWN'
        conf=x.get('dataConfidence') or 'UNKNOWN'
        klass=x.get('class') or ''
        if conf in ('UNAVAILABLE','CONFLICT','DATA_INTEGRITY_ERROR'):
            status='DATA_UNVERIFIED'; unverified+=1
        elif first is not None and first < 10:
            status='PREDICTED_EARLY'; early+=1
        elif first is not None and first < 25:
            status='DETECTED_LATE'; late+=1
        elif first is None:
            status='MISSED'; missed+=1
        else:
            status='DETECTED_LATE'; late+=1
        lead=None
        ft=x.get('proactiveFirstSeenET') or x.get('proactiveFirstTimestampET')
        mt=x.get('moverBoardSeenET') or x.get('reactiveSeenET')
        try:
            if ft and mt: lead=round((dt.datetime.fromisoformat(mt)-dt.datetime.fromisoformat(ft)).total_seconds()/60,1)
        except: pass
        rows.append({**x,'replayStatus':status,'timeToDetectionMinutes':lead,'replayWindows':['T-60','T-30','T-15','T-5'],'replayPolicy':'Use only snapshots timestamped before mover-board observation; reactive rank is evaluation-only.','originSource':src,'peakAtEvaluation':peak,'currentAtEvaluation':cur})
    den=max(1,early+late+missed)
    payload={'schemaVersion':9,'sessionDateET':v8.get('sessionDateET'),'updatedAtUTC':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'CHALLENGER_ONLY','trainingEligible':False,'groundTruthEligible':False,'source':'tagx-actionability-v8-challenger.json','counts':{'predictedEarly':early,'detectedLate':late,'missed':missed,'dataUnverified':unverified},'earlyCaptureRatePct':round(100*early/den,2),'adjustedEarlyCaptureRatePct':round(100*early/max(1,early+late+missed),2),'currentTop20':rows,'antiLeakage':'Reactive mover-board data never becomes a predictive feature. Replay reads only pre-observation snapshots.','purpose':'Measure Time-to-Detection and reconstruct T-5/T-15/T-30/T-60 evidence for misses without threshold changes from single cases.'}
    Path(a.out).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(payload['counts']))
if __name__=='__main__':main()
