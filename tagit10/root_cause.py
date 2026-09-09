#!/usr/bin/env python3
import json, subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tagit10-root-cause.json'

def load(p,default=None):
 try:return json.loads(Path(p).read_text())
 except:return default if default is not None else {}
def git_versions(path):
 try:
  shas=subprocess.check_output(['git','log','--format=%H','--',path],text=True).splitlines()
 except:return []
 out=[]
 for sha in shas[:400]:
  try:
   raw=subprocess.check_output(['git','show',f'{sha}:{path}'],text=True,stderr=subprocess.DEVNULL); j=json.loads(raw); ts=j.get('updatedAtUTC')
   if ts: out.append((ts,j))
  except:pass
 return sorted(out)
def top50():
 f=load(ROOT/'tag/data/finviz.json',{})
 rows=f.get('rows') or f.get('data') or []
 def pct(r):
  try:return float(str(r.get('Change') or r.get('changePct') or '0').replace('%',''))
  except:return -999
 return sorted([r for r in rows if (r.get('Ticker') or r.get('symbol'))],key=pct,reverse=True)[:50]
def main():
 winners=top50(); hist=git_versions('tagit10-live.json'); state=load(ROOT/'tagit10-state.json',{}); syms=state.get('symbols',{})
 cases=[]
 for rank,w in enumerate(winners,1):
  s=(w.get('Ticker') or w.get('symbol')).upper(); final=str(w.get('Change') or w.get('changePct') or '')
  seen=[]; sig=[]; stale=False
  for ts,j in hist:
   row=next((x for x in (j.get('watch') or []) if x.get('symbol')==s),None)
   if row:
    seen.append((ts,row))
    if row.get('stage') in ('EARLY','ACTIONABLE','CONFIRMED'):sig.append((ts,row))
  rec=syms.get(s)
  if not seen: reason='NOT_IN_LIVE_UNIVERSE'; action='increase market sweep coverage / discovery lanes'
  elif not sig:
   best=max((x[1].get('score',0) for x in seen),default=0)
   reason='IN_UNIVERSE_NO_SIGNAL'; action=f'review gating: maxScore={best:.1f}; compare flow features with controls'
  else:
   first=sig[0][1]; ch=float(first.get('changePct') or 0)
   if ch>=10: reason='LATE_FIRST_SIGNAL'; action='lower only causal gates shared by missed winners; preserve control precision'
   elif ch>=5: reason='DETECTED_5_TO_10'; action='optimize lead time toward pre-5 detection'
   else: reason='EARLY_SUCCESS'; action='retain pattern; validate on future sessions'
  cases.append({'rank':rank,'symbol':s,'finalChange':final,'reason':reason,'action':action,'firstSeenUTC':seen[0][0] if seen else None,'firstSignalUTC':sig[0][0] if sig else None,'firstSignalChangePct':sig[0][1].get('changePct') if sig else None})
 counts=Counter(x['reason'] for x in cases); pre10=sum(x['reason'] in ('EARLY_SUCCESS','DETECTED_5_TO_10') for x in cases); pre5=sum(x['reason']=='EARLY_SUCCESS' for x in cases)
 recs=[]
 if counts['NOT_IN_LIVE_UNIVERSE']:recs.append({'priority':1,'change':'COVERAGE','why':f"{counts['NOT_IN_LIVE_UNIVERSE']} top winners never reached the live watch set",'rule':'expand/rotate sweep before loosening signal thresholds'})
 if counts['IN_UNIVERSE_NO_SIGNAL']:recs.append({'priority':2,'change':'GATING','why':f"{counts['IN_UNIVERSE_NO_SIGNAL']} were observed but never signaled",'rule':'learn feature deltas against controls; no automatic hindsight threshold change'})
 if counts['LATE_FIRST_SIGNAL']:recs.append({'priority':3,'change':'LEAD_TIME','why':f"{counts['LATE_FIRST_SIGNAL']} first signaled at >=10%",'rule':'penalize late detections in objective'})
 out={'schemaVersion':10,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'method':'POINT_IN_TIME_GIT_HISTORY','goalEarlyTop50RecallPct':70,'top50Count':len(cases),'pre10Detected':pre10,'pre10RecallPct':round(100*pre10/len(cases),2) if cases else None,'pre5Detected':pre5,'pre5RecallPct':round(100*pre5/len(cases),2) if cases else None,'rootCauseCounts':dict(counts),'recommendations':recs,'cases':cases,'guardrail':'Recommendations are diagnostic. No parameter is promoted from same-session hindsight; changes require future-session validation.'}
 OUT.write_text(json.dumps(out,separators=(',',':'))); print(json.dumps({k:out[k] for k in ('top50Count','pre10RecallPct','pre5RecallPct','rootCauseCounts')}))
if __name__=='__main__':main()
