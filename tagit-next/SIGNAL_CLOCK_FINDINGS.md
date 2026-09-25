# Original-signal entry audit — 25 September 2026

**Result: five cases have no entry under the frozen scenario; one remains unknown.**
This is not a market-wide finding that there were no opportunities. No simulated
position opened, so there is no exit return, expectancy or cost-performance result
to report. No live detector or entry threshold was changed.

## Question and preregistration

The previous six-case study anchored prices at the following minute. Its snapshot
capacity checks did not establish an executable entry at the original signal.
The old discovery ledger's `entry` field is a **future minute open**, not an input
available when the signal was detected. It must not silently become a prior order
level. This audit instead verifies `signal_price` against the last completed bar's
close and sets all levels before observing subsequent quotes.

Protocol committed before new market requests:
`2d4a8e1c92bf41a8123fb32752ecd27fc4764ed2`.
All six existing missingness-selected cases remain in all four scenarios. The
dates and previous outcomes are exposed development data, not independent holdout.
The frozen experiment is a +10%/-3%/60-minute diagnostic, **not the live scanner's
actual 2R plan** or a retrospective claim about orders the user could have placed.

## Data and policy

- Reused BTCT August 24's saved original-entry quotes and FWRD September 1's saved
  validation window. Reused all six stored later paths and hashed minute bars.
- Retrieved only four missing signal-to-following-minute intervals, including the
  bridge after the 30-second entry expiry for any earlier filled position.
- **4 market requests, 121 new SIP quote records, no errors or capped responses.**
  Every request and original structured response is retained. No repeated downloads.
- Quantity: **100 shares**, direct post-transition SIP units. Entry floor: last
  completed close; impact-adjusted ask ceiling: that close × 1.001. Entry expires
  after 30 seconds. Stop: close × 0.97; target: close × 1.10.
- Delay scenarios: 1 and 3 seconds before entry eligibility. Base costs: 1 bp fee
  per side and 20 bp × sqrt(quantity / lagged minute volume) impact. Stress costs:
  2 bp and 40 bp. These are **uncalibrated assumptions**, not measured broker costs.
- Reused unchanged `research.execution.simulate`, including bid/ask spread,
  the existing 1% volume-participation limit, displayed quantity, stop latching
  and 3-second fresh-timeout requirement. The horizon is 60 minutes after entry.
- Historical event times stand in for receipt times; bar volume is assumed
  available at the end of its minute, with at most 90 seconds of age. True receipt,
  corrections, queue position and exit-order latency remain unverified.

The adapter cannot traverse a missing retrieval interval or invent an ordering
between conflicting same-microsecond updates. Such a conflict ends the qualified
prefix. Equivalent updates are not summed into extra liquidity. A missing volume
that could affect an earlier entry remains `UNKNOWN_ENTRY_LIQUIDITY`; a later good
quote must not erase that uncertainty. The frozen shared engine remains unchanged.

## Results: complete six-case denominator

| Scenario | Cases | No scenario entry | Unknown | Simulated entries | Resolved returns |
|---|---:|---:|---:|---:|---:|
| 1-second delay, base cost | 6 | 5 | 1 | 0 | 0 |
| 1-second delay, stress cost | 6 | 5 | 1 | 0 | 0 |
| 3-second delay, base cost | 6 | 5 | 1 | 0 | 0 |
| 3-second delay, stress cost | 6 | 5 | 1 | 0 | 0 |

These are four scenarios on six cases, **not 24 independent observations**.
No average among resolved cases, success rate or profitable configuration is selected.
There are no fills on which to measure an empirical latency/cost effect.

| Case | Original signal UTC | 1-second/base diagnostic | Outcome |
|---|---|---|---|
| BTCT · Aug 24 | 14:04:00 | 157 updates above the entry ceiling after the delay; conflicting sizes at 14:04:05.673949 truncate the qualified prefix | Unknown coverage/order |
| SGLY · Sep 1 | 18:32:00 | No new quote update in the 30-second entry window; first retrieved update at +54.193501 seconds | No scenario entry |
| AKTX · Aug 28 | 15:40:00 | 29 post-delay updates fail the volume cap | No scenario entry |
| FWRD · Sep 1 | 14:18:00 | 38 post-delay updates fail the volume cap | No scenario entry |
| NKLR · Sep 4 | 15:04:00 | 3 updates precede the delay; the remaining update fails the volume cap | No scenario entry |
| BTCT · Aug 31 | 17:44:00 | 7 updates above the entry ceiling | No scenario entry |

Per-quote reasons are an ordered diagnostic, not mutually exclusive economic
explanations: a volume-rejected quote can also have an unacceptable price.
No quote update does not prove a resting quote or liquidity did not exist. The
result is limited to the fresh-update policy, not the possibility of all trading.
BTCT August 31 also has a later ordering conflict, but it occurs after the entry
window, so it cannot change that window's qualified negative finding.

## Reproduction and verification

From repository root, Python 3.12+ and Node 24:

```
make -C tagit-next signal-clock
make -C tagit-next verify
```

The first command tests the adapter and verifies exact reproduction of
`data/signal-clock-report.json`, including hashes of the frozen protocol, provider
responses and reused data. The second also reproduces all earlier reports.
Local verification passed **175 Python tests and 66 Node tests**. The new 13 tests
cover the original-signal clock, future-open exclusion, future/incomplete volume,
same-time ambiguity, capped boundaries, gap coverage, quantity/cost handling and
missing-volume uncertainty. These software checks are not trading validation.

## Cumulative limits and next step

The earlier negative baseline, rejected hypotheses, price indications and missing
exit ledger are unchanged. Different entry clocks cannot be compared as if they
were a measured improvement in the same strategy. There are still no verified
fills, calibrated probabilities or independent profitability evidence. This
research retains the older 96-stock sampled universe and its capitalization/
survivorship limitations; it is not the complete historical NASDAQ <$100M universe.
Tool inventory still exposes no dedicated Alpaca historical-news tool. No news
query was performed: catalyst coverage remains UNKNOWN, not 'no news'.

The current retrieval manifest is complete. Re-fetching these same windows will
not repair missing ordering or actual receipt times. Next, preregister a broader
sample and a **quote-anchored decision-time plan** separately from this close-price
diagnostic. Timestamp the quote used to set levels, then apply entry delay after
that decision; never label a future quote as known at the original signal. Keep
this negative/unknown experiment frozen and do not loosen its thresholds after
seeing the outcomes. Live rules and the final holdout remain untouched.
