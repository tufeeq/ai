#!/usr/bin/env python3
"""TAGit v5.16 immutable post-session forward evaluator.

Reads frozen v5.15 prediction sets, attaches outcomes only after the regular session
has completed, and writes a separate append-only outcome ledger plus derived report.
It never mutates prediction captures, model parameters, feature vectors or thresholds.

v5.16.1 hardening: an outcome set is not sealed into the append-only ledger unless
all selected predictions have labels and >=90% of the scored universe is labelled.
This prevents transient quote/API failures from irreversibly creating a biased
forward sample that can never be retried.
"""
import argparse, hashlib, json, math, random, statistics, time, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('tag/data'); PRED=ROOT/'tagit-v515-forward-predictions.json'; OUT=ROOT/'tagit-v516-forward-outcomes.json'; REPORT=ROOT/'tagit-v516-forward-evaluation.json'
NY=ZoneInfo('America/New_York'); UA={'User-Agent':'Mozilla/5.0 TAGit-v5.16-forward-validation'}
OPEN=9*60+30; LABEL_END=11*60+30; TARGET=10.0; MIN_OUTCOME_COVERAGE=90.0

def readj(p,d,required=False):
    if not p.exists():
        if required: raise FileNotFoundError(str(p))
        return d
    try: return json.loads(p.read_text(encoding='utf-8'))
    except Exception as e:
        # Append-only evidence must never silently reset after corruption.
        raise RuntimeError(f'MALFORMED_JSON:{p}:{type(e).__name__}:{e}') from e

def canon(x): return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def sha(x): return hashlib.sha256(canon(x)).hexdigest()
def pct(a,b): return round(100*a/b,2) if b else None

def fetch(sym,retries=3):
    q=urllib.parse.quote(sym,safe=''); err=None
    for k in range(retries):
      for host in ('query2.finance.yahoo.com','query1.finance.yahoo.com'):
        u=f'https://{host}/v8/finance/chart/{q}?range=10d&interval=5m&includePrePost=true&events=div%2Csplits'
        try:
          req=urllib.request.Request(u,headers=UA)
          with urllib.request.urlopen(req,timeout=20) as r:d=json.loads(r.read().decode())
          z=((d.get('chart') or {}).get('result') or [None])[0]
          if not z:continue
          ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]; H=qq.get('high') or []; C=qq.get('close') or []
          out=[]
          for i,t in enumerate(ts):
            if i>=len(C) or C[i] is None:continue
            dt=datetime.fromtimestamp(int(t),timezone.utc).astimezone(NY); h=float(H[i] if i<len(H) and H[i] is not None else C[i]); c=float(C[i])
            out.append((dt,h,c))
          if out:return out,None
        except Exception as e:err=f'{type(e).__name__}:{e}'
      time.sleep(.35*(k+1))
    return [],err or 'EMPTY'

def wilson(tp,n,z=1.6448536269514722):
    if not n:return None
    p=tp/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; r=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return round(100*max(0,c-r),2)

def day_boot(rows,iters=4000):
    days=sorted({r['date'] for r in rows})
    if len(days)<2:return None
    by=defaultdict(list)
    for r in rows:by[r['date']].append(r)
    rng=random.Random(516); vals=[]
    for _ in range(iters):
      samp=[rng.choice(days) for __ in days]; a=[x for d in samp for x in by[d]]
      if a:vals.append(sum(x['hit10First120'] for x in a)/len(a))
    vals.sort(); return round(100*vals[int(.10*(len(vals)-1))],2) if vals else None

def label_row(row, bars, day):
    rth=[x for x in bars if x[0].date().isoformat()==day and OPEN<=x[0].hour*60+x[0].minute<LABEL_END]
    if not rth:return None
    px=float(row['priceAtDecision']); target=px*(1+TARGET/100); maxh=max(x[1] for x in rth); hits=[x for x in rth if x[1]>=target]
    first=hits[0][0] if hits else None
    decision=datetime.fromisoformat(row['decisionBarET'])
    return {'ticker':row['ticker'],'selected':bool(row['selected']),'rank':row.get('rank'),'score':row.get('score'),'decisionPrice':px,'hit10First120':bool(hits),'firstHitUTC':first.astimezone(timezone.utc).isoformat() if first else None,'leadMin':round((first-decision).total_seconds()/60,1) if first else None,'remainingUpsidePct':round((maxh/px-1)*100,2)}

def commit_ready(expected, selected_expected, rows):
    observed=len(rows); selected_observed=sum(bool(r['selected']) for r in rows)
    coverage=pct(observed,expected) or 0.0
    return bool(expected and coverage>=MIN_OUTCOME_COVERAGE and selected_observed==selected_expected), coverage, selected_observed

def metrics(selected, universe_rows, set_pairs):
    tp=sum(r['hit10First120'] for r in selected); n=len(selected); days=sorted({r['date'] for r in selected}); leads=[r['leadMin'] for r in selected if r['hit10First120'] and r['leadMin'] is not None]; ups=[r['remainingUpsidePct'] for r in selected]
    top=[]
    for d in days:
      a=sorted([r for r in selected if r['date']==d],key=lambda x:(x.get('rank') or 10**9))[:3]; top.extend(a)
    all_days=sorted({r['date'] for r in universe_rows}); winner_days=0; captured=0
    for d in all_days:
      u=[r for r in universe_rows if r['date']==d]; s=[r for r in selected if r['date']==d]
      if any(x['hit10First120'] for x in u):
        winner_days+=1; captured+=int(any(x['hit10First120'] for x in s))
    sets=[s for s,_ in set_pairs]; outcomes=[o for _,o in set_pairs]
    min_pred_cov=min([s.get('coveragePct',0) for s in sets],default=0)
    min_out_cov=min([o.get('outcomeCoveragePct',0) for o in outcomes],default=0)
    all_selected_complete=bool(outcomes) and all(o.get('selectedOutcomeCount')==o.get('selectedExpected') for o in outcomes)
    integrity=bool(sets) and all(s.get('universeIntegrityEligible') is True for s in sets) and min_pred_cov>=90 and min_out_cov>=MIN_OUTCOME_COVERAGE and all_selected_complete
    adequate=n>=100 and len(days)>=20
    return {'independentTickerDays':n,'tp':tp,'precisionPct':pct(tp,n),'wilsonLower90Pct':wilson(tp,n),'dayBlockBootstrapLower90Pct':day_boot(selected),'activeDays':len(days),'medianLeadMin':round(statistics.median(leads),2) if leads else None,'top3DailyCount':len(top),'top3DailyPrecisionPct':pct(sum(x['hit10First120'] for x in top),len(top)),'medianRemainingUpsidePct':round(statistics.median(ups),2) if ups else None,'winnerDays':winner_days,'capturedWinnerDays':captured,'winnerDayRecallPct':pct(captured,winner_days),'minimumPredictionCoveragePct':round(min_pred_cov,2),'minimumOutcomeCoveragePct':round(min_out_cov,2),'allSelectedOutcomesComplete':all_selected_complete,'universeIntegrity':integrity,'adequateIndependentSupport':adequate,'realDiscoveryPrecisionPct':pct(tp,n) if integrity and adequate else None}

def evaluate(write=True):
    pred=readj(PRED,{},required=True); assert pred.get('policy')=='APPEND_ONLY_PREDICTIONS_BEFORE_OUTCOMES_NO_RETROSPECTIVE_SCORING'
    led=readj(OUT,{'schemaVersion':'5.16.1-forward-outcomes','policy':'APPEND_ONLY_POST_SESSION_LABELS_SEPARATE_FROM_PREDICTIONS','outcomes':[]})
    assert led.get('policy')=='APPEND_ONLY_POST_SESSION_LABELS_SEPARATE_FROM_PREDICTIONS'
    assert len({x['outcomeSetId'] for x in led['outcomes']})==len(led['outcomes'])
    seen={x['outcomeSetId'] for x in led['outcomes']}
    now=datetime.now(timezone.utc); added=0; deferred=[]
    for s in pred.get('predictions') or []:
      day=str(s.get('predictionFrozenAtET',''))[:10]; oid=s['predictionSetId']+'|outcome-v516'
      if oid in seen:continue
      # Fail closed: only label after 16:15 ET on the target date, or any later date.
      target=datetime.fromisoformat(day+'T16:15:00').replace(tzinfo=NY).astimezone(timezone.utc)
      if now<target:continue
      rows=[]; errors={}
      for r in s.get('rows') or []:
        bars,err=fetch(r['ticker'])
        if err:errors[r['ticker']]=err; continue
        x=label_row(r,bars,day)
        if x: rows.append(x)
        else: errors[r['ticker']]='NO_RTH_LABEL_BARS'
      expected=int(s.get('scoredCount',len(s.get('rows') or []))); selected_expected=sum(bool(r.get('selected')) for r in s.get('rows') or [])
      ready,coverage,selected_observed=commit_ready(expected,selected_expected,rows)
      if not ready:
        deferred.append({'predictionSetId':s['predictionSetId'],'date':day,'expected':expected,'observed':len(rows),'outcomeCoveragePct':coverage,'selectedExpected':selected_expected,'selectedObserved':selected_observed,'reason':'RETRY_REQUIRED_INCOMPLETE_OUTCOMES','errors':errors})
        continue
      entry={'outcomeSetId':oid,'predictionSetId':s['predictionSetId'],'date':day,'modelPayloadSha256':s['modelPayloadSha256'],'predictionSetDigest':sha(s),'labeledAtUTC':now.isoformat(),'scoredCountExpected':expected,'outcomeCount':len(rows),'outcomeCoveragePct':coverage,'selectedExpected':selected_expected,'selectedOutcomeCount':selected_observed,'predictionCoveragePct':s.get('coveragePct'),'universeIntegrityEligible':s.get('universeIntegrityEligible',False),'rows':rows,'errors':errors}
      led['outcomes'].append(entry); seen.add(oid); added+=1
    if write and added: OUT.write_text(json.dumps(led,indent=2)+'\n',encoding='utf-8')
    # Derive metrics only from immutable outcome records whose prediction digest still matches.
    set_pairs=[]; universe=[]; selected=[]; pmap={x['predictionSetId']:x for x in pred.get('predictions') or []}
    for o in led['outcomes']:
      s=pmap.get(o['predictionSetId'])
      if not s or o.get('predictionSetDigest')!=sha(s):continue
      # Legacy pre-hardening entries without completeness metadata fail closed for real-integrity status.
      set_pairs.append((s,o))
      for r in o['rows']:
        x={**r,'date':o['date']}; universe.append(x)
        if x['selected']:selected.append(x)
    m=metrics(selected,universe,set_pairs)
    report={'schemaVersion':'5.16.1-forward-evaluation','generatedAtUTC':now.isoformat(),'status':'FORWARD_EVIDENCE_ACCUMULATING' if set_pairs else ('OUTCOME_RETRY_PENDING' if deferred else 'NO_OUTCOME_LABELLED_FORWARD_SETS'),'objective':'frozen 09:15 ET discovery of actionable +10% within first 120 regular-session minutes','outcomeSets':len(set_pairs),'deferredIncompleteSets':deferred,'metrics':m,'universeIntegrity':m['universeIntegrity'],'realDiscoveryPrecisionPct':m['realDiscoveryPrecisionPct'],'ninetyPctClaimAllowed':bool(m['realDiscoveryPrecisionPct'] is not None and m['precisionPct']>=90 and (m['wilsonLower90Pct'] or 0)>=80 and (m['dayBlockBootstrapLower90Pct'] or 0)>=80),'antiLeakage':['v5.15 predictions remain immutable and outcome-free','labels are attached only after 16:15 ET in a separate append-only ledger','incomplete outcome sets are never sealed; they remain retryable','every selected prediction must have an outcome before a set can enter evidence','prediction-set digest must still match before inclusion','no threshold/model/config selection occurs in evaluator','support is one ticker/day per frozen decision','real precision remains null until >=100 selected ticker-days, >=20 active days, >=90% prediction/outcome coverage and point-in-time universe eligibility']}
    if write: REPORT.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return added,report

def self_test():
    assert round(wilson(90,100),2)<90
    fake=[]
    for d in range(20):
      for i in range(5):fake.append({'date':f'2026-01-{d+1:02d}','hit10First120':i<2,'leadMin':30,'remainingUpsidePct':12,'rank':i+1})
    assert day_boot(fake) is not None
    rows=[{'selected':True},{'selected':False}]*45
    ok,cov,sel=commit_ready(100,45,rows); assert ok and cov==90.0 and sel==45
    ok,_,_=commit_ready(100,46,rows); assert not ok
    ok,_,_=commit_ready(100,45,rows[:-1]); assert not ok
    print('v5.16.1 metric/completeness/uncertainty self-test: OK')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--self-test',action='store_true'); ap.add_argument('--dry-run',action='store_true'); a=ap.parse_args()
    if a.self_test:self_test(); return
    added,report=evaluate(not a.dry_run); print(json.dumps({'addedOutcomeSets':added,'report':report},indent=2))
if __name__=='__main__':main()
