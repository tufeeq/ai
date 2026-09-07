#!/usr/bin/env python3
"""TAGit v5.12.2: feed-aware repair of v5.12.1 fixed-cutoff pre-open validator.

This revision preserves v5.12.1's frozen chronological protocol while correcting a
data-quality error: Yahoo extended-hours volume can be zero/missing, so it must not
be used as a hard liquidity gate. Eligibility instead uses only the prior completed
regular session. A missingness indicator is added, and day-block bootstrap uncertainty
is reported.
"""
import pathlib

src = pathlib.Path("tagit/preopen-fixed-cutoff-v5121.py").read_text(encoding="utf-8")
repls = [
("TAGit v5.12.1 robust fixed-cutoff pre-open validator.", "TAGit v5.12.2 feed-aware fixed-cutoff pre-open validator."),
("OUT=ROOT/'tagit-v5121-preopen-fixed-cutoff.json'; CASES=ROOT/'tagit-v5121-preopen-cases.json'",
 "OUT=ROOT/'tagit-v5122-preopen-fixed-cutoff.json'; CASES=ROOT/'tagit-v5122-preopen-cases.json'"),
("TAGit-v5.12.1-preopen-research", "TAGit-v5.12.2-preopen-research"),
("'preBarCount','minutesFromLastBarToCutoff']",
 "'preBarCount','minutesFromLastBarToCutoff','preVolumeObserved']"),
("        # Sparse premarket is valid evidence; do not require 3 bars. Require only minimal traded notional.\n"
 "        if not (.15<=c<=30):diag['priceGate']+=1;prev.append(d);prev=prev[-22:];continue\n"
 "        if c*pv<3000:diag['notionalGate']+=1;prev.append(d);prev=prev[-22:];continue",
 "        # Extended-hours volume is often zero/missing in Yahoo. Never interpret that as zero liquidity.\n"
 "        if not (.15<=c<=30):diag['priceGate']+=1;prev.append(d);prev=prev[-22:];continue\n"
 "        p1d=sum(((z['h']+z['l']+z['c'])/3)*z['v'] for z in p1)\n"
 "        if p1d<100000:diag['priorRegularLiquidityGate']+=1;prev.append(d);prev=prev[-22:];continue\n"
 "        if pv>0:diag['premarketVolumeObserved']+=1\n"
 "        else:diag['premarketVolumeMissing']+=1"),
("        prior_pre=[sum(z['v'] for z in q['pre']) for q in prev[-20:] if q['pre']];medpv=float(np.median(prior_pre)) if prior_pre else max(pv,1);prv=pv/max(medpv,1)",
 "        prior_pre=[sum(z['v'] for z in q['pre']) for q in prev[-20:] if q['pre'] and sum(z['v'] for z in q['pre'])>0]\n"
 "        medpv=float(np.median(prior_pre)) if prior_pre else max(pv,1)\n"
 "        pv_feature=pv if pv>0 else medpv\n"
 "        prv=pv_feature/max(medpv,1)"),
("math.log1p(pv)/20,math.log1p(c*pv)/20,", "math.log1p(pv_feature)/20,math.log1p(c*pv_feature)/20,"),
("min(len(pre),64)/64,max(0,CUTOFF-lastmin)/315]",
 "min(len(pre),64)/64,max(0,CUTOFF-lastmin)/315,float(pv>0)]"),
("'schemaVersion':'5.12.1'", "'schemaVersion':'5.12.2'"),
("'schemaVersion':'5.12.1-cases'", "'schemaVersion':'5.12.2-cases'"),
("'populationDiagnostics':dict(diag)", "'dataQualityPolicy':'zero/absent extended-hours volume is missingness; liquidity eligibility uses prior completed regular session','populationDiagnostics':dict(diag)"),
("def stat(s,univ):",
 "def day_bootstrap_lower(s,reps=1000,seed=5122):\n"
 "    if not s:return None\n"
 "    by=defaultdict(list)\n"
 "    for x in s:by[x['day']].append(x)\n"
 "    ds=list(by)\n"
 "    if len(ds)<3:return None\n"
 "    rnd=random.Random(seed);vals=[]\n"
 "    for _ in range(reps):\n"
 "        pick=[rnd.choice(ds) for _ in ds];xx=[x for d in pick for x in by[d]]\n"
 "        vals.append(100*sum(x['action10'] for x in xx)/len(xx))\n"
 "    return float(np.quantile(vals,.10))\n\n"
 "def stat(s,univ):"),
("    w={x['day'] for x in univ if x['action10']};cw={x['day'] for x in s if x['action10']};return {'count':n,'tp':tp,'precisionPct':round(100*tp/n,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'activeDays':len(days),'medianLeadMin':round(float(np.median(leads)),1) if leads else None,'top3DailyPrecisionPct':round(100*sum(x['action10'] for x in top)/len(top),2) if top else None,'medianRemainingUpsidePct':round(float(np.median(ups)),2) if ups else None,'winnerDayRecallPct':round(100*len(cw)/len(w),2) if w else None}",
 "    w={x['day'] for x in univ if x['action10']};cw={x['day'] for x in s if x['action10']};bl=day_bootstrap_lower(s);return {'count':n,'independentTickerDays':n,'tp':tp,'precisionPct':round(100*tp/n,2) if n else None,'wilsonLower90Pct':round(wilson(tp,n),2) if n else None,'dayBlockBootstrapLower90Pct':round(bl,2) if bl is not None else None,'activeDays':len(days),'medianLeadMin':round(float(np.median(leads)),1) if leads else None,'top3DailyPrecisionPct':round(100*sum(x['action10'] for x in top)/len(top),2) if top else None,'medianRemainingUpsidePct':round(float(np.median(ups)),2) if ups else None,'winnerDayRecallPct':round(100*len(cw)/len(w),2) if w else None}"),
("'future regular bars labels only','no current snapshot context backfilled historically'",
 "'future regular bars labels only','extended-hours zero volume treated as missingness','liquidity gate uses prior completed regular session only','no current snapshot context backfilled historically'"),
("'future regular bars labels only','chronological 70/15/15 split'",
 "'future regular bars labels only','extended-hours zero volume treated as missingness','liquidity gate uses prior completed regular session only','chronological 70/15/15 split'")
]
for old,new in repls:
    if old not in src:
        raise RuntimeError("v5.12.2 patch anchor missing: "+old[:100])
    src=src.replace(old,new,1)
exec(compile(src,"tagit/preopen-fixed-cutoff-v5122.generated.py","exec"),{"__name__":"__main__"})
