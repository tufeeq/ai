#!/usr/bin/env python3
import json, math, pathlib, subprocess
from datetime import datetime, timezone
ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'tag'/'data'; AUDIT=DATA/'tagit-top50-audit.json'; OUT=DATA/'tagit-root-cause-v10.json'

def load(p,d=None):
    try:return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    except:return {} if d is None else d

def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT,text=True,stderr=subprocess.DEVNULL)
def show(sha):
    try:return json.loads(git('show',f'{sha}:tag/data/live-quotes.json'))
    except:return None

def num(v):
    try:
        if v is None:return None
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip()); return x if math.isfinite(x) else None
    except:return None

def sym(r):return str((r or {}).get('ticker') or (r or {}).get('Ticker') or (r or {}).get('symbol') or '').upper().strip()
def qget(q,*keys):
    for k in keys:
        v=num((q or {}).get(k))
        if v is not None:return v
    return None

def main():
    a=load(AUDIT,{}); top=a.get('top50') or []; b=(a.get('benchmark') or {}).get('timestampUTC')
    if not top or not b: raise SystemExit('audit unavailable')
    day=b[:10]; commits=git('log','--format=%H',f'--since={day}T00:00:00Z',f'--until={b}','--','tag/data/live-quotes.json').splitlines()
    timeline={str(x.get('symbol','')).upper():[] for x in top if x.get('symbol')}
    gaps=[]; prevts=None
    for sha in reversed(commits):
        s=show(sha)
        if not s:continue
        ts=s.get('updatedAtUTC')
        if prevts and ts:
            try:
                from datetime import datetime as D
                gap=(D.fromisoformat(ts.replace('Z','+00:00'))-D.fromisoformat(prevts.replace('Z','+00:00'))).total_seconds()/60
                if gap>8:gaps.append({'from':prevts,'to':ts,'gapMin':round(gap,1)})
            except:pass
        prevts=ts or prevts
        qs=s.get('quotes') or {}; iterable=qs.items() if isinstance(qs,dict) else [(sym(q),q) for q in qs]
        by={str(t).upper():q for t,q in iterable}
        early={sym(r) for r in s.get('earlyCandidates') or []}; emerg={sym(r) for r in s.get('emergingCandidates') or []}; accum={sym(r) for r in s.get('accumulationCandidates') or []}
        for t in timeline:
            q=by.get(t)
            if q is None:continue
            timeline[t].append({'ts':ts,'changePct':qget(q,'changePct'),'acc5':qget(q,'acceleration5m','volumeAcceleration5m','volume5mRatio','acc5'),'acc15':qget(q,'acceleration15m','volumeAcceleration15m','volume15mRatio','acc15'),'relativeVolume':qget(q,'relativeVolume','relVolume','Rel Volume'),'turnover15mPct':qget(q,'turnover15mPct','turn15','floatTurnover15mPct'),'range15mPct':qget(q,'range15mPct','range15'),'buyVolumePct':qget(q,'buyVolumePct','buyPct'),'technicalScore':qget(q,'technicalScore'),'detected':t in early or t in emerg or t in accum})
    detected={str(x.get('symbol','')).upper():x for x in a.get('detectedTop50') or []}
    cases=[]; counts={}
    for item in top:
        t=str(item.get('symbol','')).upper(); hist=timeline.get(t,[]); d=detected.get(t)
        if d:
            first=num(d.get('firstDetectedChangePct'))
            cause='CAPTURED_EARLY' if first is not None and first<10 else 'THRESHOLD_TOO_LATE'
        elif not hist:cause='UNIVERSE_MISS'
        else:
            pre=[x for x in hist if x.get('changePct') is not None and x['changePct']<10]
            if not pre:cause='DISCOVERED_AFTER_BREAKOUT_ONLY'
            else:
                strong=[x for x in pre if (x.get('acc5') or 0)>=1.5 or (x.get('relativeVolume') or 0)>=1.8 or (x.get('turnover15mPct') or 0)>=0.5]
                compressed=[x for x in pre if x.get('range15mPct') is not None and x['range15mPct']<=4.5]
                if strong and compressed:cause='SIGNAL_GATE_MISS'
                elif strong:cause='PRICE_COMPRESSION_RULE_MISS'
                else:cause='WEAK_PRECURSOR_IN_AVAILABLE_FEATURES'
        counts[cause]=counts.get(cause,0)+1
        pre=[x for x in hist if x.get('changePct') is not None and x['changePct']<10]
        best=max(pre,key=lambda x:((x.get('acc5') or 0)+(x.get('relativeVolume') or 0)+(x.get('turnover15mPct') or 0)),default=None)
        remedy={'UNIVERSE_MISS':'expand unusual-volume/most-active discovery reserve before price expansion','THRESHOLD_TOO_LATE':'penalize late changePct and promote earlier volume/compression evidence','SIGNAL_GATE_MISS':'relax hard gates; use learned probability score with candidate cap','PRICE_COMPRESSION_RULE_MISS':'make compression a soft feature, not a mandatory gate','WEAK_PRECURSOR_IN_AVAILABLE_FEATURES':'add catalyst/order-flow/context features; do not force a false early signal','DISCOVERED_AFTER_BREAKOUT_ONLY':'improve upstream universe refresh cadence and pre-breakout discovery','CAPTURED_EARLY':'retain as positive training exemplar'}[cause]
        cases.append({'rank':item.get('rank'),'symbol':t,'benchmarkChangePct':item.get('benchmarkChangePct'),'cause':cause,'firstDetectedChangePct':d.get('firstDetectedChangePct') if d else None,'bestPre10Snapshot':best,'remedy':remedy})
    out={'schemaVersion':10,'generatedAtUTC':datetime.now(timezone.utc).isoformat(),'benchmarkTimestampUTC':b,'snapshotCount':len(commits),'feedGapsOver8Min':gaps,'causeCounts':counts,'cases':cases,'trainingUse':'Use causes as diagnostics and labels only. Never feed future benchmark rank/change into live features.'}
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); print(json.dumps({'causeCounts':counts,'feedGaps':len(gaps)},indent=2))
if __name__=='__main__':main()
