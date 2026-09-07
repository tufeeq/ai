#!/usr/bin/env python3
"""Train TAGit v4 live-compatible SHADOW ranker on frozen causal ground truth.

Architecture/feature set was validated BEFORE final refit in v3.10. This script
refits the frozen live21 feature contract on all frozen rows for forward shadow use.
It never changes the champion feed and does not claim calibrated success probability.
"""
import hashlib,json,pathlib
from datetime import datetime,timezone
import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier,HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

SRC=pathlib.Path('tag/data/tagit-v39-frozen-groundtruth.json')
VALID=pathlib.Path('tag/data/tagit-v310-live-compatible.json')
MODEL=pathlib.Path('tag/model/tagit-v4-live-compatible.joblib')
META=pathlib.Path('tag/model/tagit-v4-live-compatible-meta.json')
EXPECTED='19277cfddc8dbeaebee73ce70a6e6fad57213caae87959da7f3e5e859a88773b'
FEATURES=[
 'log_price','day_change_div20','log1p_volume_div20','change_rank','volume_rank',
 'signal_topgainers','signal_unusualvolume','signal_mostactive','session_pre','session_regular','session_after',
 'price_velocity_10m_div5','change_velocity_10m_div5','log1p_volume_velocity_10m_div15','volume_velocity_accel_clamped',
 'age_since_first_obs_div390','change_since_first_obs_div20',
 'momentum5m_div10','momentum10m_div10','momentum30m_div20','momentum60m_div30'
]

def vec(x): return list(x['base'])+list(x['sequence'][:6])+list(x['micro'][:4])

frozen=json.loads(SRC.read_text())
rows=frozen['data']
canon=json.dumps(rows,sort_keys=True,separators=(',',':'),ensure_ascii=False)
sha=hashlib.sha256(canon.encode()).hexdigest()
assert sha==EXPECTED==frozen['datasetSha256']
X=np.asarray([vec(x) for x in rows],float); y=np.asarray([int(bool(x['target'])) for x in rows],int)
assert X.shape[1]==21==len(FEATURES)
scaler=StandardScaler().fit(X); Xs=scaler.transform(X)
pos=max(1,int(y.sum())); neg=max(1,len(y)-pos)
w=np.where(y==1,min(80,neg/pos),1.0)
hard=np.asarray([1.8 if (not x['target'] and (float(x['changeRank'])>.7 or float(x['volumeRank'])>.8)) else 1.0 for x in rows]); w*=hard
et=ExtraTreesClassifier(n_estimators=420,max_depth=11,min_samples_leaf=7,max_features=.8,class_weight='balanced_subsample',random_state=3101,n_jobs=-1).fit(X,y)
hg=HistGradientBoostingClassifier(max_iter=220,max_leaf_nodes=15,learning_rate=.045,l2_regularization=4,min_samples_leaf=22,random_state=3102).fit(X,y,sample_weight=w)
lr=LogisticRegression(max_iter=500,class_weight='balanced',C=.25,random_state=3103).fit(Xs,y)
validation=json.loads(VALID.read_text())
assert validation['datasetSha256']==EXPECTED
v=next(z for z in validation['results'] if z['mode']=='live21')
trained=datetime.now(timezone.utc).isoformat()
artifact={
 'schemaVersion':4,'modelVersion':'TAGit-v4-live21-shadow','trainedAtUTC':trained,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE',
 'datasetSha256':EXPECTED,'featureNames':FEATURES,'featureCount':21,'ensembleWeights':{'extraTrees':.42,'histGradientBoosting':.38,'logistic':.20},
 'extraTrees':et,'histGradientBoosting':hg,'logistic':lr,'scaler':scaler,
 'objective':'+10% MFE within next 60m while observation day change <10%; relative cross-sectional discovery rank',
 'scoreMeaning':'RELATIVE_RANK_NOT_CALIBRATED_SUCCESS_PROBABILITY'
}
MODEL.parent.mkdir(parents=True,exist_ok=True); joblib.dump(artifact,MODEL,compress=3)
meta={
 'schemaVersion':4,'modelVersion':'TAGit-v4-live21-shadow','trainedAtUTC':trained,'policy':'SHADOW_ONLY_NO_CHAMPION_OVERRIDE','championUnaffected':True,
 'datasetSha256':EXPECTED,'trainingRows':len(rows),'trainingPositives':int(y.sum()),'featureCount':21,'featureNames':FEATURES,
 'featureContract':validation['featureContract'],'validationSource':'tag/data/tagit-v310-live-compatible.json',
 'frozenHoldoutEvidence':{'rows':validation['coverage']['holdout'],'positives':validation['coverage']['holdoutPositives'],'selectedGate':v['selectedConfig'],'selectedPrecisionPct':v['holdout']['precisionPct'],'selectedRecallPct':v['holdout']['recallPct'],'top20PrecisionPct':v['holdoutTopK']['20']['precisionPct'],'top20RecallPct':v['holdoutTopK']['20']['recallPct'],'top10PrecisionPct':v['holdoutTopK']['10']['precisionPct'],'top10RecallPct':v['holdoutTopK']['10']['recallPct']},
 'refitPolicy':'Architecture and feature contract validated on frozen Aug27-Sep4 holdout before final refit; final model refit uses all 4466 frozen rows for forward shadow only.',
 'limitations':['Historical holdout evidence is not live production performance.','No bid/ask spread in this model; execution is never verified.','Catalyst is contextual side evidence only and cannot override rank.']
}
META.write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
