# Continuation versus reversal — 24 September 2026

**A new reproducible label audit, not a profitable model.** The preregistered
three-rising-closes feature is not adopted: it retains only 3 of 11 observed
target-first cases and excludes the other 8. No live detector, plan, trading
recommendation or production strategy changed. No final holdout was opened.

## Reproduce

From the repository root, with Python 3.12+:

```sh
make -C tagit-next continuation
```

This tests causal features, barrier ordering, missing-data handling and the quote
probe, then regenerates and byte-compares both reports offline. Full regression:
`make -C tagit-next verify` (also requires Node 24). No account keys are needed.

Protocol and complete 322-event selection were committed **before** calculating
these labels in [31c062d](https://github.com/tufeeq/ai/commit/31c062d566da6943a72938cc6755594436abdf0d).
All ten dates (24 August–4 September) were already exposed; preregistration does
not make them independent. The underlying 96-symbol sample spans the original
under-$1B sample and is **not** a historical NASDAQ under-$100M eligible universe.
That population requirement remains unfulfilled. No current-cap filtering is
used to falsely suggest it was met.

## What the new label measures

- Entry proxy: the first minute open at or after signal time plus one second,
  rounding up to the next minute. It never uses the open of an already-started
  minute. Missing entry minutes remain unknown; later opens do not replace them.
- Gross target +10%, gross stop -3%, maximum 60 minutes after entry. Session close
  terminates the horizon earlier and is reported separately as `SESSION_END`.
  Signals too late for this entry policy are `NO_SESSION_ENTRY`, not trades.
- Each contiguous positive-volume minute is examined in order. An opening gap
  precedes later extrema; a stop gap uses the opening price, not the stop level.
  If both levels occur in the same bar with neither breached at its open, their
  order is unknown. A missing minute before resolution is unknown. A target seen
  **after** a stop cannot rescue the case. Data after a resolved outcome is unused.
- OHLC opens, threshold prices and final closes are **price proxies**, not fills.
  Spreads, actual latency, market impact, quantity, halts and quote coverage remain
  unverified. Intraminute times are intervals; terminal-bar highs/lows are not
  mislabelled as pre-exit MAE/MFE.
- Features only use completed regular-session bars available at detection. Saved
  final historical bars require an explicit end-of-minute availability scenario.
  Actual historical receipt times and revisions remain unavailable. Tests verify
  that future prices and late-arriving revisions cannot change prior features.

The sole feature is `c1 < c2 < c3` for the last three completed minute closes.
It is a candle-persistence hypothesis, not measured buy pressure. No fitted
thresholds, combined filters, retuning or probabilistic model were introduced.

## Full denominators and result

| Outcome under the new bar policy | All signals | Three rising closes | Excluded |
|---|---:|---:|---:|
| Signals | 322 | 153 | 169 |
| Target first | 11 | 3 | 8 |
| Stop first | 42 | 21 | 21 |
| Full 60-minute timeout | 22 | 13 | 9 |
| Earlier session close | 43 | 21 | 22 |
| No session entry under this policy | 25 | 13 | 12 |
| Unknown entry minute | 34 | 16 | 18 |
| Missing path minute | 144 | 65 | 79 |
| Same-bar order ambiguous | 1 | 1 | 0 |

118 bar outcomes have a return proxy; **179 outcomes remain unknown/ambiguous**,
and 25 have no entry under this policy. Do not omit either group when interpreting
the result. All 322 features were observable under the stated availability scenario.

| Assumed total cost (percentage points) | All 118 resolved proxies | Selected 58 resolved proxies |
|---|---:|---:|
| 0.5 | -0.4687% | -0.8307% |
| 1.0 | -0.9687% | -1.3307% |
| 2.0 | -1.9687% | -2.3307% |

**These are conditional diagnostic means, not executable expectancy or profit.**
The old -1.4259% baseline is preserved and cannot be compared as an improvement:
entry time, exit policy, horizon and evaluable population all changed.
The runner always leaves `executable_expectancy_pct` null.

The selected-minus-comparator proxy mean difference is -0.3620 percentage points;
the exploratory 95% paired session-bootstrap interval is [-0.8262, +0.0473].
Target-first rates among known classifications (including no-session-entry as
non-target) are 11/143 vs 3/71. Their difference is -3.4670 percentage points,
with an exploratory interval [-5.6043, -1.1054]. This is **not confirmatory
significance**: only ten exposed session blocks, overlapping events, previous
research attempts and informative missingness remain. No adjusted p-value or
independent inference is claimed.

Full-population target-rate identification bounds are **3.42%–59.01%** (all) and
**1.96%–55.56%** (selected), obtained by assigning all unknowns failure vs success.
These are missing-data bounds, **not confidence intervals or calibrated odds**.
The observed 3/11 retention is not market-wide recall or top-30 mover capture.

47 formerly unscorable legacy events now have a bar outcome under the different
policy; 13 formerly scorable events are now unknown. Neither count is a trading
accuracy gain. Every event and first missing minute is retained in
`data/continuation-development.json`, with public-sized evidence in
`web/continuation-evidence.json` and descriptive results for every session.

## Targeted Alpaca check — five new requests, no repeated download

Six cases were frozen by missingness category and SHA256(signal ID), not by
return, in [9bf0e8a](https://github.com/tufeeq/ai/commit/9bf0e8a155d276205a7e704c162c3cb46c8b4af2)
before retrieving new SIP quotes. The ambiguous BTCT minute already had cached
quotes. The other five one-minute requests returned **23 quotes**; both empty
responses were preserved. No retry or paid subscription change occurred.

| Case / first problematic minute UTC | Quote observations | Interpretation |
|---|---:|---|
| BTCT 24 Aug 14:05 | 4,399 cached | Valid quotes present; cached source capped before minute end |
| SGLY 1 Sep 18:33 | 2 new | Quotes exist despite missing entry bar; quoted spread about 2.84% of bid |
| AKTX 28 Aug 15:42 | 0 | Unknown; not proof of no liquidity or a halt |
| FWRD 1 Sep 14:20 | 12 new | Quotes exist during a missing candle minute |
| NKLR 4 Sep 15:07 | 0 | Unknown; not proof of no liquidity or a halt |
| BTCT 31 Aug 18:22 | 9 new | Quotes exist during a missing candle minute |

The important measurement finding: **a missing candle does not prove there was no
quote or possible entry**. Conversely, a valid displayed quote does not prove a
fill. The 2.84% SGLY spread also demonstrates why a constant 0.5% round-trip cost
is not an execution model for every case. This observation does not justify tuning
the rule on SGLY. No candle label is overwritten and no extra trade result is
claimed by this short-window probe. Size units are kept as supplied, with no
assumed round-lot conversion or capacity inference.

Raw responses, requests, source hashes and the reproducible probe report are
saved under `data/continuation-probe/`, `research/continuation-probe-inputs.json`
and `data/continuation-quote-probe.json`.

## Decision and specific continuation point

Keep the three-rising-closes filter out of live detection. Preserve both its
negative diagnostic and the 179 unknown outcomes. Do not reverse or retune the
feature using these exposed data.

Next: acquire the **full entry-to-exit quote paths of the same six frozen cases**,
reusing the cached BTCT prefix, and pair them with dated lot-size metadata and
causal lagged volume. Retain pagination, receipt/latency assumptions and errors,
with a maximum 20 new market requests per cycle and a saved cursor checkpoint.
The current one-minute probe does not resolve any complete execution outcome.
Only after the measurement audit and historical universe qualification should
the unchanged feature be tested on genuinely independent sessions. Final holdout
opens remain zero; >=500 final evaluable signals and positive independent
after-cost expectancy remain unmet. No accuracy percentage is ready for display.
