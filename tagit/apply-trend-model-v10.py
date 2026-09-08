#!/usr/bin/env python3
import json, math, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'tag'/'data'; FEED=DATA/'live-quotes.json'; MODEL=DATA/'tagit-trend-model-v10.json'
BASE=['acc5','acc15','relativeVolume','turnover15mPct','range15mPct','range30mPct','buyVolumePct','technicalScore','priceVelocity5mPct','priceVelocity15mPct','changePct','sessionVolumeLog']

def load(p,d=None):
    try:return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    except:return {} if d is None else d

def num(v):
    try:
        if v is None:return None
        x=float(str(v).replace('%','').replace(',','').replace('$','').strip()); return x if math.isfinite(x) else None
    except:return None

def sym(r):return str((r or {}).get('ticker') or (r or {}).get('Ticker') or (r or {}).get('symbol') or '').upper().strip()
def raw(q,k):
    aliases={'acc5':['acceleration5m','volumeAcceleration5m','volume5mRatio','acc5'],'acc15':['acceleration15m','volumeAcceleration15m','volume15mRatio','acc15'],'relativeVolume':['relativeVolume','relVolume','Rel Volume'],'turnover15mPct':['turnover15mPct','turn15','floatTurnover15mPct'],'range15mPct':['range15mPct','range15'],'range30mPct':['range30mPct','range30'],'buyVolumePct':['buyVolumePct','buyPct'],'technicalScore':['technicalScore'],'priceVelocity5mPct':['priceVelocity5mPct','v5'],'priceVelocity15mPct':['priceVelocity15mPct','v15'],'changePct':['changePct'],'sessionVolumeLog':['sessionVolume','volume']}
    for a in aliases.get(k,[k]):
        v=num((q or {}).get(a))
        if v is not None:return math.log1p(max(v,0)) if k=='sessionVolumeLog' else v
    return None
def getv(q,k):
    if k in BASE:return raw(q,k)
    a5=raw(q,'acc5') or 0; a15=raw(q,'acc15') or 0; rv=raw(q,'relativeVolume') or 0; turn=raw(q,'turnover15mPct') or 0; rg=raw(q,'range15mPct'); v5=raw(q,'priceVelocity5mPct'); tech=raw(q,'technicalScore'); buy=raw(q,'buyVolumePct'); rg=rg if rg is not None else 6.0
    if k=='pressureCompression':return (max(a5-1,0)+.7*max(a15-1,0)+.55*max(rv-1,0))/(1+max(rg,0))
    if k=='turnoverCompression':return max(turn,0)/(1+max(rg,0))
    if k=='quietPressure':return (max(a5,0)+.7*max(a15,0)+.4*max(rv,0))*max(0,1-min(abs(v5 or 0)/2.5,1))
    if k=='trendAlignment':return ((tech or 50)/100.0)*((buy or 50)/100.0)
    return None
def sig(x):return 1.0 if x>30 else 0.0 if x<-30 else 1/(1+math.exp(-x))
def main():
    feed=load(FEED,{}); model=load(MODEL,{})
    if not feed or model.get('schemaVersion')!=10:
        print('trend model unavailable; feed unchanged'); return
    qs=feed.get('quotes') or {}; iterable=qs.items() if isinstance(qs,dict) else [(sym(q),q) for q in qs]
    feats=model.get('features') or []; norm=model.get('normalization') or {}; w=model.get('weights') or {}; bias=float(model.get('bias') or 0); th=float(model.get('threshold') or .65); scored=[]
    g=model.get('guardrails') or {}; lo=float(g.get('changePctMin',-5)); hi=float(g.get('changePctMaxExclusive',10)); maxage=float(g.get('maxQuoteAgeMin',4))
    for t,q in iterable:
        q=q or {}; t=str(t).upper(); ch=getv(q,'changePct'); age=num(q.get('quoteAgeMin'))
        if not t or ch is None or ch<lo or ch>=hi or (age is not None and age>maxage):continue
        s=bias; contrib=[]; present=0
        for k in feats:
            v=getv(q,k); st=norm.get(k) or {'median':0,'scale':1}; scale=max(float(st.get('scale') or 1),1e-6); zv=0 if v is None else max(-4,min(4,(v-float(st.get('median') or 0))/scale))
            if v is not None:present+=1
            c=float(w.get(k) or 0)*zv; s+=c; contrib.append((abs(c),k,c))
        if present<8:continue
        p=sig(s)
        if p<th:continue
        row=dict(q); row['ticker']=t; row['trendModelScore']=round(p*100,1); row['trendModelVersion']='V10'; row['preBreakout']=True; row['earlyBreakoutScore']=max(num(row.get('earlyBreakoutScore')) or 0,round(p*100,1)); row['trendDrivers']=[k for _,k,c in sorted(contrib,reverse=True)[:5] if c>0]
        scored.append(row)
    scored.sort(key=lambda r:(num(r.get('trendModelScore')) or 0,num(r.get('technicalScore')) or 0,-abs(num(r.get('changePct')) or 0)),reverse=True); cap=int(model.get('candidateCap') or 30); scored=scored[:cap]
    existing={sym(r):r for r in (feed.get('earlyCandidates') or []) if sym(r)}
    for r in scored:existing[sym(r)]={**existing.get(sym(r),{}),**r}
    merged=list(existing.values()); merged.sort(key=lambda r:(num(r.get('trendModelScore')) or 0,num(r.get('earlyBreakoutScore')) or 0),reverse=True)
    feed['earlyCandidates']=merged[:cap]; feed['earlyCount']=len(feed['earlyCandidates']); feed['trendModel']={'version':'V10','mode':model.get('modelType'),'threshold':th,'scoredCandidates':len(scored),'modelGeneratedAtUTC':model.get('generatedAtUTC'),'sameSessionSimulation':True,'candidateCap':cap}
    FEED.write_text(json.dumps(feed,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8'); print({'model':'V10','scored':len(scored),'earlyCount':feed['earlyCount'],'threshold':th})
if __name__=='__main__':main()
