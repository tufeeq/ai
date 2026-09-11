#!/usr/bin/env python3
"""Publish only the current day's validated close report; never mix git dates."""
import json
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
def main():
    date=datetime.now(timezone.utc).astimezone(ZoneInfo('America/New_York')).date().isoformat()
    try:report=json.loads((ROOT/'tag/data/tagit10-post-session.json').read_text())
    except (OSError,ValueError):report={}
    valid=report.get('sessionDateET')==date and report.get('status')=='FINAL' and report.get('version')=='10.2'
    out={'version':'10.2','sessionDateET':date,'goalEarlyTop50RecallPct':95,'status':'FINAL' if valid else 'INSUFFICIENT_SAME_DAY_EVIDENCE','pre10RecallPct':report.get('earlyRecallPct') if valid else None,'achieved':False,'source':'tag/data/tagit10-post-session.json','note':'Prior multi-day git-history percentages are not valid accuracy measurements for 10.2.'}
    (ROOT/'tagit10-root-cause.json').write_text(json.dumps(out,indent=2)+'\n')
if __name__=='__main__':main()
