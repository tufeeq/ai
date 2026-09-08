#!/usr/bin/env python3
import hashlib, json, math, pathlib, random, statistics, subprocess
from datetime import datetime, timezone

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'tag'/'data'
AUDIT=DATA/'tagit-top50-audit.json'
MODEL=DATA/'tagit-trend-model-v10.json'
REPORT=DATA/'tagit-training-report-v10.json'
FEATURES=['acc5','acc15','relativeVolume','turnover15mPct','range15mPct','range30mPct','buyVolumePct','technicalScore','priceVelocity5mPct','priceVelocity15mPct','changePct','sessionVolumeLog']


def load(p,d=None):
    try:return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    except Exception:return {} if d is None else d

def num(v):
    try:
        if v is None:return None
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip())
        return x if math.isfinite(x) else None
    except:return None

def sym(r):return str((r or {}).get('ticker') or (r or {}).get('Ticker') or (r or {}).get('symbol') or '').upper().strip()
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT,text=True,stderr=subprocess.DEVNULL)
def show(sha,path):
    try:return json.loads(git('show',f'{sha}:{path}'))
    except:return None

def fget(q,k):
    aliases={
      'acc5':['acceleration5m','volumeAcceleration5m','volume5mRatio','acc5'],
      'acc15':['acceleration15m','volumeAcceleration15m','volume15mRatio','acc15'],
      'relativeVolume':['relativeVolume','relVolume','Rel Volume'],
      'turnover15mPct':['turnover15mPct','turn15','floatTurnover15mPct'],
      'range15mPct':['range15mPct','range15'], 'range30mPct':['range30mPct','range30'],
      'buyVolumePct':['buyVolumePct','buyPct'], 'technicalScore':['technicalScore'],
      'priceVelocity5mPct':['priceVelocity5mPct','v5'], 'priceVelocity15mPct':['priceVelocity15mPct','v15'],
      'changePct':['changePct'], 'sessionVolumeLog':['sessionVolume','volume']}
    for a in aliases[k]:
        v=num((q or {}).get(a))
        if v is not None:return math.log1p(max(v,0)) if k=='sessionVolumeLog' else v
    return None

def eligible(q):
    ch=fget(q,'changePct'); age=num(q.get('quoteAgeMin'))
    return ch is not None and -5<=ch<10 and (age is None or age<=4)

def build_examples():
    audit=load(AUDIT,{})
    top={str(x.get('symbol','')).upper() for x in audit.get('top50',[]) if x.get('symbol')}
    if not top: raise SystemExit('Top-50 audit unavailable')
    bts=(audit.get('benchmark') or {}).get('timestampUTC')
    until=bts or datetime.now(timezone.utc).isoformat()
    day=until[:10]
    commits=git('log','--format=%H',f'--since={day}T00:00:00Z',f'--until={until}','--','tag/data/live-quotes.json').splitlines()
    rows=[]; snapshots=0
    for sha in reversed(commits):
        s=show(sha,'tag/data/live-quotes.json')
        if not s:continue
        snapshots+=1
        qs=s.get('quotes') or {}
        iterable=qs.items() if isinstance(qs,dict) else [(sym(q),q) for q in qs]
        for t,q in iterable:
            t=str(t).upper(); q=q or {}
            if not t or not eligible(q):continue
            vals={k:fget(q,k) for k in FEATURES}
            if sum(v is not None for v in vals.values())<5:continue
            rows.append({'symbol':t,'y':1 if t in top else 0,'x':vals,'ts':s.get('updatedAtUTC')})
    return rows,snapshots,top

def split_symbol(t):return int(hashlib.sha1(t.encode()).hexdigest()[:8],16)%5==0

def stats(rows):
    out={}
    for k in FEATURES:
        vals=[r['x'][k] for r in rows if r['x'][k] is not None]
        med=statistics.median(vals) if vals else 0.0
        mad=statistics.median([abs(v-med) for v in vals]) if vals else 1.0
        out[k]={'median':med,'scale':max(mad*1.4826,0.05)}
    return out

def z(v,s):return 0.0 if v is None else max(-4,min(4,(v-s['median'])/s['scale']))
def score(r,w,st,bias):return bias+sum(w[k]*z(r['x'][k],st[k]) for k in FEATURES)
def sigmoid(x):
    if x>=30:return 1.0
    if x<=-30:return 0.0
    return 1/(1+math.exp(-x))
def metrics(rows,w,st,bias,threshold):
    by={}
    for r in rows:
        p=sigmoid(score(r,w,st,bias)); t=r['symbol']
        old=by.get(t)
        if old is None or p>old['p']:by[t]={'p':p,'y':r['y']}
    pred={t for t,a in by.items() if a['p']>=threshold}; pos={t for t,a in by.items() if a['y']==1}
    tp=len(pred&pos); fp=len(pred-pos); fn=len(pos-pred)
    rec=tp/(tp+fn) if tp+fn else 0; prec=tp/(tp+fp) if tp+fp else 0
    f2=(5*prec*rec/(4*prec+rec)) if (4*prec+rec)>0 else 0
    return {'symbols':len(by),'positives':len(pos),'selected':len(pred),'tp':tp,'recall':rec,'precision':prec,'f2':f2}
def objective(m):return 0.58*m['recall']+0.32*m['precision']+0.10*m['f2']-0.0015*max(0,m['selected']-45)

def main():
    rows,snapshots,top=build_examples()
    train=[r for r in rows if not split_symbol(r['symbol'])]; val=[r for r in rows if split_symbol(r['symbol'])]
    if len(rows)<100 or not val: raise SystemExit(f'insufficient PIT rows: {len(rows)}')
    st=stats(train); rnd=random.Random(91026)
    priors={'acc5':.9,'acc15':.65,'relativeVolume':.75,'turnover15mPct':.5,'range15mPct':-.85,'range30mPct':-.35,'buyVolumePct':.45,'technicalScore':.35,'priceVelocity5mPct':.10,'priceVelocity15mPct':.05,'changePct':-.30,'sessionVolumeLog':.12}
    candidates=[]
    for i in range(2500):
        w={k:priors[k]+rnd.gauss(0,.42) for k in FEATURES}
        # Preserve the intended pre-breakout causal direction for compression and lateness.
        w['range15mPct']=-abs(w['range15mPct']); w['changePct']=-abs(w['changePct'])
        bias=rnd.uniform(-1.5,.2); th=rnd.uniform(.52,.84)
        mt=metrics(train,w,st,bias,th); mv=metrics(val,w,st,bias,th)
        obj=.35*objective(mt)+.65*objective(mv)
        candidates.append((obj,w,bias,th,mt,mv))
    candidates.sort(key=lambda x:x[0],reverse=True)
    best=candidates[0]; obj,w,bias,th,mt,mv=best
    # conservative threshold floor avoids turning the live feed into a firehose
    th=max(th,.58)
    mv=metrics(val,w,st,bias,th); mt=metrics(train,w,st,bias,th)
    model={'schemaVersion':10,'modelType':'SIMULATED_PIT_LINEAR_ENSEMBLE','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'trainingScope':'same-session point-in-time simulation; final Top-50 used only as label','features':FEATURES,'normalization':st,'weights':{k:round(v,6) for k,v in w.items()},'bias':round(bias,6),'threshold':round(th,6),'candidateCap':40,'guardrails':{'changePctMin':-5,'changePctMaxExclusive':10,'maxQuoteAgeMin':4,'noFutureFeatures':True},'validation':{'train':mt,'symbolHoldout':mv},'snapshotsUsed':snapshots,'examples':len(rows),'uniqueSymbols':len({r['symbol'] for r in rows})}
    report={'schemaVersion':10,'generatedAtUTC':model['generatedAtUTC'],'status':'SIMULATED_NOT_PRODUCTION_PROOF','model':model,'interpretation':{'primaryGoal':'maximize early Top-50 recall while controlling false positives','holdoutIsSameSession':True,'warning':'This simulation can tune TAGit, but cannot establish future-session accuracy. Forward sessions are required.'},'topWeights':sorted(model['weights'].items(),key=lambda kv:abs(kv[1]),reverse=True)}
    MODEL.write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'examples':len(rows),'snapshots':snapshots,'train':mt,'holdout':mv,'threshold':th,'topWeights':report['topWeights'][:6]},indent=2))
if __name__=='__main__':main()
