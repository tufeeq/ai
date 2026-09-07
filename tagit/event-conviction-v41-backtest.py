#!/usr/bin/env python3
"""TAGit v4.1 frozen event-conviction policy backtest.

Purpose:
- Keep the validated v4 live21 ranker unchanged.
- Add ONLY causal policy features available at/before each observation:
  persistence, progression, continuation and snapshot market heat.
- Tune policy on Aug25-26 calibration only.
- Evaluate on untouched Aug27-Sep4 holdout.
- Measure both observation-level and FIRST-ALERT ticker/day precision.

Catalyst is intentionally excluded from this historical test because the frozen v3.9
file does not contain point-in-time catalyst fields. Live catalyst remains context-only
until forward evidence is mature.
"""
import hashlib,json,pathlib
from collections import defaultdict
from datetime import datetime,timezone
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier,HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json')
OUT=pathlib.Path('tag/data/tagit-v41-event-conviction-backtest.json')
EXPECTED='19277cfddc8dbeaebee73ce70a6e6fad57213caae87959da7f3e5e859a88773b'
BASE_GATE={'topK':20,'minEnsemble':.50,'maxDisagreement':.40}

r=json.loads(SRC.read_text());data=r['data'];sha=r['datasetSha256']
canon=json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False)
assert hashlib.sha256(canon.encode()).hexdigest()==sha==EXPECTED

def scode(s):
    s=str(s or '').lower();return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)
def clamp(x,lo=0.,hi=100.):return max(lo,min(hi,float(x)))
def vec(x):return list(x['base'])+list(x['sequence'][:6])+list(x['micro'][:4])

def fit_score(tr,te):
    X=np.asarray([vec(x) for x in tr],float);Xt=np.asarray([vec(x) for x in te],float)
    y=np.asarray([int(x['target']) for x in tr]);sc=StandardScaler().fit(X);Xs=sc.transform(X);Xts=sc.transform(Xt)
    pos=max(1,int(y.sum()));neg=max(1,len(y)-pos);w=np.where(y==1,min(80,neg/pos),1.0)
    hard=np.asarray([1.8 if (not x['target'] and (x['changeRank']>.7 or x['volumeRank']>.8)) else 1.0 for x in tr]);w*=hard
    et=ExtraTreesClassifier(n_estimators=420,max_depth=11,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=4101,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=15,learning_rate=.045,l2_regularization=4,min_samples_leaf=22,random_state=4102).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.25,random_state=4103).fit(Xs,y)
    a=et.predict_proba(Xt)[:,1];b=hg.predict_proba(Xt)[:,1];c=lr.predict_proba(Xts)[:,1]
    out=[None]*len(te);bys=defaultdict(list)
    for i,x in enumerate(te):bys[x['si']].append(i)
    for ids in bys.values():
        ra,rb,rc=rank01(a[ids]),rank01(b[ids]),rank01(c[ids]);ens=.42*ra+.38*rb+.20*rc;dis=np.std(np.vstack([ra,rb,rc]),axis=0);order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids[loc];out[i]={**te[i],'ensemble':float(ens[loc]),'disagreement':float(dis[loc]),'rank':rr}
    return out

def enrich(xs):
    # Snapshot heat uses only current/past derived features.
    bysi=defaultdict(list)
    for x in xs:bysi[x['si']].append(x)
    heat={}
    for si,a in bysi.items():
        if not a:continue
        pos5=np.mean([x['micro'][0]>0 for x in a]);pp=np.mean([x['sequence'][0]>0 for x in a]);pc=np.mean([x['sequence'][1]>0 for x in a]);pa=np.mean([x['sequence'][3]>0 for x in a])
        heat[si]=100*(.40*pos5+.25*pp+.20*pc+.15*pa)
    # State cache is causal within each ticker/day.
    state={};out=[]
    for x in sorted(xs,key=lambda z:(z['ts'],z['ticker'])):
        gate=x['rank']<=BASE_GATE['topK'] and x['ensemble']>=BASE_GATE['minEnsemble'] and x['disagreement']<=BASE_GATE['maxDisagreement']
        prog=sum((x['sequence'][0]>0,x['sequence'][1]>0,x['sequence'][3]>0,x['micro'][0]>0))>=2
        pc=state.get(x['key']) or {};same=bool(pc)
        streak=(int(pc.get('streak',0))+1) if same and gate else (1 if gate else 0)
        prev_rank=int(pc.get('rank',x['rank'])) if same else x['rank'];ri=max(-20,min(20,prev_rank-x['rank']))
        dis_pct=x['disagreement']*100
        persistence=(20 if gate else 0)+min(40,streak*12)+(22 if prog else 0)+(min(10,ri*2) if ri>0 else 0)+(8 if dis_pct<=18 else 0)
        persistence=clamp(persistence)
        m5=x['micro'][0]*10;m10=x['micro'][1]*10
        continuation=50+max(-22,min(22,m5*3))+max(-16,min(16,m10*1.6))+(14 if prog else 0)+(min(8,ri*1.5) if ri>0 else 0)
        continuation=clamp(continuation)
        z={**x,'gate':gate,'progression':prog,'streak':streak,'rankImprovement':ri,'persistence':persistence,'continuation':continuation,'marketHeat':float(heat.get(x['si'],0.0))}
        out.append(z);state[x['key']]={'streak':streak,'rank':x['rank']}
    return out

def metrics(alerts,univ):
    n=len(alerts);tp=sum(bool(x['target']) for x in alerts);den=sum(bool(x['target']) for x in univ)
    keys={x['key'] for x in alerts};wkeys={x['key'] for x in alerts if x['target']};allw={x['key'] for x in univ if x['target']}
    return {'count':n,'tp':tp,'precisionPct':round(100*tp/n,2) if n else None,'recallObsPct':round(100*tp/den,2) if den else None,'tickerDays':len(keys),'winnerTickerDays':len(wkeys),'recallTickerDayPct':round(100*len(wkeys)/len(allw),2) if allw else None}
def first_events(alerts):
    first={}
    for x in sorted(alerts,key=lambda z:(z['ts'],z['ticker'])):first.setdefault(x['key'],x)
    return list(first.values())

def apply_policy(xs,cfg):
    w=cfg['weights'];out=[]
    for x in xs:
        s=scode(x['session'])
        conv=clamp(w[0]*(x['ensemble']*100)+w[1]*x['persistence']+w[2]*x['continuation']+w[3]*x['marketHeat'])
        ok=False
        if s==0:
            ok=x['gate'] and conv>=cfg['preThr'] and x['marketHeat']>=cfg['minHeat']
        elif s==1:
            ok=x['gate'] and x['progression'] and x['persistence']>=cfg['regMinPersistence'] and conv>=cfg['regThr'] and x['marketHeat']>=cfg['minHeat']
        # after-hours remains informational only.
        if ok:out.append({**x,'eventConviction':conv})
    return out

train=[x for x in data if x['day']<='2026-08-24'];cal=[x for x in data if '2026-08-25'<=x['day']<='2026-08-26'];hold=[x for x in data if x['day']>='2026-08-27']
cp=enrich(fit_score(train,cal));hp=enrich(fit_score(train+cal,hold))

# v4 comparator: pre first selected gate; regular selected + progression; after informational.
def base_v4(xs):
    return [x for x in xs if (scode(x['session'])==0 and x['gate']) or (scode(x['session'])==1 and x['gate'] and x['progression'])]

blends=[(.55,.25,.20,0),(.50,.25,.15,.10),(.45,.30,.15,.10),(.50,.20,.20,.10),(.45,.25,.20,.10)]
cands=[]
for weights in blends:
  for pre in (55,60,65,70,75):
   for reg in (55,60,65,70,75):
    for rp in (30,40,50,60):
     for mh in (0,35,45,55):
      cfg={'weights':weights,'preThr':pre,'regThr':reg,'regMinPersistence':rp,'minHeat':mh}
      a=apply_policy(cp,cfg);ev=first_events(a);m=metrics(ev,cp)
      p=m['precisionPct'] or 0;rec=m['recallTickerDayPct'] or 0;support=min(1,m['count']/12)*min(1,m['tp']/4)
      utility=p*support+rec*.20+m['tp']*2.0
      cands.append((utility,cfg,m,metrics(a,cp)))
best=max(cands,key=lambda z:z[0]);cfg=best[1]
ha=apply_policy(hp,cfg);he=first_events(ha)
base_cal=base_v4(cp);base_hold=base_v4(hp)

def by_session(xs,univ):
    d={}
    for code,name in ((0,'pre'),(1,'regular'),(2,'after')):
        u=[x for x in univ if scode(x['session'])==code];a=[x for x in xs if scode(x['session'])==code]
        d[name]={'observation':metrics(a,u),'firstEvent':metrics(first_events(a),u)}
    return d

report={
 'schemaVersion':'4.1-research','method':'TAGIT_V41_FROZEN_EVENT_CONVICTION_POLICY','generatedAtUTC':datetime.now(timezone.utc).isoformat(),
 'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE','datasetSha256':sha,
 'antiLeakage':['frozen v3.9 dataset only; no network calls','Aug11-24 train; Aug25-26 policy calibration; Aug27-Sep4 untouched holdout','market heat uses same-snapshot causal features only','persistence/rank-improvement use prior observations of same ticker/day only','catalyst excluded because frozen dataset has no point-in-time catalyst fields'],
 'coverage':{'rows':len(data),'train':len(train),'calibration':len(cal),'holdout':len(hold),'holdoutPositives':sum(bool(x['target']) for x in hold)},
 'baseGate':BASE_GATE,
 'selectedPolicy':cfg,
 'calibration':{'v4Observation':metrics(base_cal,cp),'v4FirstEvent':metrics(first_events(base_cal),cp),'v41Observation':best[3],'v41FirstEvent':best[2]},
 'holdout':{'v4Observation':metrics(base_hold,hp),'v4FirstEvent':metrics(first_events(base_hold),hp),'v41Observation':metrics(ha,hp),'v41FirstEvent':metrics(he,hp)},
 'holdoutBySession':by_session(ha,hp),
 'promotionRule':{'requiresFirstEventPrecisionImprovement':True,'requiresSupportAtLeast':12,'requiresWinnerEventsAtLeast':4,'autoPromotion':False},
 'verdict':None
}
v4p=report['holdout']['v4FirstEvent']['precisionPct'] or 0;v41p=report['holdout']['v41FirstEvent']['precisionPct'] or 0
vm=report['holdout']['v41FirstEvent'];report['verdict']='V41_POLICY_SHADOW_CANDIDATE' if v41p>v4p and vm['count']>=12 and vm['tp']>=4 else 'DO_NOT_PROMOTE_V41_POLICY'
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
