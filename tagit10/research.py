"""Shared 5-minute, closed-bar feature contract for research and shadow inference."""
import math
FEATURES=['return5','return15','return30','range15','volumeRatio15','logDollarVolume15','vwapDistance','range60']
def feature_vector(bars):
    if len(bars)<12:return None
    b=bars[-12:]
    if any(y['t']-x['t']!=300 for x,y in zip(b,b[1:])):return None
    if any(any(not math.isfinite(float(x[k])) for k in ['o','h','l','c','v']) or x['l']<=0 or x['v']<0 or x['h']<x['l'] for x in b):return None
    p=b[-1]['c'];recent=b[-3:];v=sum(x['v'] for x in recent);prior=sum(x['v'] for x in b[-6:-3]);total=sum(x['v'] for x in b)
    if prior<=0 or total<=0:return None
    vwap=sum((x['h']+x['l']+x['c'])/3*x['v'] for x in b)/total
    return [(p/b[-2]['c']-1)*100,(p/b[-4]['c']-1)*100,(p/b[-7]['c']-1)*100,
            (max(x['h'] for x in recent)/min(x['l'] for x in recent)-1)*100,
            min(50,v/prior),math.log1p(sum(x['c']*x['v'] for x in recent)),(p/vwap-1)*100,
            (max(x['h'] for x in b)/min(x['l'] for x in b)-1)*100]
def outcome(future):
    if len(future)!=6 or any(y['t']-x['t']!=300 for x,y in zip(future,future[1:])):return None
    entry=future[0]['o']
    if entry<=0:return None
    # If both barriers occur in the same 5m bar, assign stop first conservatively.
    for b in future:
        if b['l']<=entry*.98:return {'y':0,'returnPct':(min(b['o'],entry*.98)/entry-1)*100-.4,'outcome':'STOP_FIRST'}
        if b['h']>=entry*1.03:return {'y':1,'returnPct':2.6,'outcome':'TARGET_FIRST'}
    return {'y':0,'returnPct':(future[-1]['c']/entry-1)*100-.4,'outcome':'TIMEOUT'}
