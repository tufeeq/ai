"""Forward research outcomes from subsequent complete OHLC bars; never broker fills."""
from datetime import datetime, timezone
from math import sqrt
from screening import finite
VERSION='10.3'
TARGET_RECALL=95
STAGES=('EARLY','ACTIONABLE','CONFIRMED')
ASSUMED_COST_PCT=0.4

def ts(v):
    try:return datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError,AttributeError):return None

def freeze_signals(state, rows, observed_at):
    ledger=state.setdefault('signalLedger',{})
    for x in rows:
        if not x.get('quoteFresh') or x.get('stage') not in STAGES:continue
        if x.get('screeningPassed') is not True or x.get('barClosed') is not True:continue
        key=f"{VERSION}:{state['sessionDateET']}:{x.get('session','regular')}:{x['symbol']}:{x['stage']}"
        if key in ledger:continue
        ledger[key]={'version':VERSION,'symbol':x['symbol'],'stage':x['stage'],
            'signalAtUTC':observed_at,'quoteTimestampUTC':x['quoteTimestampUTC'],
            'entryReference':x['price'],'changeAtSignalPct':x.get('changePct'),
            'score':x['score'],'sessionDateET':state['sessionDateET'],
            'session':x.get('session','regular'),'label':'PENDING','horizonMinutes':30,
            'targetPct':3,'stopPct':-2,'assumedRoundTripCostPct':ASSUMED_COST_PCT,
            'entryMethod':'NEXT_FULL_MINUTE_OPEN','priceBasis':'OHLC_RESEARCH_ONLY'}

def evaluate_signals(state, rows, observed_at):
    end=ts(observed_at);by_symbol={x['symbol']:x for x in rows}
    for signal in state.get('signalLedger',{}).values():
        if signal.get('version')!=VERSION or signal['label']!='PENDING':continue
        start=ts(signal['signalAtUTC'])
        # First full minute strictly after the actual decision.
        first=(int(start)//60+1)*60
        deadline=first+1800
        if end<deadline:continue
        x=by_symbol.get(signal['symbol']);points=x.get('_points',[]) if x else []
        by_time={p[0]:p for p in points if len(p)>=6 and first<=p[0]<deadline and p[0]+60<=end}
        complete=all(t in by_time for t in range(first,deadline,60))
        if not complete:
            if end>=deadline+900:
                signal.update(label='UNSCORABLE',labelReason='Missing subsequent complete OHLC minutes',evaluatedAtUTC=observed_at)
            continue
        bars=[by_time[t] for t in range(first,deadline,60)]
        if any(not all(finite(v) and v>0 for v in (p[1],p[3],p[4],p[5])) or
               not p[5]<=min(p[1],p[3])<=max(p[1],p[3])<=p[4] for p in bars):
            signal.update(label='UNSCORABLE',labelReason='Invalid OHLC',evaluatedAtUTC=observed_at);continue
        entry=bars[0][3];stop=entry*(1+signal['stopPct']/100);target=entry*(1+signal['targetPct']/100)
        label='TIMEOUT';hit=None;exit_price=bars[-1][1];ambiguous=False
        for p in bars:
            t,c,v,o,h,l=p[:6]
            # Gap through a stop fills at the worse open. Both barriers: stop first.
            if o<=stop:label='STOP_FIRST';exit_price=o;hit=t;break
            if l<=stop:
                label='STOP_FIRST';exit_price=stop;hit=t;ambiguous=h>=target;break
            if h>=target:label='TARGET_FIRST';exit_price=target;hit=t;break
        signal.update(label=label,evaluatedAtUTC=observed_at,
            entryObservedPrice=entry,entryAtUTC=datetime.fromtimestamp(first,timezone.utc).isoformat(),
            outcomeAtUTC=datetime.fromtimestamp(hit,timezone.utc).isoformat() if hit else None,
            assumedExitPrice=exit_price,ambiguousBarStopFirst=ambiguous,
            grossReturnPct=round((exit_price/entry-1)*100,4),
            netReturnPct=round((exit_price/entry-1)*100-signal['assumedRoundTripCostPct'],4),
            closeReturnPct=round((bars[-1][1]/entry-1)*100,4))

def wilson(success,total):
    if not total:return None
    z=1.95996398454;p=success/total
    return round(100*(p+z*z/(2*total)-z*sqrt((p*(1-p)+z*z/(4*total))/total))/(1+z*z/total),2)

def quality_summary(state):
    ledger=[x for x in state.get('signalLedger',{}).values() if x.get('version')==VERSION]
    groups={}
    for stage in STAGES:
        xs=[x for x in ledger if x['stage']==stage]
        resolved=[x for x in xs if x['label'] in ('TARGET_FIRST','STOP_FIRST','TIMEOUT')]
        won=sum(x['label']=='TARGET_FIRST' for x in resolved)
        nets=[x['netReturnPct'] for x in resolved if finite(x.get('netReturnPct'))]
        groups[stage]={'signals':len(xs),'resolved':len(resolved),'targetFirst':won,
            'stopFirst':sum(x['label']=='STOP_FIRST' for x in resolved),
            'timeouts':sum(x['label']=='TIMEOUT' for x in resolved),
            'pending':sum(x['label']=='PENDING' for x in xs),
            'unscorable':sum(x['label']=='UNSCORABLE' for x in xs),
            'sessions':len({x['sessionDateET'] for x in resolved}),
            'precisionPct':round(100*won/len(resolved),2) if resolved else None,
            'wilson95LowerPct':wilson(won,len(resolved)),
            'meanNetReturnPct':round(sum(nets)/len(nets),4) if nets else None}
    return {'version':VERSION,'achieved':False,'status':'RESEARCH_ONLY',
        'targetEarlyRecallPct':TARGET_RECALL,'earlyRecallPct':None,'byStage':groups,
        'definition':'Next full minute open; +3% before -2% within 30 complete OHLC minutes. Stop first if both barriers hit; adverse stop gaps included; assumed 0.4% round-trip cost. Not executable win rate.',
        'limitations':'Same-symbol, stage and session observations are dependent. Wilson bounds are descriptive, not proof of a trading edge. Missing windows remain unscorable.',
        'recallDefinition':'Top 50 positive session gainers detected before +10%; distinct from profitable trading.'}

def merge_evidence(a,b):
    """Retain prior-day and current frozen outcomes across both scheduled writers."""
    newest=max((a,b),key=lambda s:s.get('sessionDateET') or '')
    out=dict(newest);out['symbols']=dict(newest.get('symbols',{}))
    if a.get('sessionDateET')==b.get('sessionDateET'):
        for source in (a,b):
            for symbol,rec in source.get('symbols',{}).items():
                old=out['symbols'].get(symbol)
                if old is None or rec.get('lastSeenUTC','')>old.get('lastSeenUTC',''):out['symbols'][symbol]=rec
    ledger={}
    for source in (a,b):
        for key,sig in source.get('signalLedger',{}).items():
            old=ledger.get(key)
            if old is None or sig['signalAtUTC']<old['signalAtUTC'] or (sig['signalAtUTC']==old['signalAtUTC'] and old['label']=='PENDING'):
                ledger[key]=sig
    out['signalLedger']=ledger
    observations={}
    for source in (a,b):
        for key,item in source.get('explosiveObservations',{}).items():
            old=observations.get(key)
            if old is None or item['observedAtUTC']<old['observedAtUTC']:
                observations[key]=item
    out['explosiveObservations']=dict(sorted(observations.items())[-2000:])
    return out

if __name__=='__main__':
    import json,sys
    from pathlib import Path
    source,target=map(Path,sys.argv[1:3])
    prior=json.loads(target.read_text()) if target.exists() else {}
    target.write_text(json.dumps(merge_evidence(json.loads(source.read_text()),prior),separators=(',',':')))
