#!/usr/bin/env python3
"""Correct TAG5 session metadata against the official U.S. equity market calendar.

Calendar source policy: explicit NYSE/Nasdaq published schedules for 2026-2028.
This guard runs after TAG5 snapshot creation and before TAGit rich-feed scoring.
It prevents holidays/early closes from being interpreted as normal market sessions.
"""
import argparse, datetime, json, pathlib
from zoneinfo import ZoneInfo

FINVIZ=pathlib.Path('tag/data/finviz.json')
SNAPS=pathlib.Path('tag/data/snapshots.json')
ET=ZoneInfo('America/New_York')

HOLIDAYS={
  2026:{
    '2026-01-01':"New Year's Day",'2026-01-19':'Martin Luther King Jr. Day','2026-02-16':"Washington's Birthday",
    '2026-04-03':'Good Friday','2026-05-25':'Memorial Day','2026-06-19':'Juneteenth','2026-07-03':'Independence Day (Observed)',
    '2026-09-07':'Labor Day','2026-11-26':'Thanksgiving Day','2026-12-25':'Christmas Day'},
  2027:{
    '2027-01-01':"New Year's Day",'2027-01-18':'Martin Luther King Jr. Day','2027-02-15':"Washington's Birthday",
    '2027-03-26':'Good Friday','2027-05-31':'Memorial Day','2027-06-18':'Juneteenth (Observed)','2027-07-05':'Independence Day (Observed)',
    '2027-09-06':'Labor Day','2027-11-25':'Thanksgiving Day','2027-12-24':'Christmas Day (Observed)'},
  2028:{
    '2028-01-17':'Martin Luther King Jr. Day','2028-02-21':"Washington's Birthday",'2028-04-14':'Good Friday',
    '2028-05-29':'Memorial Day','2028-06-19':'Juneteenth','2028-07-04':'Independence Day','2028-09-04':'Labor Day',
    '2028-11-23':'Thanksgiving Day','2028-12-25':'Christmas Day'}
}
EARLY_CLOSE={
  2026:{'2026-11-27':'Day After Thanksgiving','2026-12-24':'Christmas Eve'},
  2027:{'2027-11-26':'Day After Thanksgiving'},
  2028:{'2028-07-03':'Pre-Independence Day','2028-11-24':'Day After Thanksgiving'}
}

def calendar_info(now_et):
    d=now_et.date().isoformat();year=now_et.year
    holiday=(HOLIDAYS.get(year) or {}).get(d)
    early=(EARLY_CLOSE.get(year) or {}).get(d)
    verified=year in HOLIDAYS
    if now_et.weekday()>=5:
        return {'session':'closed','bucket':'CLOSED','status':'WEEKEND','holidayName':None,'regularCloseET':None,'extendedCloseET':None,'verifiedYear':verified}
    if holiday:
        return {'session':'closed','bucket':'CLOSED','status':'MARKET_HOLIDAY','holidayName':holiday,'regularCloseET':None,'extendedCloseET':None,'verifiedYear':verified}
    regular_close=datetime.time(13,0) if early else datetime.time(16,0)
    extended_close=datetime.time(17,0) if early else datetime.time(20,0)
    t=now_et.time()
    if datetime.time(4,0)<=t<datetime.time(9,30):session='pre-market'
    elif datetime.time(9,30)<=t<regular_close:session='regular'
    elif regular_close<=t<=extended_close:session='after-hours'
    else:session='closed'
    if session=='pre-market':bucket=f"PM{max(1,min(6,now_et.hour-3))}"
    elif session=='regular':bucket=f"R{now_et.hour:02d}"
    elif session=='after-hours':
        start_hour=13 if early else 16
        bucket=f"AH{max(1,min(4,now_et.hour-start_hour+1))}"
    else:bucket='CLOSED'
    return {'session':session,'bucket':bucket,'status':'EARLY_CLOSE' if early else ('REGULAR_CALENDAR' if verified else 'CALENDAR_YEAR_UNVERIFIED'),
            'holidayName':early,'regularCloseET':regular_close.strftime('%H:%M'),'extendedCloseET':extended_close.strftime('%H:%M'),'verifiedYear':verified}

def parse_et(payload):
    v=payload.get('snapshotTimestampET') or payload.get('updatedAt')
    if not v:return datetime.datetime.now(datetime.timezone.utc).astimezone(ET)
    try:
        z=datetime.datetime.fromisoformat(str(v).replace('Z','+00:00'))
        return z.astimezone(ET) if z.tzinfo else z.replace(tzinfo=ET)
    except:return datetime.datetime.now(datetime.timezone.utc).astimezone(ET)

def block_row(r,info,now_et):
    r['_session']=info['session'];r['_sessionBucket']=info['bucket'];r['_marketCalendarStatus']=info['status'];r['_marketHolidayName']=info['holidayName']
    if info['session']=='closed':
        r['_snapshotType']='intraperiod';r['_finalCandidate']=False;r['_trainingEligible']=False;r['_persistenceTrainingEligible']=False
        r['_bucketContinuityStatus']='NOT_APPLICABLE';r['_dataIntegrityState']='MARKET_CLOSED_CALENDAR_GUARD';r['_modelQualificationEvaluated']=True
        r['_qualificationDecision']='BLOCKED';r['_qualificationDecisionTimestampET']=now_et.isoformat();r['_qualificationDecisionPhase']='MARKET_CLOSED'
        codes=list(r.get('_qualificationDecisionReasonCodes') or [])
        if 'MARKET_CLOSED_CALENDAR_GUARD' not in codes:codes.append('MARKET_CLOSED_CALENDAR_GUARD')
        r['_qualificationDecisionReasonCodes']=codes;r['_firstActionableSignalTimestampET']=None;r['_firstActionableSignalNullReason']='MARKET_CLOSED_CALENDAR_GUARD'

def compact_from_payload(payload,info):
    rows=payload.get('rows') or payload.get('data') or []
    return {
      'timestampUTC':payload.get('snapshotTimestampUTC') or payload.get('updatedAt'),'timestampET':payload.get('snapshotTimestampET'),'session':info['session'],'sessionBucket':info['bucket'],
      'snapshotType':'intraperiod','finalCandidate':False,'independentSourceCount':payload.get('independentSourceCount',1),'trainingEligible':False,
      'finalSnapshotReconciliation':payload.get('finalSnapshotReconciliation','PENDING_SECOND_SOURCE'),'dataIntegrityState':'TRAINING_BLOCKED',
      'trainingBlockReasons':list(dict.fromkeys(list(payload.get('trainingBlockReasons') or [])+['MARKET_CALENDAR_GUARD'])),'cadenceStatus':payload.get('cadenceStatus'),
      'gapMinutesFromPriorSessionSnapshot':payload.get('gapMinutesFromPriorSessionSnapshot'),'bucketContinuityStatus':'NOT_APPLICABLE','persistenceTrainingEligible':False,
      'persistenceMethod':payload.get('persistenceMethod'),'extendedHoursFieldIntegrity':payload.get('extendedHoursFieldIntegrity'),'marketCalendarStatus':info['status'],
      'marketHolidayName':info['holidayName'],'scheduledRegularCloseET':info['regularCloseET'],'scheduledExtendedCloseET':info['extendedCloseET'],
      'topMovers':[{'Ticker':r.get('Ticker'),'Change':r.get('Change'),'Price':r.get('Price'),'Volume':r.get('Volume'),'signals':r.get('_signals',[])} for r in rows[:100]]}

def apply_guard():
    try:payload=json.loads(FINVIZ.read_text(encoding='utf-8'))
    except Exception as e:
        print(json.dumps({'status':'SKIP','reason':'FINVIZ_JSON_UNREADABLE','error':type(e).__name__}));return 0
    if not isinstance(payload,dict) or not payload:
        print(json.dumps({'status':'SKIP','reason':'FINVIZ_JSON_EMPTY'}));return 0
    now_et=parse_et(payload);info=calendar_info(now_et);old_session=str(payload.get('session') or 'unknown');old_bucket=str(payload.get('sessionBucket') or 'unknown')
    payload['session']=info['session'];payload['sessionBucket']=info['bucket'];payload['marketCalendarStatus']=info['status'];payload['marketHolidayName']=info['holidayName']
    payload['marketCalendarVerifiedYear']=info['verifiedYear'];payload['scheduledRegularCloseET']=info['regularCloseET'];payload['scheduledExtendedCloseET']=info['extendedCloseET']
    payload['marketCalendarGuardAppliedAtUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    if info['session']=='closed':
        payload['snapshotType']='intraperiod';payload['finalCandidate']=False;payload['trainingEligible']=False;payload['persistenceTrainingEligible']=False;payload['bucketContinuityStatus']='NOT_APPLICABLE'
        payload['dataIntegrityState']='TRAINING_BLOCKED';payload['trainingBlockReasons']=list(dict.fromkeys(list(payload.get('trainingBlockReasons') or [])+['MARKET_CLOSED_CALENDAR_GUARD']))
    for r in payload.get('rows') or []:block_row(r,info,now_et)
    if payload.get('data') is not payload.get('rows'):
        for r in payload.get('data') or []:block_row(r,info,now_et)
    FINVIZ.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')

    try:snaps=json.loads(SNAPS.read_text(encoding='utf-8')) if SNAPS.exists() else []
    except:snaps=[]
    date_et=now_et.date().isoformat();removed=0;patched=0
    if isinstance(snaps,list):
        if info['status'] in ('MARKET_HOLIDAY','WEEKEND'):
            before=len(snaps);snaps=[s for s in snaps if str(s.get('timestampET') or '')[:10]!=date_et];removed=before-len(snaps)
        elif old_session!=info['session'] or old_bucket!=info['bucket']:
            stamp=str(payload.get('snapshotTimestampUTC') or payload.get('updatedAt') or '')
            for s in snaps:
                if str(s.get('timestampUTC') or '')==stamp:
                    c=compact_from_payload(payload,info);s.clear();s.update(c);patched+=1
        SNAPS.write_text(json.dumps(snaps,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'PASS','timestampET':now_et.isoformat(),'oldSession':old_session,'correctedSession':info['session'],'oldBucket':old_bucket,'correctedBucket':info['bucket'],
                      'calendarStatus':info['status'],'holidayName':info['holidayName'],'regularCloseET':info['regularCloseET'],'extendedCloseET':info['extendedCloseET'],'snapshotsRemoved':removed,'snapshotsPatched':patched}))
    return 0

def self_test():
    cases=[
      ('2026-09-07T10:00:00-04:00','closed','MARKET_HOLIDAY'),
      ('2026-09-08T08:00:00-04:00','pre-market','REGULAR_CALENDAR'),
      ('2026-11-27T12:30:00-05:00','regular','EARLY_CLOSE'),
      ('2026-11-27T13:30:00-05:00','after-hours','EARLY_CLOSE'),
      ('2026-11-27T17:30:00-05:00','closed','EARLY_CLOSE'),
      ('2027-12-24T10:00:00-05:00','closed','MARKET_HOLIDAY'),
      ('2028-07-03T13:30:00-04:00','after-hours','EARLY_CLOSE')]
    out=[]
    for raw,sess,status in cases:
        z=datetime.datetime.fromisoformat(raw);got=calendar_info(z);ok=got['session']==sess and got['status']==status;out.append({'at':raw,'expected':sess,'actual':got['session'],'status':got['status'],'ok':ok});assert ok,out[-1]
    print(json.dumps({'status':'PASS','tests':out}));return 0

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--self-test',action='store_true');args=ap.parse_args();raise SystemExit(self_test() if args.self_test else apply_guard())
