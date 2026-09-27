# Quote-anchored decision and same-time order repair — 27 September 2026

**Result: the repair resolves one additional case, but eight of twelve cases still
have an unknown outcome. No expectancy or profitable rule is established.** The
detector, entry gates, public scanner and final holdout are unchanged.

## Frozen question and chronology

The first twelve chronological BASE development signals from 24 August were already
selected before their SIP quote retrieval. The decision clock is the first qualified
post-signal SIP quote, not a future candle open. Its observed ask fixes a 30-second
100-share entry band; delays are 1 and 3 seconds. Target is +10%, stop is -3%, and
the horizon is 45 minutes after a simulated entry.

The primary protocol was frozen in `8cabd962e02834eb8009e218b8f5562c84ef0868`.
Its report then retained all twelve cases and all four delay/cost scenarios. The
raw conservative parser stopped at the first conflicting provider record sharing
an event timestamp. That left nine unknown cases in each scenario, including one
case without any qualified decision quote.

After seeing that missingness—not the returns—selected the measurement problem,
the order-repair protocol was frozen in
`0985ee6f58b0b90ae5b4399d54f3090a1ae60835` before the repaired outcomes were
calculated. No new market request or case selection was made.

## Conservative order-invariant repair

For every event timestamp, exact duplicate records are removed without adding
their displayed sizes. Distinct records are reduced to the adverse envelope for a
long position: minimum bid, maximum ask, and minimum bid/ask sizes. A fill is
allowed only when every possible impact-adjusted ask in the group is inside the
frozen entry band. A stop is recognized if any bid touches it; a target is
recognized only if every bid touches it. A group spanning both barriers is unknown.

Invalid groups still stop coverage. A stop or target may wait at most three seconds
from its own trigger for qualified exit capacity; it cannot wait until the 45-minute
horizon and then exit after a rebound. Historical event time remains only an
explicit arrival-time scenario. No queue position or actual fill is claimed.

## Full denominator

Every fixed latency/cost scenario produced the same classification counts:

| Classification | Cases |
|---|---:|
| Simulated entries | 9 |
| Target with modeled exit | 1 |
| Stop with modeled exit | 1 |
| Unknown exit coverage/capacity | 7 |
| No entry | 2 |
| No qualified decision quote | 1 |

The repair changes the unknown count from **9 to 8** per scenario. The newly
resolved path is BTCT target-first; NUAI is the resolved stop. The other seven
simulated entries remain unknown, so their missing outcomes are not set to zero,
wins or losses. The two modeled returns are deliberately not averaged: an average
of resolved cases would not be full-sample expectancy. Stress costs change their
individual modeled returns but not classifications.

The inverse diagnostic found no `NO_ENTRY` case with a later observed +10% bid
before -3%. This is only a result for two no-entry cases on one exposed session;
it is not evidence that the entry gates capture market-wide rockets.

## Reproduce

From the repository root, Python 3.12+ and Node 24:

```sh
make -C tagit-next quote-anchored
make -C tagit-next verify
```

The command verifies both the preserved raw report and the repaired report byte for
byte. Unit tests perturb input order, duplicate records, mixed entry prices, opposing
barriers, invalid groups and trigger-relative exit timing.

## Limits and next step

This is twelve exposed cases from one development session in the existing
96-symbol sample. It is not a historical NASDAQ under-$100M universe, an independent
validation set, a forward trial, or proof of profitability. The result does not
replace the negative 322-signal baseline or the rejected feature studies.

Next, freeze a new quote-anchored sample from later qualified development dates and
retrieve only missing entry-to-exit intervals. Apply this same normalization without
retuning. Discovery recall for later +10%/+20% movement must remain a separate
metric from executable entry/exit outcomes. The final holdout stays unopened until
the measurement path is sufficiently complete.
