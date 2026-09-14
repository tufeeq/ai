"""Deterministic data/structure checks. These are screening rules, not a trained edge."""
import math

POLICY_VERSION = '10.3'
POLICY = {'minDollarVolume5m':100000, 'minDollarVolume15m':300000,
          'minActiveBars5m':4, 'minActiveBars15m':12,
          'maxDrawdownFromHighPct':2, 'maxQuoteAgeSeconds':120}
REASONS = {
 'INCOMPLETE_WINDOWS':'لم تكتمل 30 شمعة دقيقة متصلة ومغلقة',
 'LOW_LIQUIDITY':'قيمة التداول أو عدد الدقائق النشطة دون حد الفلترة',
 'FALLING_PRICE':'اتجاه السعر أو موقعه من متوسط التداول لا يؤيد الرصد المبكر',
 'EXTENDED_MOVE':'السعر بعيد عن قمة الجلسة أو تحرك 10% فأكثر',
 'UNSUPPORTED_INSTRUMENT':'نوع الورقة غير مؤكد كسهم',
 'UNVERIFIED_SESSION':'الجلسة مغلقة أو توقيتها غير متحقق',
 'CONFIRMATION_FAILED':'لم يحافظ السعر على مرجع التأكيد أو انقطعت اللقطات'
}

def finite(v):
    return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)

def closed_points(result, at):
    """Drop unfinished candles and irregular terminal quotes; preserve complete OHLC."""
    q=((result.get('indicators') or {}).get('quote') or [{}])[0]
    points={}
    for i,t in enumerate(result.get('timestamp') or []):
        if not finite(t) or t % 60 or t+60>at: continue
        def value(k):
            a=q.get(k) or []
            return a[i] if i<len(a) and finite(a[i]) else None
        o,h,l,c,v=[value(k) for k in ('open','high','low','close','volume')]
        if any(x is None or x<=0 for x in (o,h,l,c)) or not l<=min(o,c)<=max(o,c)<=h:continue
        if v is not None and v<0:v=None
        points[t]=(t,c,v,o,h,l)
    return sorted(points.values())

def structure(pts):
    end=pts[-1][0]
    recent=[p for p in pts if end-900<p[0]<=end]
    last5=[p for p in pts if end-300<p[0]<=end]
    prior=[p for p in pts if end-1800<p[0]<=end-900]
    complete=(len(recent)==15 and len(prior)==15 and
              all(b[0]-a[0]==60 for a,b in zip(prior+recent,(prior+recent)[1:])))
    def dollars(rows):
        return sum(p[1]*p[2] for p in rows) if rows and all(p[2] is not None for p in rows) else None
    volume=sum(p[2] for p in pts) if all(p[2] is not None for p in pts) else None
    vw=sum(p[1]*p[2] for p in pts)/volume if volume and volume>0 else None
    high=max(p[4] for p in pts)
    return {'windowsComplete':complete,'dollarVolume5m':dollars(last5),
            'dollarVolume15m':dollars(recent),'activeBars5m':sum((p[2] or 0)>0 for p in last5),
            'activeBars15m':sum((p[2] or 0)>0 for p in recent),
            'sessionVwapProxy':vw,'drawdownFromHighPct':100*(1-pts[-1][1]/high),
            'barClosed':True,'priceBasis':'CLOSED_1M_CLOSE',
            'barCloseTimestamp':end+60}

def screen(metrics, price, change, ret5, ret15, instrument, active_session):
    blocks=[]
    if not metrics['windowsComplete']:blocks.append('INCOMPLETE_WINDOWS')
    if (metrics['dollarVolume5m'] is None or metrics['dollarVolume5m']<POLICY['minDollarVolume5m']
        or metrics['dollarVolume15m'] is None or metrics['dollarVolume15m']<POLICY['minDollarVolume15m']
        or metrics['activeBars5m']<4 or metrics['activeBars15m']<12):blocks.append('LOW_LIQUIDITY')
    if (ret5 is None or ret5<0 or ret15 is None or ret15<0 or change is None or change<0
        or metrics['sessionVwapProxy'] is None or price<metrics['sessionVwapProxy']):blocks.append('FALLING_PRICE')
    if change is not None and change>=10 or metrics['drawdownFromHighPct']>2:blocks.append('EXTENDED_MOVE')
    if instrument!='EQUITY':blocks.append('UNSUPPORTED_INSTRUMENT')
    if not active_session:blocks.append('UNVERIFIED_SESSION')
    return blocks
