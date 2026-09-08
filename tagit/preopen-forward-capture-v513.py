#!/usr/bin/env python3
"""Capture an append-only point-in-time pre-open universe/context snapshot.

The collector refuses stale discovery snapshots and refuses to write outside the
09:05-09:25 ET capture window unless --dry-run is used. Context fields are split
into causally verified-at-capture and unverifiable metadata. Unknown-timestamp
filings/news are never exposed as training-eligible context.

v5.13.2 hardening:
- Accept both ISO-8601 and RFC-2822 timestamps for timestamped news/context.
- A date-only SEC filing on the capture date is NOT assumed known at 09:15 ET;
  it requires an explicit timestamp. Prior-date filings may use their filed date.
"""
import argparse, json
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('tag/data')
DISC=ROOT/'discovery.json'
ENR=ROOT/'enrichment.json'
LEDGER=ROOT/'tagit-v513-preopen-forward-ledger.json'
NY=ZoneInfo('America/New_York')


def readj(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return d

def parse_dt(s):
    """Parse ISO-8601 first, then RFC-2822/email-date. Return aware datetime."""
    if not s:return None
    raw=str(s).strip()
    try:
        x=datetime.fromisoformat(raw.replace('Z','+00:00'))
        return x if x.tzinfo else x.replace(tzinfo=timezone.utc)
    except Exception:pass
    try:
        x=parsedate_to_datetime(raw)
        if x is None:return None
        return x if x.tzinfo else x.replace(tzinfo=timezone.utc)
    except Exception:return None

def age_minutes(now, dt):
    return (now-dt.astimezone(timezone.utc)).total_seconds()/60 if dt else None

def num(v):
    if v is None:return None
    try:
        s=str(v).replace('%','').replace(',','').strip()
        return float(s) if s else None
    except Exception:return None

def sec_known_at_capture(f, now, et):
    """Return (known, parsed_dt, reason) without inventing same-day filing time."""
    explicit=f.get('filedAtUTC') or f.get('timestampUTC')
    if explicit:
        fd=parse_dt(explicit)
        if fd is None:return False,None,'MISSING_OR_UNPARSEABLE_EXPLICIT_TIMESTAMP'
        return fd.astimezone(timezone.utc)<=now,fd,None if fd.astimezone(timezone.utc)<=now else 'FUTURE_TIMESTAMP'
    filed=f.get('filed')
    if not filed:return False,None,'MISSING_TIMESTAMP'
    raw=str(filed).strip()
    # Date-only SEC metadata does not establish what time a same-day filing became public.
    if len(raw)==10 and raw[4:5]=='-' and raw[7:8]=='-':
        try: d=datetime.fromisoformat(raw).date()
        except Exception:return False,None,'UNPARSEABLE_FILED_DATE'
        if d>=et.date():return False,None,'SAME_DAY_DATE_ONLY_NOT_CAUSALLY_VERIFIED'
        fd=datetime(d.year,d.month,d.day,tzinfo=NY)
        return True,fd,'PRIOR_DAY_DATE_ONLY'
    fd=parse_dt(raw)
    if fd is None:return False,None,'MISSING_OR_UNPARSEABLE_TIMESTAMP'
    known=fd.astimezone(timezone.utc)<=now
    return known,fd,None if known else 'FUTURE_TIMESTAMP'

def self_test():
    # News feeds in this repository commonly use RFC-2822.
    assert parse_dt('Sun, 06 Sep 2026 22:14:46 GMT') is not None
    assert parse_dt('2026-09-08T01:00:00+00:00') is not None
    now=datetime(2026,9,8,13,15,tzinfo=timezone.utc); et=now.astimezone(NY)
    known,_,reason=sec_known_at_capture({'filed':'2026-09-08'},now,et)
    assert known is False and reason=='SAME_DAY_DATE_ONLY_NOT_CAUSALLY_VERIFIED'
    known,_,_=sec_known_at_capture({'filed':'2026-09-07'},now,et)
    assert known is True
    known,_,_=sec_known_at_capture({'filedAtUTC':'2026-09-08T12:00:00Z'},now,et)
    assert known is True
    print('v5.13.2 timestamp causality self-test: OK')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dry-run',action='store_true'); ap.add_argument('--self-test',action='store_true'); args=ap.parse_args()
    if args.self_test:self_test(); return
    now=datetime.now(timezone.utc); et=now.astimezone(NY); minute=et.hour*60+et.minute
    d=readj(DISC,{}); e=readj(ENR,{})

    disc_snap=parse_dt(d.get('snapshotTimestampUTC') or d.get('updatedAt'))
    enr_snap=parse_dt(e.get('updatedAt') or e.get('snapshotTimestampUTC') or e.get('generatedAtUTC'))
    disc_age=age_minutes(now,disc_snap); enr_age=age_minutes(now,enr_snap)
    within=545<=minute<=565  # 09:05-09:25 ET
    disc_fresh=disc_age is not None and -2<=disc_age<=35
    # Enrichment may legitimately lag discovery, but future-dated or very stale context is not training-eligible.
    enr_eligible=enr_age is not None and -2<=enr_age<=180
    status='ELIGIBLE' if within and disc_fresh else ('OUTSIDE_CAPTURE_WINDOW' if not within else 'STALE_DISCOVERY_SOURCE')

    rows=[]; erows=e.get('rows') or {}; verified_news=verified_filings=unverifiable_news=unverifiable_filings=0
    future_news=future_filings=same_day_date_only_filings=0
    context_rows=0; context_error_rows=0
    for r in d.get('rows') or []:
        sym=str(r.get('Ticker') or r.get('Symbol') or '').upper().strip()
        if not sym:continue
        x=erows.get(sym) or {}; if_context=bool(x)
        if if_context:context_rows+=1
        if x.get('errors'):context_error_rows+=1

        news=[]; unknown_news=[]
        for n in x.get('news') or []:
            pd=parse_dt(n.get('published'))
            if pd is None:
                unverifiable_news+=1; unknown_news.append({'title':n.get('title'),'source':n.get('source'),'reason':'MISSING_OR_UNPARSEABLE_TIMESTAMP'}); continue
            if pd.astimezone(timezone.utc)<=now:
                verified_news+=1; news.append({'title':n.get('title'),'published':n.get('published'),'source':n.get('source')})
            else:
                future_news+=1; unknown_news.append({'title':n.get('title'),'source':n.get('source'),'reason':'FUTURE_TIMESTAMP'})

        filings=[]; unknown_filings=[]
        for f in x.get('filings') or []:
            known,fd,reason=sec_known_at_capture(f,now,et)
            if known:
                verified_filings+=1; filings.append({k:f.get(k) for k in ('form','filed','filedAtUTC','timestampUTC','accessionNumber') if k in f})
            else:
                if reason=='SAME_DAY_DATE_ONLY_NOT_CAUSALLY_VERIFIED':same_day_date_only_filings+=1
                elif reason=='FUTURE_TIMESTAMP':future_filings+=1
                else:unverifiable_filings+=1
                unknown_filings.append({'form':f.get('form'),'accessionNumber':f.get('accessionNumber'),'reason':reason})

        # Float/short fields come from the discovery snapshot itself, whose timestamp is verified above.
        row={
            'ticker':sym,'price':num(r.get('Price')),'changePct':num(r.get('Change')),
            'volume':num(r.get('Volume')),'avgVolume':num(r.get('Avg Volume')),'relativeVolume':num(r.get('Rel Volume')),
            'floatM':num(r.get('Float')),'outstandingM':num(r.get('Outstanding')),'shortFloatPct':num(r.get('Short Float')),
            'firstObservedUTC':r.get('_firstObservedTimestampUTC'),'firstObservedChangePct':num(r.get('_firstObservedChange')),
            'originClass':r.get('_originClass'),'lanes':r.get('_discoveryLanes') or [],
            'newsKnownAtCapture':news[:8] if enr_eligible else [],
            'filingsKnownAtCapture':filings[:8] if enr_eligible else [],
            'unverifiableContext':{'news':unknown_news[:4],'filings':unknown_filings[:4]},
            'contextTrainingEligible':bool(enr_eligible),
            'contextErrors':x.get('errors') or []
        }
        rows.append(row)

    n=max(1,len(rows))
    context_coverage=context_rows/n*100
    context_error_rate=context_error_rows/n*100
    context_integrity=bool(enr_eligible and context_coverage>=50 and context_error_rate<=50)
    manifest={
        'discoverySnapshotUTC':disc_snap.isoformat() if disc_snap else None,
        'discoveryAgeMinutes':round(disc_age,2) if disc_age is not None else None,
        'discoveryFresh':disc_fresh,
        'enrichmentSnapshotUTC':enr_snap.isoformat() if enr_snap else None,
        'enrichmentAgeMinutes':round(enr_age,2) if enr_age is not None else None,
        'enrichmentTrainingEligible':enr_eligible,
        'contextCoveragePct':round(context_coverage,2),
        'contextErrorRowPct':round(context_error_rate,2),
        'verifiedNewsItems':verified_news,
        'verifiedFilings':verified_filings,
        'unverifiableNewsItemsExcluded':unverifiable_news,
        'unverifiableFilingsExcluded':unverifiable_filings,
        'futureNewsItemsExcluded':future_news,
        'futureFilingsExcluded':future_filings,
        'sameDayDateOnlyFilingsExcluded':same_day_date_only_filings,
        'timestampParser':'ISO8601_OR_RFC2822; SEC same-day date-only fail-closed',
        'contextIntegrity':context_integrity
    }
    entry={'captureId':f"{et.date().isoformat()}|09:15|{now.strftime('%Y%m%dT%H%M%SZ')}",
           'capturedAtUTC':now.isoformat(),'capturedAtET':et.isoformat(),'targetCutoffET':'09:15',
           'sourceSnapshotUTC':disc_snap.isoformat() if disc_snap else None,'sourceAgeMinutes':round(disc_age,2) if disc_age is not None else None,
           'sourceManifest':manifest,'status':status,'universeCount':len(rows),'rows':rows if status=='ELIGIBLE' else [],
           'labelsPresent':False,'pointInTime':bool(status=='ELIGIBLE'),
           'universeIntegrityEligible':bool(status=='ELIGIBLE' and disc_fresh),
           'contextIntegrityEligible':bool(status=='ELIGIBLE' and context_integrity)}
    ledger=readj(LEDGER,{'schemaVersion':'5.13.2-forward-ledger','policy':'APPEND_ONLY_POINT_IN_TIME_NO_LABELS_AT_CAPTURE','captures':[]})
    ledger['schemaVersion']='5.13.2-forward-ledger'
    print(json.dumps({**entry,'rows':f'<{len(entry["rows"])} rows>'},ensure_ascii=False,indent=2))
    if args.dry_run:return
    if status!='ELIGIBLE':
        raise SystemExit(f'capture refused: {status}; sourceAgeMinutes={disc_age}')
    seen={c.get('captureId') for c in ledger.get('captures') or []}
    if entry['captureId'] not in seen:ledger.setdefault('captures',[]).append(entry)
    LEDGER.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':main()
