# Historical session-mover learning: measured findings

**The historical collection and training completed. The fitted model failed its
trading-use validation. It is connected only as an explicitly unvalidated research
model, with future observations recorded separately.**

## Data collected

| Measure | Result |
|---|---:|
| Common equities requested | 2,000 |
| Equities successfully downloaded | 1,997 |
| Valid five-minute OHLCV bars | 6,496,632 |
| Collection window | July 17–September 11, 2026 |
| Sessions producing eligible learning examples | 35 |
| Eligible feature checkpoints, including unknown outcomes | 323,589 |
| Checkpoints reaching a remaining +20% before −5% | 149 |
| Observed stock-days rising at least 20% from open to high | 631 |
| Observed stock-days rising at least 50% from open to high | 120 |

The stock-day counts include historical warmup sessions and describe the downloaded
sample. They do not mean that TAGit10 identified those stocks before the rise.
The cohort was sampled before viewing returns, but uses today's surviving listings.
It does not establish coverage of every historical U.S. stock.

## Patterns observed before possible moves

These are descriptive first occurrences per stock/day in the training period,
not the model's test alerts. Success means a further 20% before a 5% decline after
the delayed entry. Unknown outcomes remain in the precision denominator.

| Pattern | Stock/day occurrences | Target hits | Conservative hit rate |
|---|---:|---:|---:|
| Rising price with cumulative volume at least 2× the same time on prior days | 3,128 | 15 | 0.480% |
| Retention near the high and above the OHLC-volume VWAP proxy | 7,561 | 5 | 0.066% |
| Volume acceleration at least 2× with a positive 15-minute return | 8,681 | 4 | 0.046% |
| Range compression with volume expansion above the VWAP proxy | 2,719 | 0 | 0.000% |

Same-time unusual volume had the highest observed hit rate among the named
patterns. The absolute rate remained low. A volume surge or tight range alone
does not justify calling a stock an early entry opportunity. These groups overlap
and occur at different times, so their ratios are not causal effects.

For illustration, WYHG on August 10 and MGN on July 29 had a measurable early
20% setup associated with unusual same-time volume in the historical replay.
Those cases belong to the development period and are hindsight examples, not
proof of successful live detection. The case library includes failures and cases
where no measurable early setup existed under the declared rules.

## Model test result

The candidate family was fixed to regularized logistic regression and a small
nonlinear gradient boosting model. Parameters and the alert threshold were selected
on calibration dates, not on the test result.

Training: July 24–August 21. Calibration: August 25–September 1. Test: September
3, 4, 8, 9, 10, and 11. August 24 and September 2 were whole-session embargo dates.
Prior TAGit experiments inspected overlapping historical dates; this is a
retrospective chronological test, not fresh prospective evidence.

| Test measure | Result |
|---|---:|
| First-stock alerts across six test sessions | 15 |
| Remaining +20% targets reached before −5% | 0 |
| Known failures | 13 |
| Unknown outcomes due to missing future bars | 2 |
| Mean simulated net return, 13 scorable alerts, 0.4% cost | −3.9244% |
| Mean simulated net return, 1% cost | −4.5244% |
| Median simulated net return | −5.4% |
| Worst observed adverse excursion | −12.4031% |
| Observed 20% mover stock-days in the test period | 61 |
| Those mover days caught by a successful model alert | 0 |

The model underperformed the volume-plus-momentum baseline on mean scorable
return (−3.9244% versus −0.7188%). Both had zero 20% target hits. Missing-bar
outcomes also prevent a clean execution conclusion. These results reject this
model as a trading recommendation engine.

## Discovery limitations exposed

In the 50 largest observed open-to-high moves, 38 had no eligible checkpoint and
only seven had an early scorable +20%-before−5% setup. This does not isolate one
cause: the 30-minute warmup, already extended prices, insufficient prior-session
baselines, liquidity limits, missing bars, and drawdowns can each prevent a setup.
The three largest sampled cases also include initial-history warmup dates.

The current dataset cannot establish that all missing bars were trading halts.
No historical news, float, order-book, or executable bid/ask data was invented to
fill those gaps. Bar highs are observed prints, not proof of achievable exits.

## What TAGit10 now does

The research view exposes the actual history, patterns, test results, and case
library. Covered stocks can display the frozen model's score and pattern
explanation, including an explicit failed-validation notice. The score does not
grant entry permission and is not a calibrated probability.

The scanner records qualifying research observations before the assumed delayed
entry, retaining their original model ID and timestamp across session changes.
Nightly collection updates the archive and evaluates later outcomes. Frozen-model
replay and actually recorded alerts remain separate. The model stays frozen for
ten later completed sessions before another fit; no model is automatically
promoted to trading use.

Machine-readable evidence: [learning report](https://github.com/tufeeq/ai/blob/main/tagit10/reports/explosive-learning.json),
[all test alerts and missed movers](https://github.com/tufeeq/ai/blob/main/tagit10/reports/explosive-audit.json),
[largest sampled cases](https://github.com/tufeeq/ai/blob/main/tagit10/reports/explosive-cases.json),
and [methodology](https://github.com/tufeeq/ai/blob/main/tagit10/reports/explosive-methodology.md).
