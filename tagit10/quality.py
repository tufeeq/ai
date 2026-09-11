"""Frozen forward evidence. Labels use subsequent closed 1m closes, not trade fills."""
from datetime import datetime, timezone
from math import sqrt
VERSION='10.2'
TARGET_RECALL=95
STAGES=('EARLY','ACTIONABLE','CONFIRMED')
def ts(v):
    try:return datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError,AttributeError):return None

def freeze_signals(state, rows, observed_at):
    ledger=state.setdefault('signalLedger',{})
    for x in rows:
        if not x.get('quoteFresh') or x.get('stage') not in STAGES:continue
        # One frozen observation per symbol, stage and version each day.
        key=f"{VERSION}:{x['symbol']}:{x['stage']}"
        if key in ledger:continue
        ledger[key]={'version':VERSION,'symbol':x['symbol'],'stage':x['stage'],
            'signalAtUTC':observed_at,'quoteTimestampUTC':x['quoteTimestampUTC'],
            'entryReference':x['price'],'changeAtSignalPct':x.get('changePct'),
            'score':x['score'],'sessionDateET':state['sessionDateET'],
            'label':'PENDING','horizonMinutes':30,'targetPct':3,'stopPct':-2}

def evaluate_signals(state, rows, observed_at):
    end=ts(observed_at); by_symbol={x['symbol']:x for x in rows}
    for signal in state.get('signalLedger',{}).values():
        if signal['label']!='PENDING':continue
        start=ts(signal['signalAtUTC']);deadline=start+1800
        if end<deadline+60:continue
        x=by_symbol.get(signal['symbol']);points=x.get('_points',[]) if x else []
        # Exclude the bar spanning the decision and any still-open bar.
        bars=sorted({p[0]:p[1] for p in points if start<p[0]<=deadline and p[0]+60<=end}.items())
        complete=(len(bars)>=28 and bars[0][0]-start<=90 and deadline-bars[-1][0]<=90
                  and max((b[0]-a[0] for a,b in zip(bars,bars[1:])),default=0)<=90)
        if not complete:
            if end>deadline+900:signal['label']='UNSCORABLE';signal['labelReason']='Missing complete subsequent minute closes'
            continue
        label='TIMEOUT';hit=None
        for t,p in bars:
            ret=(p/signal['entryReference']-1)*100
            if ret<=signal['stopPct']:label='STOP_FIRST';hit=t;break
            if ret>=signal['targetPct']:label='TARGET_FIRST';hit=t;break
        signal.update(label=label,evaluatedAtUTC=observed_at,outcomeAtUTC=datetime.fromtimestamp(hit,timezone.utc).isoformat() if hit else None,
            closeReturnPct=round((bars[-1][1]/signal['entryReference']-1)*100,4))

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
        groups[stage]={'signals':len(xs),'resolved':len(resolved),'targetFirst':won,
            'pending':sum(x['label']=='PENDING' for x in xs),'unscorable':sum(x['label']=='UNSCORABLE' for x in xs),
            'precisionPct':round(100*won/len(resolved),2) if resolved else None,'wilson95LowerPct':wilson(won,len(resolved))}
    return {'version':VERSION,'targetEarlyRecallPct':TARGET_RECALL,'achieved':False,
        'status':'FORWARD_VALIDATION_PENDING','earlyRecallPct':None,'byStage':groups,
        'definition':'Target +3% before -2% within 30 minutes after signal, subsequent closed 1m closes only. No fees/slippage; not executable win rate.',
        'recallDefinition':'Top 50 positive session gainers detected before +10%, same-day frozen signals only. Finalized after close.'}
