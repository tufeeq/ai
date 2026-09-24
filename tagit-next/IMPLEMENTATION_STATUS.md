# Implementation status — 2026-09-24

Scope: current NASDAQ <$100M discovery-1. No signal rules changed. No subscription,
order, paid service, production merge or production deployment performed.

## What is implemented versus proven

| Phase | Implemented in this branch | Still required before completion |
|---|---|---|
| 1 — validation | Exact negative baseline reproduction; event/availability clocks; full unchanged scanner response-tape adapter; SQLite response hashes; execution/metrics/split components | >=12-month PIT listing/share universe including delisted securities, source receipt/revision times or labelled latency scenarios, calibrated costs, walk-forward runs and independent evidence |
| 2 — improvements | Planning registry in `research/feature-registry.json`, no rule change | Phase 1 acceptance, dated inputs, frozen individual hypotheses, independent comparisons and final holdout >=500 evaluable signals |
| 3 — infrastructure | File-backed SQLite, optional background regular-session scans, provider WebSocket, browser push, paper evaluator reusing `research.execution.simulate`, health/error reporting | Workspace confirmation, paid persistent host approval, runtime keys, restart/disk verification, lot metadata and subscription coverage; load/retention/backups need operational verification |
| 4 — Sharia | Server-side live Zoya adapter; sandbox rejected; stale, ambiguous and incomplete reports remain UNKNOWN | Live key/licensing, public display approval, underlying financial-statement date (not supplied by Basic response) |
| 5 — interface | RTL performance page, stream/fallback indicators, source/date and missing outcomes, link from methodology | Publish reviewed frontend and connect verified server; real forward observations, calibrated probabilities and similar-signal statistics do not yet exist |

**No final configuration or profitable strategy has been selected.** Null effects
in the feature registry mean NOT TESTED, not zero or success. The final holdout
remains unopened. The old 322/84/238 baseline and negative mean remain unchanged.

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

Quotes use **round lots**, per Alpaca's official schema. The evaluator requires a
dated lot-size metadata file to convert to shares; it does not silently multiply
by an assumed constant. Required JSON list fields: `symbol`, positive integer
`shares`, `source`, `available_at`, `valid_from`, `valid_until` (UTC-aware times).
Future metadata cannot enable a fill. IEX/delayed signals are kept and labelled
`SINGLE_EXCHANGE_OR_DELAYED`, not converted into consolidated execution evidence.

Subscription gaps, missing volumes or unresolved exits remain explicit. Connection
continuity is an observation proxy, not proof of NBBO completeness, quote firmness
or attainable fills. Terminal outcomes are frozen; later disconnects do not rewrite
an already-observed outcome. Unknown outcomes can be revisited after missing
metadata is supplied. Every status remains in the public denominator. No aggregate
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
