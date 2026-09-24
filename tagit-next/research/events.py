"""Availability-ordered event clock and bitemporal universe.

Event time cannot substitute for receipt time. Historical feeds without receipt
timestamps require an explicitly labelled latency scenario before ingestion.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import isfinite


def time(value):
    t=datetime.fromisoformat(value.replace('Z','+00:00')) if isinstance(value,str) else value
    if not isinstance(t,datetime) or t.tzinfo is None:
        raise ValueError('Timezone-aware timestamp required')
    return t.astimezone(timezone.utc)


@dataclass(frozen=True)
class Event:
    event_at: datetime
    available_at: datetime
    sequence: int
    kind: str
    instrument_id: str
    payload: dict

    def __post_init__(self):
        object.__setattr__(self,'event_at',time(self.event_at))
        object.__setattr__(self,'available_at',time(self.available_at))
        if self.available_at < self.event_at:
            raise ValueError('Event cannot arrive before it occurs')
        if isinstance(self.sequence,bool) or not isinstance(self.sequence,int) or self.sequence<0:
            raise ValueError('Nonnegative ingestion sequence required')
        if self.kind=='BAR' and self.available_at<self.event_at+timedelta(minutes=1):
            raise ValueError('Incomplete minute bar cannot be exposed')


def replay(events,start,end,on_event,on_scan,interval_seconds=30):
    """Events received exactly on a tick are processed before that tick's scan.

Callbacks receive only the available prefix. This is a deterministic clock, not
an assertion that the live scanner or historical HTTP latencies were reproduced.
"""
    start,end=time(start),time(end)
    if end<start or interval_seconds<=0:
        raise ValueError('Invalid replay interval')
    if len({e.sequence for e in events})!=len(events):
        raise ValueError('Duplicate ingestion sequence')
    pending=sorted(events,key=lambda e:(e.available_at,e.sequence))
    cursor=0; tick=start; output=[]
    while tick<=end:
        while cursor<len(pending) and pending[cursor].available_at<=tick:
            on_event(pending[cursor]);cursor+=1
        output.append(on_scan(tick))
        tick+=timedelta(seconds=interval_seconds)
    return output


class Universe:
    """Point-in-time share count and listing membership, keyed by stable ID.

Rows require explicit publication and effective times; no fallback to today's
asset list. Missing metadata is recorded as unknown, not presumed ineligible.
"""
    def __init__(self,rows):
        self.rows=list(rows)
        for r in self.rows:
            for key in ('effective_at','available_at','published_at'):
                time(r[key])
            if time(r['published_at'])>time(r['available_at']):
                raise ValueError('Metadata received before publication')
            if not r.get('instrument_id') or not r.get('source'):
                raise ValueError('Stable instrument ID and source required')

    def at(self,instrument_id,at,price):
        at=time(at)
        eligible=[r for r in self.rows if r['instrument_id']==instrument_id
                  and time(r['effective_at'])<=at and time(r['available_at'])<=at]
        if not eligible:return {'status':'UNKNOWN_METADATA','market_cap':None}
        r=max(eligible,key=lambda x:(time(x['effective_at']),time(x['available_at'])))
        shares=r.get('shares_outstanding')
        if r.get('listing_status')!='LISTED' or r.get('exchange')!='NASDAQ':
            return {'status':'OUTSIDE_LISTING','market_cap':None}
        if (isinstance(shares,bool) or not isinstance(shares,(int,float)) or not isfinite(shares) or shares<=0
                or isinstance(price,bool) or not isinstance(price,(int,float)) or not isfinite(price) or price<=0
                or r.get('share_basis')!='COMPANY_TOTAL_ON_PRICE_BASIS'):
            return {'status':'UNKNOWN_CAP','market_cap':None}
        cap=shares*price
        return {'status':'ELIGIBLE' if cap<100_000_000 else 'OUTSIDE_CAP',
                'market_cap':cap,'metadata_available_at':r['available_at'],'source':r['source']}
