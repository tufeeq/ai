#!/usr/bin/env python3
"""TAGit v3.7 session-calibrated selective experts.

Each market session calibrates its own global/session-expert blend and ALERT gate
using Aug25-26 only. Holdout remains Aug27-Sep4. Research-only.
"""
import json, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

OUT=pathlib.Path('tag/data/tagit-v37-session-experts.json')
g=runpy.run_path('tagit/month-groundtruth-v34.py')
data=g['data']; scode=g['scode']


def feat(x): return np.asarray(x['base']+x['sequence']+x['micro'],float)
def clean(x): return bool(x['mfeGT']>=10 and x['maeGT']>=-4)
def neg(x): return bool(x['mfeGT']<5)
def win(x): return bool(x['mfeGT']>=10)
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)


def train_model(rows,seed):
    r=[x for x in rows if clean(x) or neg(x)]
    if len(r)<70 or sum(clean(x) for x in r)<5:return None
    X=np.asarray([feat(x) for x in r]); y=np.asarray([int(clean(x)) for x in r])
    sc=StandardScaler().fit(X); Xs=sc.transform(X)
    pos=max(1,int(y.sum())); negn=max(1,len(y)-pos)
    w=np.where(y==1,min(70,negn/pos),1.0)
    for i,x in enumerate(r):
        if not y[i] and x['mfeGT']>=3:w[i]*=1.8
    et=ExtraTreesClassifier(n_estimators=420,max_depth=10,min_samples_leaf=6,max_features=.82,class_weight='balanced_subsample',random_state=seed,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=240,max_leaf_nodes=15,learning_rate=.04,l2_regularization=5,min_samples_leaf=18,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=600,class_weight='balanced',C=.20,random_state=seed+2).fit(Xs,y)
    return sc,et,hg,lr


def pred(m,rows):
    if m is None:return None
    sc,et,hg,lr=m; X=np.asarray([feat(x) for x in rows])
    return [et.predict_proba(X)[:,1],hg.predict_proba(X)[:,1],lr.predict_proba(sc.transform(X))[:,1]]


def raw_scores(train,test):
    gm=train_model(train,3700)
    sm={s:train_model([x for x in train if scode(x['session'])==s],3710+s*10) for s in (0,1,2)}
    gp=pred(gm,test); sp={}
    for s in (0,1,2):
        ids=[i for i,x in enumerate(test) if scode(x['session'])==s]
        if ids and sm[s] is not None:sp[s]=(ids,pred(sm[s],[test[i] for i in ids]))
    sess_arrays={s:[np.zeros(len(test)) for _ in range(3)] for s in (0,1,2)}
    has=np.zeros(len(test),dtype=bool)
    for s,(ids,pp) in sp.items():
        has[ids]=True
        for j in range(3):sess_arrays[s][j][ids]=pp[j]
    out=[None]*len(test); bysnap=defaultdict(list)
    for i,x in enumerate(test):bysnap[x['si']].append(i)
    for ids in bysnap.values():
        rg=[rank01(gp[j][ids]) for j in range(3)]
        gs=.38*rg[0]+.37*rg[1]+.25*rg[2]
        gd=np.std(np.vstack(rg),axis=0)
        gv=(rg[0]>=.8).astype(int)+(rg[1]>=.8).astype(int)+(rg[2]>=.8).astype(int)
        for loc,i in enumerate(ids):
            s=scode(test[i]['session'])
            if has[i]:
                rs=[rank01(sess_arrays[s][j][ids]) for j in range(3)]
                ss=.40*rs[0]+.35*rs[1]+.25*rs[2]
                sd=np.std(np.vstack(rs),axis=0)
                sv=(rs[0]>=.8).astype(int)+(rs[1]>=.8).astype(int)+(rs[2]>=.8).astype(int)
                out[i]={**test[i],'gscore':float(gs[loc]),'gdis':float(gd[loc]),'gvotes':int(gv[loc]),'sscore':float(ss[loc]),'sdis':float(sd[loc]),'svotes':int(sv[loc]),'hasSessionExpert':True}
            else:
                out[i]={**test[i],'gscore':float(gs[loc]),'gdis':float(gd[loc]),'gvotes':int(gv[loc]),'sscore':float(gs[loc]),'sdis':float(gd[loc]),'svotes':int(gv[loc]),'hasSessionExpert':False}
    return out


def score_blend(raw,blend):
    out=[]; bysnap=defaultdict(list)
    for i,x in enumerate(raw):bysnap[x['si']].append(i)
    for ids in bysnap.values():
        vals=[]
        for i in ids:
            x=raw[i]; b=blend if x['hasSessionExpert'] else 0.0
            vals.append((1-b)*x['gscore']+b*x['sscore'])
        order=np.argsort(-np.asarray(vals)); ranks=np.empty(len(ids),int)
        for rr,loc in enumerate(order,1):ranks[loc]=rr
        for loc,i in enumerate(ids):
            x=raw[i]; b=blend if x['hasSessionExpert'] else 0.0
            out.append({**x,'meta':float(vals[loc]),'disagreement':float((1-b)*x['gdis']+b*x['sdis']),'votes':int(max(x['gvotes'],x['svotes']) if b>=.5 else x['gvotes']),'rank':int(ranks[loc]),'blend':float(b)})
    return out


def stat(xs,univ):
    n=len(xs); tp=sum(win(x) for x in xs); ctp=sum(clean(x) for x in xs)
    den=sum(win(x) for x in univ); cden=sum(clean(x) for x in univ)
    return {'count':n,'tp10':tp,'precision10Pct':round(tp/n*100,2) if n else None,'recall10Pct':round(tp/den*100,2) if den else None,'cleanTP':ctp,'cleanPrecisionPct':round(ctp/n*100,2) if n else None,'cleanRecallPct':round(ctp/cden*100,2) if cden else None,'tickerDays':len(set(x['key'] for x in xs))}


def apply(xs,cfg):
    k,m,d,v=cfg
    return [x for x in xs if x['rank']<=k and x['meta']>=m and x['disagreement']<=d and x['votes']>=v]


def choose_session(raw,session_code):
    best=None; name={0:'pre',1:'regular',2:'after'}[session_code]
    for blend in (0.0,.25,.50,.75,1.0):
        scored=score_blend(raw,blend); u=[x for x in scored if scode(x['session'])==session_code]
        positives=sum(win(x) for x in u)
        for k in (1,2,3,5,8,10,15):
            for m in (.50,.60,.70,.78,.85,.92):
                for d in (.12,.20,.30,.40,.55):
                    for v in (1,2,3):
                        sel=apply(u,(k,m,d,v)); s=stat(sel,u)
                        p=s['precision10Pct'] or 0; cp=s['cleanPrecisionPct'] or 0; r=s['recall10Pct'] or 0
                        min_count=8 if name!='regular' else 12
                        min_tp=2 if positives>=4 else 1
                        support_ok=len(sel)>=min_count and s['tp10']>=min_tp
                        support=min(1,len(sel)/max(min_count,1))*min(1,s['tp10']/max(min_tp,1))
                        utility=(.68*p+.22*cp+.10*r)*support + .6*s['tp10']
                        if support_ok: utility+=5
                        cand=(utility,blend,(k,m,d,v),s,support_ok)
                        if best is None or cand[0]>best[0]:best=cand
    return best


train=[x for x in data if x['day']<='2026-08-24']
cal=[x for x in data if '2026-08-25'<=x['day']<='2026-08-26']
hold=[x for x in data if x['day']>='2026-08-27']
cal_raw=raw_scores(train,cal); hold_raw=raw_scores(train+cal,hold)

sessions={}; aggregate_alert=[]; aggregate_universe=[]
for s,name in ((0,'pre'),(1,'regular'),(2,'after')):
    _,blend,cfg,calstat,support_ok=choose_session(cal_raw,s)
    hs=score_blend(hold_raw,blend); hu=[x for x in hs if scode(x['session'])==s]; ha=apply(hu,cfg)
    aggregate_alert.extend(ha); aggregate_universe.extend(hu)
    sessions[name]={'blend':blend,'config':{'topK':cfg[0],'minMeta':cfg[1],'maxDisagreement':cfg[2],'minVotes':cfg[3]},'calibration':calstat,'calibrationSupportOK':support_ok,'holdoutUniverse':stat(hu,hu),'holdoutAlert':stat(ha,hu)}

baseline=json.loads(pathlib.Path('tag/data/tagit-v35-selective-meta.json').read_text()) if pathlib.Path('tag/data/tagit-v35-selective-meta.json').exists() else None
report={'schemaVersion':1,'method':'TAGIT_V37_SESSION_CALIBRATED_SELECTIVE_EXPERTS','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
'antiLeakage':['inherits v3.4 fully-closed 5m feature/label contract','session blends and thresholds selected on Aug25-26 only','Aug27-Sep4 untouched for all session configuration selection','session models for holdout train only through Aug26'],
'coverage':{'rows':len(data),'train':len(train),'calibration':len(cal),'holdout':len(hold),'holdoutPositives':sum(win(x) for x in hold)},
'v35Reference':baseline.get('holdout') if baseline else None,'sessions':sessions,'aggregateHoldout':stat(aggregate_alert,aggregate_universe)}
OUT.write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
