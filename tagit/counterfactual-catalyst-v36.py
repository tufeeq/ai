#!/usr/bin/env python3
"""TAGit v3.6 counterfactual Catalyst/Event Clock simulation.

Two clocks are kept separate:
- ACTUAL_OBSERVED: first Git enrichment revision where TAG recorded the event.
- PUBLISHED_AS_OF_T: counterfactual assumption that a complete real-time news feed
  would have exposed the event at its publication timestamp.
The latter answers the user's hypothetical missing-data question and is never
presented as a strict historical backtest.
"""
import json, math, pathlib, re, runpy, subprocess
from collections import defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

OUT=pathlib.Path('tag/data/tagit-v36-catalyst-counterfactual.json');ENR='tag/data/enrichment.json'

def parse_dt(s):
    if not s:return None
    try:return datetime.fromisoformat(str(s).replace('Z','+00:00'))
    except:
        try:return parsedate_to_datetime(str(s))
        except:return None

def classify(title):
    t=' '.join(str(title or '').lower().split())
    rules=[
      ('DILUTION_FINANCING','NEGATIVE',[r'registered direct',r'public offering',r'private placement',r'at-the-market',r'convertible',r'warrants?',r'financing',r'offering']),
      ('FDA_CLINICAL','POSITIVE',[r'\bfda\b',r'phase\s*[123]',r'clinical trial',r'primary endpoint',r'clearance',r'approval']),
      ('CONTRACT_ORDER','POSITIVE',[r'government contract',r'purchase order',r'contract award',r'awarded?',r'selected by',r'new contract']),
      ('M_AND_A','POSITIVE',[r'merger',r'acquisition',r'acquire[sd]?',r'buyout',r'takeover',r'business combination']),
      ('EARNINGS_GUIDANCE','MIXED',[r'earnings',r'financial results',r'guidance',r'revenue',r'\beps\b',r'quarterly results']),
      ('PARTNERSHIP_LICENSING','POSITIVE',[r'partnership',r'collaboration',r'licensing agreement',r'license agreement',r'strategic alliance',r'distribution agreement']),
      ('LEGAL_REGULATORY','MIXED',[r'lawsuit',r'settlement',r'patent',r'court',r'nasdaq compliance',r'delisting',r'regulatory']),
      ('CAPITAL_STRUCTURE','MIXED',[r'reverse split',r'stock split',r'share consolidation',r'dividend',r'buyback'])]
    if not t:return ('NONE','UNKNOWN',0.0)
    best=('OTHER_NEWS','UNKNOWN',.25,0)
    mats={'DILUTION_FINANCING':.92,'FDA_CLINICAL':.94,'CONTRACT_ORDER':.86,'M_AND_A':.92,'EARNINGS_GUIDANCE':.78,'PARTNERSHIP_LICENSING':.70,'LEGAL_REGULATORY':.72,'CAPITAL_STRUCTURE':.68}
    for typ,pol,pats in rules:
        hits=sum(bool(re.search(p,t)) for p in pats)
        if hits>best[3]:best=(typ,pol,mats[typ],hits)
    typ,pol,mat,_=best
    if re.search(r'approval|clearance|met primary endpoint|awarded|definitive agreement|record revenue|raises guidance',t) and typ!='DILUTION_FINANCING':pol='POSITIVE';mat=min(1,mat+.05)
    if re.search(r'prices? offering|going concern|delisting|misses?|lowers guidance|default',t):pol='NEGATIVE';mat=min(1,mat+.05)
    return typ,pol,mat

def source_quality(src):
    s=str(src or '').lower()
    if any(x in s for x in ('reuters','globenewswire','business wire','pr newswire','accesswire')):return 1.0
    if any(x in s for x in ('stocktwits','stockstotrade','timothysykes')):return -.5
    return 0.0

# Rebuild v3.4 ground truth (raw Yahoo bars remain ephemeral inside that module).
g=runpy.run_path('tagit/month-groundtruth-v34.py');data=g['data'];scode=g['scode']

# Reconstruct event clock from every enrichment Git revision. Dedupe by ticker/title/publication.
revs=subprocess.check_output(['git','log','--format=%H','--reverse','--',ENR],text=True).splitlines();events={};parse_fail=0
for sha in revs:
    try:
        raw=subprocess.check_output(['git','show',f'{sha}:{ENR}'],text=True,stderr=subprocess.DEVNULL);d=json.loads(raw);seen_dt=parse_dt(d.get('updatedAt') or d.get('updatedAtUTC') or d.get('snapshotTimestampUTC'))
        rows=d.get('rows') or {}
        if not isinstance(rows,dict):continue
        for ticker,z in rows.items():
            t=str(ticker).upper()
            for n in z.get('news') or []:
                title=str(n.get('title') or '').strip();pub=parse_dt(n.get('published'))
                if not title or not pub:continue
                key=(t,title,pub.isoformat());e=events.get(key)
                typ,pol,mat=classify(title)
                if e is None or (seen_dt and (e.get('firstSeen') is None or seen_dt<e['firstSeen'])):
                    events[key]={'ticker':t,'title':title,'published':pub,'firstSeen':seen_dt,'source':n.get('source'),'type':typ,'polarity':pol,'materiality':mat}
    except Exception:parse_fail+=1
by_t=defaultdict(list)
for e in events.values():by_t[e['ticker']].append(e)
for a in by_t.values():a.sort(key=lambda x:x['published'])

types=['FDA_CLINICAL','CONTRACT_ORDER','M_AND_A','EARNINGS_GUIDANCE','PARTNERSHIP_LICENSING','DILUTION_FINANCING','LEGAL_REGULATORY','CAPITAL_STRUCTURE']

def event_features(x,clock):
    dt=datetime.fromtimestamp(x['ts']/1000,timezone.utc);cand=[]
    for e in by_t.get(x['ticker'],[]):
        avail=e['published'] if clock=='published' else e.get('firstSeen')
        if avail is None or avail>dt:continue
        age=(dt-e['published']).total_seconds()/60
        if age<0 or age>1440:continue
        cand.append((e,age))
    if not cand:return [0,0,0,0,0,0,0]+[0]*len(types),None
    # Strong material event wins; recency breaks ties. OTHER_NEWS cannot dominate a material event.
    cand.sort(key=lambda z:(z[0]['materiality']*math.exp(-z[1]/720),-z[1]),reverse=True);e,age=cand[0]
    pol=e['polarity'];sq=source_quality(e['source']);one=[1 if e['type']==t else 0 for t in types]
    f=[1,math.exp(-age/180),math.exp(-age/720),1 if pol=='POSITIVE' else 0,1 if pol=='NEGATIVE' else 0,e['materiality'],sq]+one
    return f,{'type':e['type'],'polarity':pol,'materiality':e['materiality'],'ageMin':round(age,1),'sourceQuality':sq}

for x in data:
    x['catPublished'],x['catPublishedMeta']=event_features(x,'published');x['catActual'],x['catActualMeta']=event_features(x,'actual')

def feat(x,mode):
    z=x['base']+x['sequence']+x['micro']
    if mode=='published':z=z+x['catPublished']
    elif mode=='actual':z=z+x['catActual']
    return np.asarray(z,float)
def rank01(a):
    a=np.asarray(a,float)
    if len(a)<=1:return np.ones(len(a))
    return np.argsort(np.argsort(a))/max(1,len(a)-1)

def fit_score(tr,te,mode,seed):
    X=np.asarray([feat(x,mode) for x in tr]);Xt=np.asarray([feat(x,mode) for x in te]);y=np.asarray([int(x['target']) for x in tr]);sc=StandardScaler().fit(X);Xs=sc.transform(X);Xts=sc.transform(Xt);pos=max(1,y.sum());neg=max(1,len(y)-pos);w=np.where(y==1,min(80,neg/pos),1.0)
    et=ExtraTreesClassifier(n_estimators=440,max_depth=11,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=seed,n_jobs=-1).fit(X,y)
    hg=HistGradientBoostingClassifier(max_iter=230,max_leaf_nodes=15,learning_rate=.043,l2_regularization=4,min_samples_leaf=22,random_state=seed+1).fit(X,y,sample_weight=w)
    lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.23,random_state=seed+2).fit(Xs,y)
    a=et.predict_proba(Xt)[:,1];b=hg.predict_proba(Xt)[:,1];c=lr.predict_proba(Xts)[:,1];out=[None]*len(te);bys=defaultdict(list)
    for i,x in enumerate(te):bys[x['si']].append(i)
    for ids in bys.values():
        ra=rank01(a[ids]);rb=rank01(b[ids]);rc=rank01(c[ids]);ens=.42*ra+.38*rb+.20*rc;dis=np.std(np.vstack([ra,rb,rc]),axis=0);order=np.argsort(-ens)
        for rr,loc in enumerate(order,1):
            i=ids[loc];out[i]={**te[i],'ensemble':float(ens[loc]),'disagreement':float(dis[loc]),'rank':rr}
    return out

def stat(xs,univ):
    n=len(xs);tp=sum(x['target'] for x in xs);den=sum(x['target'] for x in univ)
    return {'count':n,'tp':tp,'precisionPct':round(tp/n*100,2) if n else None,'recallPct':round(tp/den*100,2) if den else None,'tickerDays':len(set(x['key'] for x in xs)),'capturedTickerDays':len(set(x['key'] for x in xs if x['target']))}
def apply(xs,c):
    k,e,d=c;return [x for x in xs if x['rank']<=k and x['ensemble']>=e and x['disagreement']<=d]
def choose(cp):
    z=[]
    for k in (1,2,3,5,8,10,15,20):
      for e in (.35,.50,.65,.75,.85,.93):
       for d in (.10,.18,.28,.40,.60):
        s=stat(apply(cp,(k,e,d)),cp);p=s['precisionPct'] or 0;support=min(1,s['count']/25)*min(1,s['tp']/6);util=p*support+s['tp']*1.6+s['recallPct']*.2;z.append(((k,e,d),s,util))
    return max(z,key=lambda x:x[2])

train=[x for x in data if x['day']<='2026-08-24'];cal=[x for x in data if '2026-08-25'<=x['day']<='2026-08-26'];hold=[x for x in data if x['day']>='2026-08-27']
results=[]
for idx,mode in enumerate(('none','actual','published')):
    cp=fit_score(train,cal,mode,3600+idx*10);hp=fit_score(train+cal,hold,mode,3650+idx*10);cfg,cs,_=choose(cp);hs=stat(apply(hp,cfg),hp);top={str(k):stat([x for x in hp if x['rank']<=k],hp) for k in (1,3,5,10,20)}
    results.append({'mode':mode,'meaning':{'none':'price/sequence/micro only','actual':'strict TAG-observed catalyst clock','published':'COUNTERFACTUAL complete-feed catalyst available at publication time'}[mode],'selectedConfig':{'topK':cfg[0],'minEnsemble':cfg[1],'maxDisagreement':cfg[2]},'calibration':cs,'holdout':hs,'holdoutTopK':top})

def cov(xs,field):
    z=[x for x in xs if x[field+'Meta'] is not None];return {'rows':len(xs),'withEvent':len(z),'coveragePct':round(len(z)/max(1,len(xs))*100,2),'positiveRows':sum(x['target'] for x in z),'eventPrecisionRawPct':round(sum(x['target'] for x in z)/len(z)*100,2) if z else None}
def type_stats(xs,field):
    out={}
    for t in types+['OTHER_NEWS']:
        z=[x for x in xs if x[field+'Meta'] and x[field+'Meta']['type']==t]
        if z:out[t]={'count':len(z),'tp':sum(x['target'] for x in z),'precisionPct':round(sum(x['target'] for x in z)/len(z)*100,2)}
    return out
report={'schemaVersion':1,'method':'TAGIT_V36_COUNTERFACTUAL_CATALYST_EVENT_CLOCK','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'policy':'RESEARCH_ONLY_NO_CHAMPION_OVERRIDE',
'simulationWarning':'PUBLISHED_AS_OF_T is a counterfactual complete-feed simulation, not proof TAG actually possessed the headline then. ACTUAL mode remains strict.',
'eventClock':{'enrichmentRevisions':len(revs),'uniqueEvents':len(events),'parseFailures':parse_fail,'firstEnrichmentDate':'2026-08-13'},
'coverage':{'trainActual':cov(train,'catActual'),'trainPublished':cov(train,'catPublished'),'calActual':cov(cal,'catActual'),'calPublished':cov(cal,'catPublished'),'holdActual':cov(hold,'catActual'),'holdPublished':cov(hold,'catPublished')},
'holdoutTypeStatsCounterfactual':type_stats(hold,'catPublished'),'antiLeakage':['event publication must be <= observation for counterfactual mode','actual mode additionally requires first TAG enrichment observation <= decision','ground truth inherited from v3.4 future 5m labels','thresholds selected on Aug25-26 only'],'results':results}
OUT.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
