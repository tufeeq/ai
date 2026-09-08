#!/usr/bin/env python3
"""TAGit v5.17 execution-aware forward validator.

Measures whether a frozen 09:15 ET discovery remained actionable from the first
regular-session executable price. This is a derived post-session evaluator only:
it never changes model parameters, thresholds, captures, or prediction ledgers.
"""
import argparse, json, math, random, statistics, time, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('tag/data'); PRED=ROOT/'tagit-v515-forward-predictions.json'; OUT=ROOT/'tagit-v517-execution-aware.json'
NY=ZoneInfo('America/New_York'); UA={'User-Agent':'Mozilla/5.0 TAGit-v5.17-execution-aware'}
OPEN=570; END=690; TARGET=10.0

def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def pct(a,b): return round(100*a/b,2) if b else None

def wilson(tp,n,z=1.6448536269514722):
    if not n:return None
    p=tp/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; r=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return round(100*max(0,c-r),2)

def day_boot(rows,iters=4000):
    days=sorted({r['date'] for r in rows})
    if len(days)<2:return None
    by=defaultdict(list)
    for r in rows:by[r['date']].append(r)
    rng=random.Random(517); vals=[]
    for _ in range(iters):
        ds=[rng.choice(days) for __ in days]; a=[x for d in ds for x in by[d]]
        if a: vals.append(sum(x['hitExecutable10'] for x in a)/len(a))
    vals.sort(); return round(100*vals[int(.10*(len(vals)-1))],2) if vals else None

def fetch(sym,retries=3):
    q=urllib.parse.quote(sym,safe=''); err=None
    for k in range(retries):
        for host in ('query2.finance.yahoo.com','query1.finance.yahoo.com'):
            u=f'https://{host}/v8/finance/chart/{q}?range=10d&interval=5m&includePrePost=true&events=div%2Csplits'
            try:
                with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=20) as r:d=json.loads(r.read().decode())
                z=((d.get('chart') or {}).get('result') or [None])[0]
                if not z:continue
                ts=z.get('timestamp') or []; qq=((z.get('indicators') or {}).get('quote') or [{}])[0]
                O=qq.get('open') or []; H=qq.get('high') or []; L=qq.get('low') or []; C=qq.get('close') or []
                out=[]
                for i,t in enumerate(ts):
                    if i>=len(C) or C[i] is None: continue
                    c=float(C[i]); o=float(O[i] if i<len(O) and O[i] is not None else c); h=float(H[i] if i<len(H) and H[i] is not None else c); l=float(L[i] if i<len(L) and L[i] is not None else c)
                    dt=datetime.fromtimestamp(int(t),timezone.utc).astimezone(NY); out.append((dt,o,h,l,c))
                if out:return out,None
            except Exception as e:err=f'{type(e).__name__}:{e}'
        time.sleep(.35*(k+1))
    return [],err or 'EMPTY'

def label(row,bars,day):
    r=[x for x in bars if x[0].date().isoformat()==day and OPEN<=x[0].hour*60+x[0].minute<END]
    if not r:return None
    entry=r[0][1]; decision=float(row['priceAtDecision'])
    if entry<=0:return None
    target=entry*1.10; hit=[x for x in r if x[2]>=target]; maxh=max(x[2] for x in r); minl=min(x[3] for x in r)
    return {'ticker':row['ticker'],'date':day,'selected':bool(row['selected']),'rank':row.get('rank'),'decisionPrice':decision,'entryPrice':round(entry,6),'openSlippagePct':round((entry/decision-1)*100,2),'hitExecutable10':bool(hit),'leadFromOpenMin':round((hit[0][0]-r[0][0]).total_seconds()/60,1) if hit else None,'remainingUpsideFromEntryPct':round((maxh/entry-1)*100,2),'maxAdverseExcursionPct':round((minl/entry-1)*100,2)}

def derive():
    pred=readj(PRED,{}); assert pred.get('policy')=='APPEND_ONLY_PREDICTIONS_BEFORE_OUTCOMES_NO_RETROSPECTIVE_SCORING'
    now=datetime.now(timezone.utc); rows=[]; sets=[]; errors={}
    for s in pred.get('predictions') or []:
        day=str(s.get('predictionFrozenAtET',''))[:10]
        target=datetime.fromisoformat(day+'T16:15:00').replace(tzinfo=NY).astimezone(timezone.utc)
        if now<target:continue
        sets.append(s)
        for r in s.get('rows') or []:
            bars,err=fetch(r['ticker'])
            if err:errors[f"{day}:{r['ticker']}"]=err; continue
            x=label(r,bars,day)
            if x:rows.append(x)
    sel=[r for r in rows if r['selected']]; tp=sum(r['hitExecutable10'] for r in sel); n=len(sel); days=sorted({r['date'] for r in sel})
    top=[]
    for d in days:top += sorted([r for r in sel if r['date']==d],key=lambda x:x.get('rank') or 10**9)[:3]
    winner_days=0; captured=0
    for d in sorted({r['date'] for r in rows}):
        u=[r for r in rows if r['date']==d]; s=[r for r in sel if r['date']==d]
        if any(x['hitExecutable10'] for x in u):winner_days+=1; captured+=int(any(x['hitExecutable10'] for x in s))
    coverage=min([s.get('coveragePct',0) for s in sets],default=0); integrity=bool(sets) and all(s.get('universeIntegrityEligible') is True for s in sets) and coverage>=90
    adequate=n>=100 and len(days)>=20
    m={'independentTickerDays':n,'tp':tp,'executionAwarePrecisionPct':pct(tp,n),'wilsonLower90Pct':wilson(tp,n),'dayBlockBootstrapLower90Pct':day_boot(sel),'activeDays':len(days),'medianLeadFromOpenMin':round(statistics.median([r['leadFromOpenMin'] for r in sel if r['hitExecutable10']]),2) if any(r['hitExecutable10'] for r in sel) else None,'top3DailyPrecisionPct':pct(sum(r['hitExecutable10'] for r in top),len(top)),'medianRemainingUpsideFromEntryPct':round(statistics.median([r['remainingUpsideFromEntryPct'] for r in sel]),2) if sel else None,'medianOpenSlippagePct':round(statistics.median([r['openSlippagePct'] for r in sel]),2) if sel else None,'medianMaxAdverseExcursionPct':round(statistics.median([r['maxAdverseExcursionPct'] for r in sel]),2) if sel else None,'winnerDayRecallPct':pct(captured,winner_days),'minimumPredictionCoveragePct':coverage,'universeIntegrity':integrity,'adequateIndependentSupport':adequate,'realActionablePrecisionPct':pct(tp,n) if integrity and adequate else None}
    return {'schemaVersion':'5.17-execution-aware','generatedAtUTC':now.isoformat(),'status':'FORWARD_EVIDENCE_ACCUMULATING' if sets else 'NO_COMPLETED_FORWARD_PREDICTIONS','objective':'frozen 09:15 ET discovery that remains +10% actionable from first regular-session executable open','metrics':m,'realActionablePrecisionPct':m['realActionablePrecisionPct'],'antiLeakage':['reads only frozen v5.15 predictions','runs only after target session completion','does not alter predictions/model/config','execution entry is first regular-session open, never 09:15 indicative price','promotion remains blocked until >=100 selected ticker-days, >=20 active days and point-in-time universe integrity'],'errors':errors}

def self_test():
    fake=[]
    for d in range(20):
        for i in range(5):fake.append({'date':f'2026-01-{d+1:02d}','hitExecutable10':i<2})
    assert day_boot(fake) is not None and wilson(40,100)<40
    print('v5.17 execution-aware self-test: OK')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--self-test',action='store_true'); ap.add_argument('--dry-run',action='store_true'); a=ap.parse_args()
    if a.self_test:self_test(); return
    r=derive(); print(json.dumps(r,indent=2));
    if not a.dry_run:OUT.write_text(json.dumps(r,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
