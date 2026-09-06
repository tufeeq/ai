#!/usr/bin/env python3
"""Train TAGit v3 discovery ranker on causal Technical + Core Sequence features.

Research/shadow only. The target is graded future MFE relevance, not a binary
'probability of success'. Training uses all historical observations only because
live scoring occurs after the historical window.
"""
import json, pathlib, runpy
from collections import defaultdict
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

MODEL=pathlib.Path('tag/model/tagit-v3-ranker.joblib')
META=pathlib.Path('tag/data/tagit-v3-ranker-meta.json')
FEATURES=['change','logRvol','logVolumeVelocity','shortRate','m5','m10','m30','m60','logDollarVolume',
          'rvolDeltaPerMin','volumeVelocityAccel','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps']
BASE_NAMES=['change','logRvol','logVolumeVelocity','shortRate','rvolDeltaPerMin','volumeVelocityAccel','m5','m10','m30','m60','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','logDollarVolume','logFloat','floatRotation','gap','sma20','perfWeek','sessionCode']
IDX={n:i for i,n in enumerate(BASE_NAMES)}

g=runpy.run_path('tagit/historical-feature-builder.py')['build']()
rows=[]
for x in g['early']:
    b=x['features']
    feat=[b[IDX[n]] for n in FEATURES]
    rows.append({'iso':x['iso'],'day':x['day'],'key':x['key'],'features':feat,'relevance':int(x['relevance']),'target':bool(x['target'])})
X=np.asarray([r['features'] for r in rows],dtype=float)
y=np.asarray([r['relevance'] for r in rows],dtype=float)
weights=1+np.minimum(y,4)*6

et=ExtraTreesRegressor(n_estimators=360,max_depth=11,min_samples_leaf=7,max_features=.82,random_state=3301,n_jobs=-1).fit(X,y,sample_weight=weights)
hg=HistGradientBoostingRegressor(max_iter=180,max_leaf_nodes=17,learning_rate=.05,l2_regularization=5,min_samples_leaf=28,random_state=3302).fit(X,y,sample_weight=weights)

# Pairwise Bradley-Terry-style linear utility, pairs only within the same historical snapshot.
sc=StandardScaler().fit(X); Xs=sc.transform(X)
by=defaultdict(list)
for i,r in enumerate(rows): by[r['iso']].append(i)
pd=[];py=[]
for ids in by.values():
    pos=[i for i in ids if rows[i]['relevance']>0]
    neg=[i for i in ids if rows[i]['relevance']==0]
    if not pos or not neg: continue
    stride=max(1,len(neg)//16); neg=neg[::stride][:16]
    for gi in sorted(pos,key=lambda i:rows[i]['relevance'],reverse=True)[:10]:
        for bi in neg:
            d=Xs[gi]-Xs[bi]; pd.append(d);py.append(1);pd.append(-d);py.append(0)
    pos2=sorted(pos,key=lambda i:rows[i]['relevance'],reverse=True)[:10]
    for a in range(len(pos2)):
        for b in range(a+1,len(pos2)):
            if rows[pos2[a]]['relevance']<=rows[pos2[b]]['relevance']: continue
            d=Xs[pos2[a]]-Xs[pos2[b]];pd.append(d);py.append(1);pd.append(-d);py.append(0)
pair=LogisticRegression(max_iter=400,C=.22,random_state=3303).fit(np.asarray(pd),np.asarray(py))

artifact={'schemaVersion':3,'trainedAtUTC':datetime.now(timezone.utc).isoformat(),'featureNames':FEATURES,'objective':'GRADED_RELEVANCE_RANKING_0_5_10_20_40_MFE60',
          'extraTrees':et,'histGradientBoosting':hg,'scaler':sc,'pairwise':pair,
          'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE'}
MODEL.parent.mkdir(parents=True,exist_ok=True);joblib.dump(artifact,MODEL,compress=3)
rel={str(i):int(np.sum(y==i)) for i in range(5)}
ablation={}
try:
    a=json.loads(pathlib.Path('tag/data/tagit-v3-ablation.json').read_text())
    seq=next(z for z in a['ablation'] if z['layer']=='technical+sequence')
    ablation={'calibration':seq['calibration'],'holdoutSeptember':seq['holdoutSeptember'],'fixedTopK':seq['fixedTopK']}
except Exception: pass
meta={'schemaVersion':3,'trainedAtUTC':artifact['trainedAtUTC'],'trainingRows':len(rows),'gitRevisions':len(g['snapshots']),'rawRows':g['rawRows'],'parseFailures':g['parseFailures'],
      'featureNames':FEATURES,'featureCount':len(FEATURES),'relevanceDistribution':rel,'positive10PctRows':int(sum(r['target'] for r in rows)),
      'objective':artifact['objective'],'historicalAblationEvidence':ablation,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE',
      'excludedFromCoreRank':['sparse snapshot-ledger extras','structure extras','regime aggregate','catalyst positive weight'],
      'sideEvidencePolicy':'Catalyst may be displayed; dilution may block risk. No positive catalyst weight until mature point-in-time calibration.'}
META.write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
