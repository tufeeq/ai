"""Conservative long-only triple-barrier quote approximation, never actual fills."""
from dataclasses import dataclass
from datetime import timedelta
from math import isfinite,sqrt

from .events import time


@dataclass(frozen=True)
class Policy:
    latency_seconds: float=1
    quote_age_seconds: float=3
    horizon_seconds: float=1800
    exit_wait_seconds: float=3
    fee_bps_per_side: float=1
    impact_bps_at_full_participation: float=20
    max_participation: float=.01

    def __post_init__(self):
        values=vars(self)
        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not isfinite(v) or v<0 for v in values.values()):
            raise ValueError('Finite nonnegative execution parameters required')
        if self.horizon_seconds<=0 or not 0<self.max_participation<=1:
            raise ValueError('Invalid horizon or participation cap')


def valid_quote(q):
    return (all(isinstance(q.get(k),(int,float)) and not isinstance(q[k],bool)
                and isfinite(q[k]) and q[k]>0 for k in ('bid','ask','bid_size','ask_size'))
            and q['bid']<=q['ask'])


def simulate(setup,quotes,policy=Policy(),coverage=None):
    """Inputs include lagged_volume and volume_available_at for impact costs.

Stops latch during entry latency. Missing/capped coverage cannot create a
negative finding or timeout. A triggered exit stays pending through insufficient
size; it cannot turn into a later target after a rebound. No partial fills assumed.
    """
    start,expiry=time(setup['at']),time(setup['expires_at'])
    qty=setup['quantity']; stop=setup['stop']; target=setup['target']
    if (any(isinstance(setup[k],bool) or not isinstance(setup[k],(int,float)) or not isfinite(setup[k]) for k in ('stop','entry','max_entry','target'))
            or expiry<=start or not isinstance(qty,int) or isinstance(qty,bool) or qty<=0
            or not 0<stop<setup['entry']<=setup['max_entry']<target):
        raise ValueError('Invalid conditional setup')
    rows=sorted(quotes,key=lambda q:(time(q['available_at']),q['sequence']))
    if len({q['sequence'] for q in rows})!=len(rows):raise ValueError('Duplicate quote sequence')
    for q in rows:
        if time(q['available_at'])<time(q['event_at']):raise ValueError('Quote precedes event')
    base={'id':setup['id'],'symbol':setup['symbol'],'status':'UNKNOWN_COVERAGE',
          'net_pct':None,'entry_at':None,'exit_at':None,'mae_pct':None,'mfe_pct':None,
          'approved_for_live':False,'evidence':'QUOTE_APPROXIMATION'}
    filled=None; deadline=None; trigger=None; last_event=None; excursions=[]
    def complete(until):
        return (coverage is not None and coverage.get('complete') is True
                and not coverage.get('truncated') and not coverage.get('error') and not coverage.get('gaps')
                and time(coverage['start'])<=start and time(coverage['end'])>=until)
    def finish(status,**kw):
        return {**base,'status':status,**kw,
                'mae_pct':min(0,min(excursions)) if excursions else None,
                'mfe_pct':max(0,max(excursions)) if excursions else None}
    def executable(q,at,side):
        volume=q.get('lagged_volume')
        if isinstance(volume,bool) or not isinstance(volume,(int,float)) or not isfinite(volume) or volume<=0:return None
        if not q.get('volume_available_at') or time(q['volume_available_at'])>at:return None
        if not q.get('volume_end_at') or time(q['volume_end_at'])>time(q['volume_available_at']):return None
        if qty>q[side+'_size'] or qty/volume>policy.max_participation:return None
        impact=policy.impact_bps_at_full_participation*sqrt(qty/volume)/10000
        return q[side]*(1+impact if side=='ask' else 1-impact)
    for q in rows:
        at,et=time(q['available_at']),time(q['event_at'])
        if at<start or et<start:continue
        if last_event is not None and et<last_event:continue
        last_event=et
        if not filled and at>expiry:break
        if filled and at>deadline+timedelta(seconds=policy.exit_wait_seconds):break
        if not valid_quote(q) or (at-et).total_seconds()>policy.quote_age_seconds:continue
        if not filled:
            if q['bid']<=stop:return finish('INVALIDATED_BEFORE_ENTRY')
            if at<start+timedelta(seconds=policy.latency_seconds):continue
            price=executable(q,at,'ask')
            if price is None or not setup['entry']<=price<=setup['max_entry']:continue
            filled=price;deadline=at+timedelta(seconds=policy.horizon_seconds)
            base.update(entry_at=at.isoformat(),entry_ask=q['ask'],entry_price=price)
            excursions.append((q['bid']/filled-1)*100)
            continue
        excursions.append((q['bid']/filled-1)*100)
        if trigger is None:
            # Do not take a post-deadline target/stop instead of the time barrier.
            trigger='TIMEOUT' if at>=deadline else 'STOP' if q['bid']<=stop else 'TARGET' if q['bid']>=target else None
        if trigger is None:continue
        if not complete(at):return finish('UNKNOWN_COVERAGE')
        price=executable(q,at,'bid')
        if price is None:continue
        fee=policy.fee_bps_per_side/10000
        net=(price*(1-fee)/(filled*(1+fee))-1)*100
        return finish(trigger,net_pct=net,exit_at=at.isoformat(),exit_bid=q['bid'],exit_price=price,
                      deadline=deadline.isoformat(),exit_delay_seconds=max(0,(at-deadline).total_seconds()))
    if filled:return finish('UNKNOWN_EXIT')
    return finish('NO_ENTRY' if complete(expiry) else 'UNKNOWN_COVERAGE')
