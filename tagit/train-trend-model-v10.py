#!/usr/bin/env python3
import hashlib, json, math, pathlib, random, statistics, subprocess
from datetime import datetime, timezone
ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'tag'/'data'; AUDIT=DATA/'tagit-top50-audit.json'; MODEL=DATA/'tagit-trend-model-v10.json'; REPORT=DATA/'tagit-training-report-v10.json'
BASE=['acc5','acc15','relativeVolume','turnover15mPct','range15mPct','range30mPct','buyVolumePct','technicalScore','priceVelocity5mPct','priceVelocity15mPct','changePct','sessionVolumeLog']
FEATURES=BASE+['pressureCompression','turnoverCompression','quietPressure','trendAlignment']

def load(p,d=None):
    try:return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    except:return {} if d is None else d

def num(v):
    try:
        if v is None:return None
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip()); return x if math.isfinite(x) else None
    except:return None

def sym(r):return str((r or {}).get('ticker') or (r or {}).get('Ticker') or (r or {}).get('symbol') or '').upper().strip()
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT,text=True,stderr=subprocess.DEVNULL)
def show(sha,path):
    try:return json.loads(git('show',f'{sha}:{path}'))
    except:return None

def raw(q,k):
    aliases={'acc5':['acceleration5m','volumeAcceleration5m','volume5mRatio','acc5'],'acc15':['acceleration15m','volumeAcceleration15m','volume15mRatio','acc15'],'relativeVolume':['relativeVolume','relVolume','Rel Volume'],'turnover15mPct':['turnover15mPct','turn15','floatTurnover15mPct'],'range15mPct':['range15mPct','range15'],'range30mPct':['range30mPct','range30'],'buyVolumePct':['buyVolumePct','buyPct'],'technicalScore':['technicalScore'],'priceVelocity5mPct':['priceVelocity5mPct','v5'],'priceVelocity15mPct':['priceVelocity15mPct','v15'],'changePct':['changePct'],'sessionVolumeLog':['sessionVolume','volume']}
    for a in aliases.get(k,[k]):
        v=num((q or {}).get(a))
        if v is not None:return math.log1p(max(v,0)) if k=='sessionVolumeLog' else v
    return None

def fget(q,k):
    if k in BASE:return raw(q,k)
    a5=raw(q,'acc5') or 0; a15=raw(q,'acc15') or 0; rv=raw(q,'relativeVolume') or 0; turn=raw(q,'turnover15mPct') or 0; rg=raw(q,'range15mPct'); v5=raw(q,'priceVelocity5mPct'); tech=raw(q,'technicalScore'); buy=raw(q,'buyVolumePct')
    rg=rg if rg is not None else 6.0
    if k=='pressureCompression':return (max(a5-1,0)+.7*max(a15-1,0)+.55*max(rv-1,0))/(1+max(rg,0))
    if k=='turnoverCompression':return max(turn,0)/(1+max(rg,0))
    if k=='quietPressure':return (max(a5,0)+.7*max(a15,0)+.4*max(rv,0))*max(0,1-min(abs(v5 or 0)/2.5,1))
    if k=='trendAlignment':return ((tech or 50)/100.0)*((buy or 50)/100.0)
    return None

def eligible(q):
    ch=fget(q,'changePct'); age=num(q.get('quoteAgeMin'))
    return ch is not None and -5<=ch<10 and (age is None or age<=4)
def build_examples():
    audit=load(AUDIT,{}); top={str(x.get('symbol','')).upper() for x in audit.get('top50',[]) if x.get('symbol')}
    if not top:raise SystemExit('Top-50 audit unavailable')
    until=(audit.get('benchmark') or {}).get('timestampUTC') or datetime.now(timezone.utc).isoformat(); day=until[:10]
    commits=git('log','--format=%H',f'--since={day}T00:00:00Z',f'--until={until}','--','tag/data/live-quotes.json').splitlines(); rows=[]; snaps=0
    for sha in reversed(commits):
        s=show(sha,'tag/data/live-quotes.json')
        if not s:continue
        snaps+=1; qs=s.get('quotes') or {}; iterable=qs.items() if isinstance(qs,dict) else [(sym(q),q) for q in qs]
        for t,q in iterable:
            t=str(t).upper(); q=q or {}
            if not t or not eligible(q):continue
            vals={k:fget(q,k) for k in FEATURES}
            if sum(v is not None for v in vals.values())<8:continue
            rows.append({'symbol':t,'y':1 if t in top else 0,'x':vals,'ts':s.get('updatedAtUTC')})
    return rows,snaps
def split_symbol(t):return int(hashlib.sha1(t.encode()).hexdigest()[:8],16)%5==0
def stats(rows):
    out={}
    for k in FEATURES:
        vals=[r['x'][k] for r in rows if r['x'][k] is not None]; med=statistics.median(vals) if vals else 0.0; mad=statistics.median([abs(v-med) for v in vals]) if vals else 1.0
        out[k]={'median':med,'scale':max(mad*1.4826,0.05)}
    return out
def z(v,s):return 0.0 if v is None else max(-4,min(4,(v-s['median'])/s['scale']))
def sigmoid(x):return 1.0 if x>=30 else 0.0 if x<=-30 else 1/(1+math.exp(-x))
def metrics(rows,w,st,bias,th):
    by={}
    for r in rows:
        p=sigmoid(bias+sum(w[k]*z(r['x'][k],st[k]) for k in FEATURES)); old=by.get(r['symbol'])
        if old is None or p>old['p']:by[r['symbol']]={'p':p,'y':r['y']}
    pred={t for t,a in by.items() if a['p']>=th}; pos={t for t,a in by.items() if a['y']==1}; tp=len(pred&pos); fp=len(pred-pos); fn=len(pos-pred)
    rec=tp/(tp+fn) if tp+fn else 0; prec=tp/(tp+fp) if tp+fp else 0; f1=2*rec*prec/(rec+prec) if rec+prec else 0
    return {'symbols':len(by),'positives':len(pos),'selected':len(pred),'tp':tp,'recall':rec,'precision':prec,'f1':f1,'liftVsBase':prec/(len(pos)/len(by)) if by and pos else None}
def objective(m):
    recall_floor_penalty=max(0,.60-m['recall'])*1.8
    return .46*m['recall']+.43*m['precision']+.11*m['f1']-recall_floor_penalty-.0025*max(0,m['selected']-30)
def main():
    rows,snaps=build_examples(); train=[r for r in rows if not split_symbol(r['symbol'])]; val=[r for r in rows if split_symbol(r['symbol'])]
    if len(rows)<100 or not val:raise SystemExit(f'insufficient PIT rows: {len(rows)}')
    st=stats(train); rnd=random.Random(9102602)
    pri={'acc5':.45,'acc15':.45,'relativeVolume':.4,'turnover15mPct':.55,'range15mPct':-.55,'range30mPct':-.15,'buyVolumePct':.3,'technicalScore':.4,'priceVelocity5mPct':-.1,'priceVelocity15mPct':-.05,'changePct':-.25,'sessionVolumeLog':.2,'pressureCompression':.9,'turnoverCompression':.8,'quietPressure':.7,'trendAlignment':.45}
    cand=[]
    for _ in range(6000):
        w={k:pri[k]+rnd.gauss(0,.38) for k in FEATURES}; w['range15mPct']=-abs(w['range15mPct']); w['changePct']=-abs(w['changePct']); bias=rnd.uniform(-1.8,.4); th=rnd.uniform(.58,.90)
        mt=metrics(train,w,st,bias,th); mv=metrics(val,w,st,bias,th); obj=.30*objective(mt)+.70*objective(mv); cand.append((obj,w,bias,th,mt,mv))
    cand.sort(key=lambda x:x[0],reverse=True); _,w,bias,th,mt,mv=cand[0]
    model={'schemaVersion':10,'modelType':'SIMULATED_PIT_NONLINEAR_TREND_ENSEMBLE','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'trainingScope':'same-session PIT simulation; future Top-50 outcome is label only','features':FEATURES,'normalization':st,'weights':{k:round(v,6) for k,v in w.items()},'bias':round(bias,6),'threshold':round(th,6),'candidateCap':30,'guardrails':{'changePctMin':-5,'changePctMaxExclusive':10,'maxQuoteAgeMin':4,'noFutureFeatures':True},'validation':{'train':mt,'symbolHoldout':mv},'snapshotsUsed':snaps,'examples':len(rows),'uniqueSymbols':len({r['symbol'] for r in rows})}
    report={'schemaVersion':10,'generatedAtUTC':model['generatedAtUTC'],'status':'SIMULATED_NOT_PRODUCTION_PROOF','model':model,'interpretation':{'primaryGoal':'early discovery with higher precision using volume-pressure/compression interactions','holdoutIsSameSession':True,'warning':'Same-session symbol holdout is simulation, not future-session proof. Promote only after forward validation.'},'topWeights':sorted(model['weights'].items(),key=lambda kv:abs(kv[1]),reverse=True)}
    MODEL.write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'examples':len(rows),'snapshots':snaps,'train':mt,'holdout':mv,'threshold':th,'topWeights':report['topWeights'][:8]},indent=2))
if __name__=='__main__':main()
