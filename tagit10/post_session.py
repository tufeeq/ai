#!/usr/bin/env python3
"""Causal same-day mover benchmark: immutable first-seen ledger vs close winners."""
import csv,io,json,os,urllib.request
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from quality import VERSION,STAGES,quality_summary,wilson,ts
ET=ZoneInfo('America/New_York'); ROOT=Path(__file__).resolve().parents[1]
STATE=Path(os.getenv('TAGIT_STATE_PATH',str(ROOT/'tagit10-state.json')))
OUT=ROOT/'tag/data/tagit10-post-session.json'

def top50():
    token=os.getenv('FINVIZ_TOKEN','').strip()
    if not token: raise RuntimeError('FINVIZ_TOKEN missing: recall unavailable')
    req=urllib.request.Request(f'https://elite.finviz.com/export/screener?s=ta_topgainers&v=152&auth={token}',headers={'User-Agent':'Mozilla/5.0 TAGit10'})
    with urllib.request.urlopen(req,timeout=20) as r: raw=r.read().decode('utf-8-sig','ignore')
    rows={}
    for x in csv.DictReader(io.StringIO(raw)):
        try: s=x['Ticker'].strip().upper(); change=float(x['Change'].replace('%',''))
        except (KeyError,ValueError): continue
        if s and change>0: rows[s]=change
    return sorted(rows.items(),key=lambda x:x[1],reverse=True)[:50]

def build_report(state,winners,at):
    et=at.astimezone(ET); date=et.date().isoformat(); same_day=state.get('sessionDateET')==date
    close=et.replace(hour=16,minute=0,second=0,microsecond=0).timestamp()
    ledger=[s for s in state.get('signalLedger',{}).values() if s.get('version')==VERSION and s.get('sessionDateET')==date and ts(s.get('signalAtUTC')) is not None and ts(s['signalAtUTC'])<=close]
    cases=[]
    for rank,(symbol,change) in enumerate(winners,1):
        all_seen=sorted([s for s in ledger if s.get('symbol')==symbol],key=lambda s:s['signalAtUTC'])
        early=[s for s in all_seen if s.get('stage') in STAGES and s.get('changeAtSignalPct') is not None and s['changeAtSignalPct']<10]
        first=early[0] if early else None
        first_any=all_seen[0] if all_seen else None
        cases.append({'rank':rank,'symbol':symbol,'closeChangePct':change,'capturedBefore10':bool(first),
          'firstSignalAtUTC':first.get('signalAtUTC') if first else None,
          'changeAtFirstSignalPct':first.get('changeAtSignalPct') if first else None,
          'stageAtFirstSignal':first.get('stage') if first else None,
          'firstSeenAtUTC':first_any.get('signalAtUTC') if first_any else None,
          'firstSeenChangePct':first_any.get('changeAtSignalPct') if first_any else None,
          'missReason':'NEVER_SEEN' if not first_any else ('FIRST_SEEN_AT_OR_AFTER_10PCT' if not first else None)})
    complete=same_day and len(winners)==50
    captured=sum(x['capturedBefore10'] for x in cases)
    missed=[x for x in cases if not x['capturedBefore10']]
    return {'version':VERSION,'sessionDateET':date,'generatedAtUTC':at.isoformat(),
      'status':'FINAL' if complete else 'INCOMPLETE_EVIDENCE','targetEarlyRecallPct':95,
      'top50Count':len(winners),'captured':captured if same_day else None,
      'missed':len(missed) if same_day else None,
      'earlyRecallPct':round(100*captured/50,2) if complete else None,
      'wilson95LowerPct':wilson(captured,50) if complete else None,
      'achieved':bool(complete and captured>=48),
      'reason':None if complete else 'Requires same-day state and 50 positive close winners',
      'signalQuality':quality_summary(state) if same_day else None,'cases':cases,
      'rootCauseCounts':{k:sum(1 for x in missed if x['missReason']==k) for k in ['NEVER_SEEN','FIRST_SEEN_AT_OR_AFTER_10PCT']} if same_day else None,
      'scope':'Finviz positive close top-50; immutable same-day TAGit10 signal ledger; early means a recorded eligible stage below +10%.',
      'validation':'Session benchmark is descriptive evidence, not a trading approval. No same-session tuning is promoted.'}

def main():
    at=datetime.now(timezone.utc); et=at.astimezone(ET)
    allow=os.getenv('TAGIT_POST_SESSION_FORCE')=='1'
    if not allow and (et.weekday()>=5 or not ((16,15)<=(et.hour,et.minute)<=(16,55))): raise SystemExit('Run between 16:15 and 16:55 ET')
    state=json.loads(STATE.read_text()); report=build_report(state,top50(),at)
    OUT.parent.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    archive=ROOT/'tagit10/reports'/f'{report["sessionDateET"]}-{VERSION}.json'; archive.parent.mkdir(exist_ok=True); archive.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['status','top50Count','captured','missed','earlyRecallPct','rootCauseCounts']}))
if __name__=='__main__': main()
