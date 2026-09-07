#!/usr/bin/env python3
"""Remove shadow-learning records that were created on verified market-closed dates.

This is a data-integrity repair, not model tuning. A prior direct Rich Feed push could
bypass the calendar guard and create false pre-market events on a holiday. Verified
holiday/weekend records cannot represent live market opportunities and are removed.
"""
import json,pathlib,runpy
from datetime import datetime

LEDGER=pathlib.Path('tag/data/tagit-shadow-learning-ledger.json')
cal=runpy.run_path('tagit/market-calendar-guard.py')
HOLIDAYS=set()
for m in (cal.get('HOLIDAYS') or {}).values():HOLIDAYS.update(m.keys())

def read(p,d):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except:return d

def invalid_day(d):
    if not d:return False
    if d in HOLIDAYS:return True
    try:return datetime.fromisoformat(d).weekday()>=5
    except:return False

ledger=read(LEDGER,{})
records=ledger.get('records') or [];before=len(records)
removed=[r for r in records if invalid_day(r.get('tradingDateET'))]
ledger['records']=[r for r in records if not invalid_day(r.get('tradingDateET'))]
ledger['calendarIntegrityRepair']={'recordsBefore':before,'recordsAfter':len(ledger['records']),'recordsRemoved':len(removed),'removedTradingDates':sorted({r.get('tradingDateET') for r in removed if r.get('tradingDateET')}),'reason':'VERIFIED_MARKET_CLOSED_DATE_CANNOT_BE_LIVE_EVENT'}
LEDGER.write_text(json.dumps(ledger,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps(ledger['calendarIntegrityRepair']))
