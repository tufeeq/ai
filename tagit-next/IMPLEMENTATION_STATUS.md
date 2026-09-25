# Implementation status — 2026-09-24

## Research update — 2026-09-25

The original-signal adapter and four frozen quantity/delay/cost scenarios are now
reproducible. Four new requests supplied 121 SIP quotes; two entry caches were
reused. All scenarios have five no-entry cases and one unknown, with no simulated
positions or returns. This is not the live scanner's 2R plan and not evidence that
market opportunities were absent. Earlier results and live rules remain unchanged.
See [SIGNAL_CLOCK_FINDINGS.md](SIGNAL_CLOCK_FINDINGS.md). No paid action, deployment,
holdout evaluation or strategy promotion occurred in this cycle.

## Latest correction: share units and quantity qualification

The earlier round-lot assumption was incorrect for post-November-2025 Alpaca SIP.
The paper observer now uses versioned share units with no lot multiplier. All six
frozen paths were audited at 1/100/1,000 shares with existing volume-cap assumptions;
at 100 shares four cases fail the volume cap, one has two qualified snapshots and
one remains unknown. Three exit prices remain missing, including two entry-cap
failures. No verified fills or performance improvement. See
[SHARE_CAPACITY_FINDINGS.md](SHARE_CAPACITY_FINDINGS.md); zero new data requests.

## Latest continuation: full SIP path retrieval

The frozen six-case path audit added 85,688 quote records in 18 requests, with
five complete API intervals and one provider-error checkpoint. Three stop-first
price indications and three unknown timeout prices; **zero verified execution
outcomes**. No calibration, live-rule change or profitability claim. The AKTX
indication is an immediate spread loss, not a later fall or approved scanner trade.
See [CONTINUATION_PATH_FINDINGS.md](CONTINUATION_PATH_FINDINGS.md) for all cases,
reproduction and the precise BTCT retrieval cursor. Prior reports remain frozen.

## Latest research cycle: continuation ordering

Added a separately preregistered +10% target / -3% stop / 60-minute bar diagnostic
and a causal three-rising-closes comparison on all 322 exposed events. 118 bar
return proxies, 25 no-session-entry cases and 179 unknown/ambiguous outcomes are
retained. The feature retained only 3 of 11 observed targets and is not approved.
Five frozen Alpaca minute-window requests returned 23 quotes; a sixth case reused
4,399 cached quotes. Four of six problematic windows contained valid quotes, but
no full execution outcome was resolved. See [CONTINUATION_FINDINGS.md](CONTINUATION_FINDINGS.md)
for denominators, conditional results, protocols and the exact continuation point.
Reproduce with `make -C tagit-next continuation`. No independent claim, production
strategy change, new subscription or final holdout access.

Hosting authorization has progressed since the activation inventory below: the
user approved the My Workspace selection and $9.50/month basic Render compute
plus 10GB disk. The new-service form was prepared, but publication of the observer
still awaits secure Alpaca key entry and actual deployment/restart verification.
This research cycle does not imply those operational steps have completed.

Scope: current NASDAQ <$100M discovery-1. No signal rules changed. No subscription,
order, paid service or strategy promotion. Historical evidence frontend published
at the user's request; see [PUBLICATION.md](PUBLICATION.md) for scope and verification.

## What is implemented versus proven

| Phase | Implemented in this branch | Still required before completion |
|---|---|---|
| 1 — validation | Exact negative baseline reproduction; event/availability clocks; full unchanged scanner response-tape adapter; SQLite response hashes; execution/metrics/split components | >=12-month PIT listing/share universe including delisted securities, source receipt/revision times or labelled latency scenarios, calibrated costs, walk-forward runs and independent evidence |
| 2 — improvements | Two preregistered development ablations, causal time/ATR/RVOL features, paired cluster intervals, full missing-data ledger and RTL comparison table; neither filter approved | Phase 1 data qualification, 20-session RVOL inputs, independent comparisons and final holdout >=500 evaluable signals |
| 3 — infrastructure | File-backed SQLite, optional background regular-session scans, provider WebSocket, browser push, paper evaluator reusing `research.execution.simulate`, health/error reporting | Workspace confirmation, paid persistent host approval, runtime keys, restart/disk verification, qualified quote-unit provenance and subscription coverage; load/retention/backups need operational verification |
| 4 — Sharia | Server-side live Zoya adapter; sandbox rejected; stale, ambiguous and incomplete reports remain UNKNOWN | Live key/licensing, public display approval, underlying financial-statement date (not supplied by Basic response) |
| 5 — interface | RTL historical performance and Phase 2 evidence published on 2026-09-24; source/date, missing outcomes and main-page link verified. Stream/fallback additions remain in research branch | Activate verified observation server and its matching client; real forward observations, calibrated probabilities and similar-signal statistics do not yet exist |

**No final configuration or profitable strategy has been selected.** Null effects
mean NOT TESTED, not zero or success. The two development effects are conditional
differences, not proven gains. The final holdout remains unopened. The old
322/84/238 baseline and negative mean remain unchanged. See
[PHASE2_FINDINGS.md](PHASE2_FINDINGS.md); reproduce with `make -C tagit-next phase2`.

## One-command verification

Python 3.12+ and Node 24, from repository root:

```sh
make -C tagit-next verify
```

This includes all research unit tests, service and browser transport tests, syntax
checks and exact baseline/report regeneration checks. CI also builds the mixed
Node/Python container and smoke-tests its credential-free health endpoint. No
external market key or live feed is needed to run these checks. Synthetic tests
of data paths are not live performance validation.

## Live-data and persistence design

One `createScanner` instance serves the HTTP endpoint and the optional background
loop, preserving its existing in-flight coalescing/cache. Every scan and first
signal is stored idempotently; later prices cannot overwrite the initial signal.
HTTP market responses retain request and availability timestamps, SHA-256 and
pagination tokens. Headers/secrets are not stored. Raw market events and stream
subscription/disconnection statuses retain receipt ordering.

`research/scanner-trace.mjs` also records actual clock reads and asynchronous
request/response ordering, including concurrent requests and cache hits. Offline
`node tagit-next/research/replay-journal.mjs PATH.sqlite` replays each process segment
through the unchanged scanner and compares its output to saved scans. Missing or
unfinished traces fail explicitly. The separate `scanner-tape.mjs` adapter remains
an explicitly zero-processing-latency availability scenario, not a substitute for
this captured-clock replay. Neither adapter turns current metadata into PIT history.

Background scans align to 30-second boundaries and do not overlap. They use the
provider's exchange clock and run only while `is_open` is true (regular session,
including the provider calendar's holidays/early closes). This does **not** claim
background premarket/aftermarket scanning. Browser-triggered scans retain their
existing behavior. Feed events can still arrive outside the regular session.

Alpaca WebSocket feeds one server connection; `/api/events` pushes to browsers
using SSE/EventSource. Browser-to-server is SSE, **not a WebSocket**. The provider
is WebSocket, so subscribed prices no longer require five-second quote polling.
The fixed 20-symbol polling limit is not applied to stream delivery. Account
limits still apply: default 30 symbols, explicitly reported when partial.
Unsubscribed/disconnected symbols retain the old bounded polling fallback.
This is not a promise of unlimited market coverage. Pending research signals are
prioritized within the subscription cap; dropped coverage remains unknown.

Clients cannot change server subscriptions or execute orders. CORS and existing
read-only methods remain. Slow SSE clients are disconnected instead of allowing
an unbounded send queue. Trade cancel/correction events conservatively invalidate
the displayed last trade until a new valid price arrives. Original event times,
not response/receipt times, govern displayed price age.

The SQLite journal requires a writable persistent mount. A file existing on an
ephemeral free host is not durable; API reports `durability_verified:false` until
an operational persistence test exists. Single-instance deployment only. No raw
evidence is automatically deleted; monitor disk growth and archive/back up before
capacity is exhausted. High-throughput SIP load has not been benchmarked.

## Paper evaluation limits

`research/paper.py` uses the same execution function as Phase 1; it cannot submit
orders. It freezes one-share scenarios, a 30-second entry window, a 0.1% entry cap,
the detector's 2R target and existing Phase 1 latency/fee/impact assumptions.
These are an uncalibrated observation policy, not chosen profitable parameters or
scalable portfolio returns. Fee/impact calibration and sizing remain outstanding.

Correction: the dated Alpaca CTA/UTP changelog specifies **shares** from November
3, 2025. `research/quote_units.py` pins this contract and `paper.py` no longer
requires or multiplies by lot metadata for these SIP records. Pre-transition data
and other encodings remain unknown; a lot file alone cannot qualify their units.
`TAGIT_LOT_METADATA` / `--lots` is accepted for compatibility but ignored. See the
source, regression tests and diagnostic in [SHARE_CAPACITY_FINDINGS.md](SHARE_CAPACITY_FINDINGS.md).
IEX/delayed signals remain `SINGLE_EXCHANGE_OR_DELAYED`, not consolidated evidence.

Subscription gaps, missing volumes or unresolved exits remain explicit. Connection
continuity is an observation proxy, not proof of NBBO completeness, quote firmness
or attainable fills. Terminal outcomes are frozen; later disconnects do not rewrite
an already-observed outcome. Unknown outcomes can be revisited when qualified evidence becomes available. Every status remains in the public denominator. No aggregate
live expectancy is displayed yet.

## Capability inventory actually performed

Saved selection before calls in `research/provider-probe.json`. Exactly two new
Alpaca metadata requests, zero new price/quote/trade requests:

- `data/capabilities/calendar-20250901-20260831.json`: 251 sessions over the requested
  year. Raw times are exchange-local and timezone-naive; they require explicit
  America/New_York localization before research use. This calendar is not market
  history and is not a selected test sample.
- `data/capabilities/asset-SENS-20260924.json`: the configured reference symbol's
  current asset fields. No historical shares, publication dates or listing-history
  intervals were returned. This cannot establish the requested PIT universe.

No known outcome period was relabelled holdout and no feature was fitted.

## Provider and hosting choices — checked 2026-09-24

| Option | Public price | Relevance / limitation |
|---|---|---|
| Existing Alpaca Basic | $0 incremental | Reuse saved SIP history and historical access subject to entitlement; live IEX, 30 streaming symbols; not a historical share/master service |
| Alpaca Algo Trader Plus | $99/month | Consolidated live coverage and unlimited plan-level stock subscriptions; simplest continuation of existing adapter; does not solve PIT capitalization |
| Massive Stocks Advanced | $199/month | Trades/quotes, flat files and long history; separate integration/metadata publication audit needed |
| Databento | Usage/subscription quote | PIT security master/corporate actions; verify exact US venue/tape dataset and quote cost before purchase |
| Render Starter + 10GB disk | $7 + $2.50/month base | Always-on single-instance candidate; usage/tax and retention capacity additional; not provisioned |
| Zoya live | Dashboard quote | Basic/Advanced licensing differs; public display requires provider permission, sandbox is randomized |

Proposed initial **runtime + live SIP** base is $108.50/month before tax/usage,
assuming the listed plans and 10GB disk. This is not the total cost of historical
PIT data, financial statements, Sharia service or indefinite raw-event retention.
No purchase is authorized or made merely by committing the review template.

Official sources:

- https://docs.alpaca.markets/us/docs/about-market-data-api
- https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data
- https://massive.com/pricing
- https://databento.com/pricing
- https://databento.com/security-master
- https://render.com/pricing
- https://render.com/docs/disks
- https://render.com/docs/free
- https://developer.zoya.finance/docs

## Activation decisions and exact next step

Render returned **no selected workspace**; its connector explicitly requires user
confirmation before choosing one. It listed `My Workspace`. No service was read,
created, upgraded or redeployed after that response. After workspace and spending
approval, use the reviewed `render.persistent.example.yaml` (new Docker observer,
not an in-place runtime change of the existing service), supply protected Alpaca
keys, verify SIP entitlement, persistent write/restart behavior and stream coverage,
then connect the frontend. Keys belong in the host's secrets, not chat or git.

The default review template keeps IEX and 30 symbols until account entitlement is
verified; change to SIP/appropriate subscription bound only after verification.
Zoya remains disabled pending its separate data/display requirements. Production
promotion of a trading strategy remains forbidden without independent validation.

Next research step: obtain a source-qualified PIT listing/share-count/corporate
action inventory, localize calendar sessions, freeze actual walk-forward and
holdout manifests, then fetch price data against that inventory. Buying live SIP
alone does not complete this requirement.
