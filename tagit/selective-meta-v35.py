#!/usr/bin/env python3
"""TAGit v3.5 selective meta-filter for high-confidence ALERT.

RADAR is intentionally unchanged. This layer trains only on clear examples:
  positive = +10% MFE with no worse than -4% MAE over the next 60m
  negative = <+5% MFE
Ambiguous/volatile outcomes are excluded from meta training (ABSTAIN territory).
Session experts are blended with a global expert. Research-only.
"""
import json, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

OUT=pathlib.Path('tag/data/tagit-v35-selective-meta.json')
g=runpy.run_path('tagit/month-groundtruth-v34.py')
data=g['data'];scode=g['scode']

def feat(x):return np.asarray(x['base']+x['sequence']+x['micro'],float)
def clean(x):return bool(x['mfeGT']>=10 and x['maeGT']>=-4)
def clearneg(x):return bool(x['mfeGT']<5)
def general(x):return bool(x['mfeGT']>=10)
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)

def train_model(rows,seed):
    r=[x for x in rows if clean(x) or clearneg(x)]
    if len(r)<80 or sum(clean(x) for x in r)<5:return None
    X=np.asarray([feat(x) for x in r]);y=np.asarray([int(clean(x)) for x in r]);sc=StandardScaler().fit(X);Xs=sc.transform(X);pos=max(1,y.sum());neg=max(1,len(y)-pos);w=np.where(y==1,min(60,neg/pos),1.0)
    # hardest false positives: strong MFE but below actionable boundary get more negative weight.
    for i,x in enumerate(r):
        if not y[i] and x['mfeGT']>=3:w[i]*=1.7
    et=ExtraTreesClassifier(n_estimators=420,max_depth=10,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=seed,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=15,learning_rate=.045,l2_regularization=4,min_samples_leaf=20,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.22,random_state=seed+2).fit(Xs,y)
    return sc,et,hg,lr

def pred(m,rows):
    if m is None:return np.zeros(len(rows)),np.zeros(len(rows)),np.zeros(len(rows))
    sc,et,hg,lr=m;X=np.asarray([feat(x) for x in rows]);return et.predict_proba(X)[:,1],hg.predict_proba(X)[:,1],lr.predict_proba(sc.transform(X))[:,1]

def fit_score(train,test):
    global_m=train_model(train,3500)
    session_m={s:train_model([x for x in train if scode(x['session'])==s],3510+s*10) for s in (0,1,2)}
    ga,gb,gc=pred(global_m,test);sa=np.zeros(len(test));sb=np.zeros(len(test));scv=np.zeros(len(test));has=np.zeros(len(test))
    for s in (0,1,2):
        ids=[i for i,x in enumerate(test) if scode(x['session'])==s]
        if not ids or session_m[s] is None:continue
        aa,bb,cc=pred(session_m[s],[test[i] for i in ids]);has[ids]=1
        for j,i in enumerate(ids):sa[i]=aa[j];sb[i]=bb[j];scv[i]=cc[j]
    out=[None]*len(test);bys=defaultdict(list)
    for i,x in enumerate(test):bys[x['si']].append(i)
    for ids in bys.values():
        # rank each global model within current snapshot; session expert contributes when trained.
        rg=[rank01(ga[ids]),rank01(gb[ids]),rank01(gc[ids])];gs=.38*rg[0]+.37*rg[1]+.25*rg[2]
        sr=[]
        for arr in (sa,sb,scv):sr.append(rank01(arr[ids]))
        ss=.4*sr[0]+.35*sr[1]+.25*sr[2]
        h=has[ids];ens=gs*(1-.28*h)+ss*(.28*h)
        dis=np.std(np.vstack(rg),axis=0);votes=(rg[0]>=.8).astype(int)+(rg[1]>=.8).astype(int)+(rg[2]>=.8).astype(int)
        order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids[loc];out[i]={**test[i],'meta':float(ens[loc]),'disagreement':float(dis[loc]),'votes':int(votes[loc]),'rank':rr,'sessionExpert':bool(has[i])}
    return out

def stat(xs,univ):
    n=len(xs);tp=sum(general(x) for x in xs);ctp=sum(clean(x) for x in xs);den=sum(general(x) for x in univ);cden=sum(clean(x) for x in univ)
    return {'count':n,'tp10':tp,'precision10Pct':round(tp/n*100,2) if n else None,'recall10Pct':round(tp/den*100,2) if den else None,'cleanTP':ctp,'cleanPrecisionPct':round(ctp/n*100,2) if n else None,'cleanRecallPct':round(ctp/cden*100,2) if cden else None,'tickerDays':len(set(x['key'] for x in xs))}
def apply(xs,c):
    k,m,d,v=c;return [x for x in xs if x['rank']<=k and x['meta']>=m and x['disagreement']<=d and x['votes']>=v]
def select(cp):
    z=[]
    for k in (1,2,3,5,8,10):
        for m in (.55,.65,.75,.82,.90):
            for d in (.10,.18,.28,.40):
                for v in (1,2,3):
                    s=stat(apply(cp,(k,m,d,v)),cp);p=s['precision10Pct'] or 0;cpct=s['cleanPrecisionPct'] or 0;support=min(1,s['count']/20)*min(1,s['tp10']/5);utility=(.65*p+.35*cpct)*support+s['tp10']*1.5+s['cleanTP']
                    z.append(((k,m,d,v),s,utility))
    return max(z,key=lambda x:x[2])

train=[x for x in data if x['day']<='2026-08-24'];cal=[x for x in data if '2026-08-25'<=x['day']<='2026-08-26'];hold=[x for x in data if x['day']>='2026-08-27']
cp=fit_score(train,cal);hp=fit_score(train+cal,hold);cfg,cs,_=select(cp);hs=stat(apply(hp,cfg),hp)
front=[]
for k in (1,2,3,5,10):front.append({'topK':k,'holdout':stat([x for x in hp if x['rank']<=k and x['votes']>=2],hp)})
by_session={}
for s,name in ((0,'pre'),(1,'regular'),(2,'after')):
    u=[x for x in hp if scode(x['session'])==s];by_session[name]={'universe':stat(u,u),'alert':stat(apply(u,cfg),u) if u else stat([],[])}
report={'schemaVersion':1,'method':'TAGIT_V35_SELECTIVE_CLEAN_EXPLOSION_META','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
'labelPolicy':{'positiveTraining':'MFE>=10 and MAE>=-4','negativeTraining':'MFE<5','ambiguous':'excluded from meta training / ABSTAIN','evaluationPrimary':'all MFE>=10 winners'},
'coverage':{'rows':len(data),'train':len(train),'calibration':len(cal),'holdout':len(hold),'trainGeneralPos':sum(general(x) for x in train),'trainCleanPos':sum(clean(x) for x in train),'holdoutGeneralPos':sum(general(x) for x in hold),'holdoutCleanPos':sum(clean(x) for x in hold)},
'antiLeakage':['inherits v3.4 fully-closed-bar ground truth contract','meta models train only on prior dates','ambiguous outcomes excluded only from training, never hidden in evaluation','thresholds selected on Aug25-26 only'],
'selectedConfig':{'topK':cfg[0],'minMeta':cfg[1],'maxDisagreement':cfg[2],'minVotes':cfg[3]},'calibration':cs,'holdout':hs,'holdoutFrontier':front,'holdoutBySession':by_session}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
