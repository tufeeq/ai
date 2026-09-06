#!/usr/bin/env python3
"""Build TAGit's causal historical observation table without fitting a model.

The builder reconstructs each discovery-fast Git revision in event-time order.
Only current/prior observations enter features. Forward prices are labels only.
"""
import json, math, subprocess
from collections import defaultdict
from datetime import datetime

DATA_PATH='tag/data/discovery-fast.json'

def finite(v):
    try: return v is not None and math.isfinite(float(v))
    except Exception: return False

def num(v):
    if v is None or v=='': return None
    try:
        s=str(v).replace('$','').replace('%','').replace(',','').strip().upper(); m=1
        if s.endswith('K'): m=1e3; s=s[:-1]
        elif s.endswith('M'): m=1e6; s=s[:-1]
        elif s.endswith('B'): m=1e9; s=s[:-1]
        return float(s)*m
    except Exception: return None

def avg_volume(v):
    if v is None or v=='': return None
    s=str(v).strip().upper(); n=num(v)
    if n is None: return None
    return n if s.endswith(('K','M','B')) else n*1000

def ret(a,b): return (a/b-1)*100 if a and b else None

def q(v,default=0.0): return float(v) if finite(v) else default

def safe_log(v): return math.log1p(max(0,float(v))) if finite(v) else 0.0

def session_code(s):
    s=str(s or '').lower()
    return 0 if 'pre' in s else (1 if s=='regular' else (2 if 'after' in s else 3))

def prior(arr,i,target,minf=.3,maxf=2.5):
    best=None; err=1e18
    for j in range(i-1,-1,-1):
        d=(arr[i]['ts']-arr[j]['ts'])/60000
        if d>target*maxf: break
        if d<target*minf: continue
        e=abs(d-target)
        if e<err: best=arr[j]; err=e
    return best

def forward_returns(arr,i,max_min):
    c=arr[i]; out=[]
    for j in range(i+1,len(arr)):
        d=(arr[j]['ts']-c['ts'])/60000
        if d>max_min: break
        r=ret(arr[j]['price'],c['price'])
        if r is not None: out.append(r)
    return out

def build():
    revs=subprocess.check_output(['git','log','--format=%H','--reverse','--',DATA_PATH],text=True).splitlines()
    snaps=[]; seen=set(); parse_fail=0
    for sha in revs:
        try:
            raw=subprocess.check_output(['git','show',f'{sha}:{DATA_PATH}'],text=True,stderr=subprocess.DEVNULL)
            d=json.loads(raw); iso=d.get('snapshotTimestampUTC') or d.get('updatedAt')
            if not iso or iso in seen: continue
            seen.add(iso); ts=datetime.fromisoformat(iso.replace('Z','+00:00')).timestamp()*1000
            rows=d.get('rows') or d.get('data') or []
            snaps.append({'sha':sha,'iso':iso,'ts':ts,'day':iso[:10],'session':d.get('session') or 'unknown','rows':rows})
        except Exception:
            parse_fail+=1
    snaps.sort(key=lambda x:x['ts'])

    by_td=defaultdict(list); raw_rows=0
    for snap in snaps:
        for r in snap['rows']:
            ticker=str(r.get('Ticker') or r.get('Symbol') or '').strip().upper(); price=num(r.get('Price'))
            if not ticker or not price or price<=0: continue
            raw_rows+=1
            o={'ticker':ticker,'key':f"{ticker}|{snap['day']}",'day':snap['day'],'iso':snap['iso'],'ts':snap['ts'],'session':snap['session'],'price':price,
               'volume':num(r.get('Volume')) or 0,'change':num(r.get('Change')) or 0,'rvol':num(r.get('Relative Volume') or r.get('Rel Volume')),
               'avgVolume':avg_volume(r.get('Average Volume')),'gap':num(r.get('Gap')),'sma20':num(r.get('20-Day Simple Moving Average')),
               'perfWeek':num(r.get('Performance (Week)')),'floatShares':num(r.get('Shares Float') or r.get('Float')),'row':r}
            by_td[o['key']].append(o)
    for a in by_td.values(): a.sort(key=lambda x:x['ts'])

    obs=[]
    for key,a in by_td.items():
        for i,o in enumerate(a):
            p5,p10,p30,p60=[prior(a,i,t) for t in (5,10,30,60)]
            m5=ret(o['price'],p5['price']) if p5 else None; m10=ret(o['price'],p10['price']) if p10 else None
            m30=ret(o['price'],p30['price']) if p30 else None; m60=ret(o['price'],p60['price']) if p60 else None
            prev=a[i-1] if i else None; short=None; vv=None; rdelta=None; vvdelta=None
            if prev:
                dt=(o['ts']-prev['ts'])/60000
                if 0<dt<=30:
                    rr=ret(o['price'],prev['price']); short=rr/dt if rr is not None else None
                    rdelta=(o['rvol']-prev['rvol'])/dt if finite(o['rvol']) and finite(prev['rvol']) else None
                    if o['avgVolume'] and o['volume']>=prev['volume']:
                        exp=o['avgVolume']/390*dt
                        if exp>0: vv=(o['volume']-prev['volume'])/exp
                    if i>=2:
                        pp=a[i-2]; dt2=(prev['ts']-pp['ts'])/60000
                        if 0<dt2<=30 and prev['avgVolume'] and prev['volume']>=pp['volume']:
                            exp2=prev['avgVolume']/390*dt2
                            if exp2>0 and finite(vv):
                                pvv=(prev['volume']-pp['volume'])/exp2
                                vvdelta=(vv-pvv)/max(dt,1)
            f30=forward_returns(a,i,30); f60=forward_returns(a,i,60); fday=forward_returns(a,i,720)
            if not f60: continue
            mfe30=max(f30) if f30 else None; mfe60=max(f60); mfeday=max(fday) if fday else None
            turn=(m5-m30/6) if finite(m5) and finite(m30) else None
            curvature=(m5-m10/2) if finite(m5) and finite(m10) else None
            longcurv=(m10-m30/3) if finite(m10) and finite(m30) else None
            quiet=1 if abs(q(m30))<4 and abs(q(o['change']))<10 else 0
            recent=a[max(0,i-3):i+1]
            pos_steps=sum(1 for z in range(1,len(recent)) if recent[z]['price']>recent[z-1]['price'])
            rvol_up=sum(1 for z in range(1,len(recent)) if finite(recent[z]['rvol']) and finite(recent[z-1]['rvol']) and recent[z]['rvol']>recent[z-1]['rvol'])
            dollar=o['price']*o['volume']; floatrot=o['volume']/o['floatShares'] if o['floatShares'] else None
            base_features=[o['change'],safe_log(o['rvol']),safe_log(vv),q(short),q(rdelta),q(vvdelta),q(m5),q(m10),q(m30),q(m60),q(turn),q(curvature),q(longcurv),quiet,pos_steps,rvol_up,safe_log(dollar),safe_log(o['floatShares']),q(floatrot),q(o['gap']),q(o['sma20']),q(o['perfWeek']),session_code(o['session'])]
            rel=4 if mfe60>=40 else (3 if mfe60>=20 else (2 if mfe60>=10 else (1 if mfe60>=5 else 0)))
            obs.append({**o,'features':base_features,'m5':m5,'m10':m10,'m30':m30,'m60':m60,'short':short,'vv':vv,'rdelta':rdelta,'vvdelta':vvdelta,
                        'mfe30':mfe30,'mfe60':mfe60,'mfeDay':mfeday,'target':mfe60>=10,'relevance':rel,
                        'hit5':finite(mfe30) and mfe30>=5,'hit20':finite(mfeday) and mfeday>=20})
    feature_names=['change','logRvol','logVolumeVelocity','shortRate','rvolDeltaPerMin','volumeVelocityAccel','m5','m10','m30','m60','turn','curvature5v10','curvature10v30','quietBase','positiveSteps','rvolUpSteps','logDollarVolume','logFloat','floatRotation','gap','sma20','perfWeek','sessionCode']
    early=[x for x in obs if -20<=x['change']<10 and x['price']>=.15]
    return {'snapshots':snaps,'observations':obs,'early':early,'feature_names':feature_names,'dates':sorted(set(x['day'] for x in obs)),'parseFailures':parse_fail,'rawRows':raw_rows}

if __name__=='__main__':
    g=build()
    print(json.dumps({'snapshots':len(g['snapshots']),'rawRows':g['rawRows'],'observations':len(g['observations']),'early':len(g['early']),'dates':g['dates'],'parseFailures':g['parseFailures']},indent=2))
