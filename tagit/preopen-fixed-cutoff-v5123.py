#!/usr/bin/env python3
"""TAGit v5.12.3: day-block robust selection layered on feed-aware v5.12.2.

Keeps the exact v5.12.2 causal population/model construction, but changes calibration
selection so the chosen configuration must survive calendar-day resampling rather than
winning on pooled ticker-day precision. Holdout remains untouched until after freeze.
"""
import pathlib

src = pathlib.Path("tagit/preopen-fixed-cutoff-v5122.py").read_text(encoding="utf-8")

# Keep v5.12.2 data/feed repairs, but write separate evidence and identify this run.
src = src.replace("tagit-v5122-preopen-fixed-cutoff.json", "tagit-v5123-preopen-fixed-cutoff.json")
src = src.replace("tagit-v5122-preopen-cases.json", "tagit-v5123-preopen-cases.json")
src = src.replace("TAGit-v5.12.2-preopen-research", "TAGit-v5.12.3-preopen-research")
src = src.replace("'schemaVersion':'5.12.2'", "'schemaVersion':'5.12.3'")
src = src.replace("'schemaVersion':'5.12.2-cases'", "'schemaVersion':'5.12.3-cases'")

needle = "for old,new in repls:\n"
extra = '''# v5.12.3: select configurations by worst calendar-day uncertainty, not pooled precision alone.\nrepls.append((\n"      a=stat(sel(e1,(th,di,up)),e1);b=stat(sel(e2,(th,di,up)),e2);p1=a['precisionPct'] or 0;p2=b['precisionPct'] or 0;lo=min(a['wilsonLower90Pct'] or 0,b['wilsonLower90Pct'] or 0);support=min(a['count'],b['count']);utility=lo*100+min(p1,p2)*20-abs(p1-p2)*15+min(support,50)*3\\n      if support<8:utility-=3000",\n"      a=stat(sel(e1,(th,di,up)),e1);b=stat(sel(e2,(th,di,up)),e2)\\n      p1=a['precisionPct'] or 0;p2=b['precisionPct'] or 0\\n      pooled_lo=min(a['wilsonLower90Pct'] or 0,b['wilsonLower90Pct'] or 0)\\n      block_lo=min(a.get('dayBlockBootstrapLower90Pct') or 0,b.get('dayBlockBootstrapLower90Pct') or 0)\\n      support=min(a['count'],b['count']); active=min(a['activeDays'],b['activeDays'])\\n      utility=block_lo*135+pooled_lo*45+min(p1,p2)*12-abs(p1-p2)*22+min(support,60)*3+active*60\\n      if support<20:utility-=4500\\n      if active<4:utility-=4000"\n))\nrepls.append((\n"'verdict':'RESEARCH_COMPLETE_NOT_90'",\n"'selectionPolicy':'maximize worst calibration day-block lower bound with support/day-coverage and drift penalties','verdict':'RESEARCH_COMPLETE_NOT_90'"\n))\n'''
if needle not in src:
    raise RuntimeError("v5.12.3 insertion anchor missing")
src = src.replace(needle, extra + needle, 1)
exec(compile(src, "tagit/preopen-fixed-cutoff-v5123.generated.py", "exec"), {"__name__":"__main__"})
