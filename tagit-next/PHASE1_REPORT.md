# Phase 1 — reproducible measurement foundation

As of 2026-09-24. **Partial infrastructure, not completed validation.** No signal
rules changed, no model approved, no paid resource provisioned, no holdout opened.
This report concerns `quote-service/src/scanner.mjs` discovery-1 and the current
NASDAQ under-USD-100M objective. The earlier Python under-USD-1B hypotheses and
their research results remain separate and rejected.

## Reproduce offline

With Python 3.12+ and Node 24, from repository root:

```sh
make -C tagit-next phase1
```

The command tests the new components, checks source SHA-256 hashes, replays all
saved discovery baseline events using the unchanged bar detector, checks every
original report field and event (not just averages), then byte-checks the new
metrics report and public evidence JSON. `make -C tagit-next phase1-refresh`
regenerates derived reports after an intentional research change; it never
updates frozen hashes. Neither command downloads data or accesses holdout.

## Baseline reproduced, not rehabilitated

| Measure | Result |
|---|---:|
| Saved bars, including extended hours | 164,248 |
| Regular-session bars used by legacy audit | 150,148 |
| Previously selected symbols / sessions | 96 / 10 |
| Signals | 322 |
| Evaluable / incomplete | 84 / 238 |
| Resolved mean 30-minute close return after assumed cost | -1.4258583700865177% |
| All-signal expectancy | Unknown |
| New triple-barrier historical results | Not yet measured |

The old outcome buys the next minute's open, sells at the last close of 30
contiguous future minutes and subtracts 0.5 percentage points. It is not the
conditional live plan, a quote fill, or a stop/target outcome. Its `mean_max_drawdown`
field is intrawindow adverse excursion, **not portfolio maximum drawdown**.
The full baseline remains unmodified in `data/discovery-audit.json`.
The regenerated rules object additionally contains two existing extension-category
metadata fields; all original fields and the entire event ledger must match.

`data/phase1-baseline.json` adds win/loss statistics, profit factor, MAE/MFE
quantiles, New York hour groups and a deterministic session-block bootstrap.
That interval is conditional on the 84 observed outcomes; it does not repair
238 missing labels or selection bias. Ten sessions are too few for a confident
generalization. Portfolio drawdown is null without allocation and a marked equity
path. Missing outcomes are never coded as zero, a loss, or a safe no-trade.

## Implemented components

- `research/events.py`: separate market event and availability clocks, completed
  minute guard, deterministic 30-second scans, bitemporal listing/share metadata
  using stable instrument IDs. A later delisting does not erase an earlier listing.
- `research/discovery-replay.mjs`: uses the actual unchanged `analyzeBars` at
  30-second ticks, applies historical bar revisions only on arrival, and preserves
  cooldowns. **Bar-detector adapter only**: it does not reproduce the live
  cross-sectional shortlist, HTTP request timing, split service, trade/quote gates
  or news enrichment. Its outputs are not a full live-scanner backtest.
- `research/execution.py`: independent long-only quote triple-barrier component.
  Pending setups invalidate on an observed stop break during entry latency.
  Entry buys ask plus impact; exit sells bid minus impact, then charges per-side
  fees. This pays the spread explicitly; no extra half-spread charge is added.
  Volume must have ended and become available before execution. Size and
  participation gates apply. Exit triggers latch; deadline precedes a later
  target. Missing/truncated/error/gapped coverage yields an unknown return.
- `research/metrics.py`: descriptive metrics, session bootstrap, explicit-equity
  drawdown helper, Bonferroni adjustment requiring total attempted family size.
- `research/splits.py`: chronological validation-window checks, purge labels
  crossing fold boundaries, fail-closed prerequisites for a profitability claim.
- `research/protocol.json`: freezes detector/evidence, identifies all ten known
  sessions as exposed, records sensitivity assumptions and keeps holdout locked.

Execution assumptions (not measured/calibrated): one-second latency, three-second
quote age, 30-minute horizon and at most three seconds to observe a time exit;
quantity at most 1% of lagged minute volume and within displayed quote size.
Per-side impact is `20 * sqrt(quantity / lagged_volume)` basis points in the base
scenario; fee is 1 bp per side. Low/stress scenarios are declared separately.
These settings are an infrastructure example, not selected improvements. Displayed
quotes do not guarantee fills, queue priority, hidden liquidity or full execution.
Unknown coverage must be reconciled against pagination, outages and source
entitlements by an ingestion adapter; a boolean assertion alone is not evidence.
Python datetime has microsecond resolution; source sequence must retain ordering
when original timestamps have finer precision. MAE/MFE are observed bid excursions,
not proof of unobserved intratick extremes.

## Data source and remaining prerequisites

Use saved consolidated Alpaca SIP data for this no-spend implementation. IEX-only
data cannot replace it as a whole-market benchmark. No new market requests were
made. SIP quotes alone do not provide a survivorship-free historical company
universe or point-in-time market capitalization.

Before a 12-month experiment can start we need an auditable source inventory of
NASDAQ listing/delisting/merger history, stable identifiers, published share counts,
corporate actions and original filing availability. Company-total shares and price
must use the same split/share-class basis; today's Finviz capitalization is not a
fallback. The metadata component requires these fields but does not supply or
certify them. Receipt/revision timestamps, calendar sessions, halts and calibrated
execution costs also remain unresolved. A latency assumption must be labelled as
a scenario when receipt time is unavailable.

Next engineering step: implement ingestion coverage manifests and the full scanner
replay adapter, then audit an outcome-independent point-in-time inventory. Freeze
calendar walk-forward windows and an untouched final holdout only after coverage
is established. Proposed folds are six training months followed by one validation
month, purging crossing labels. No dates have been invented or performance measured
for those folds. No Phase 2 feature tuning is permitted yet.

Final acceptance still requires at least 500 evaluable independent holdout signals,
positive after-cost expectancy with a 95% interval above zero, stable walk-forward
performance, concentration checks and complete accounting for failed hypotheses
and missing outcomes. Code checks do not establish any of these conditions.

## Interface and publication

`web/phase1-evidence.json` is generated from the same audit and checked by the same
command. `web/phase1.js` displays its date, complete denominator, negative result
and incomplete status in the RTL methodology section, separately from live prices.
These changes are on the research branch/PR; this report does not claim they were
deployed to the public production page.
