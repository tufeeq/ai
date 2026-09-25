# TAGit NEXT market-data service

## New observer runtime (2026-09-24, opt-in)

See [implementation status](../IMPLEMENTATION_STATUS.md) before activation.
`server.mjs` supports `TAGIT_JOURNAL_PATH` (SQLite), `TAGIT_BACKGROUND=1`
(exchange-clock regular-session scans), and `TAGIT_STREAM=1` (Alpaca WebSocket
to browser SSE). None is enabled by default. Persistent disk and an always-on
host are required; the existing free deployment is not upgraded by this code.
`GET /api/performance` exposes counts/unknowns and `GET /api/events` streams data.
`TAGIT_PAPER_PYTHON` enables the shared Phase 1 evaluator. Post-November-2025
Alpaca SIP quote sizes are shares, with a versioned provider/date contract and no
lot multiplier. `TAGIT_LOT_METADATA` is deprecated/ignored. Older/unknown units
and partial feeds cannot establish consolidated execution evidence; see
[the correction and capacity audit](../SHARE_CAPACITY_FINDINGS.md).
Optional `ZOYA_API_KEY` and public display permission enable the Sharia adapter;
missing financial-statement date still yields UNKNOWN. No keys are in this repo.
The Dockerfile uses `tagit-next` as build context to include the Python evaluator.
The review-only paid Blueprint is `../render.persistent.example.yaml`.

The legacy Vercel/Worker HTTP handler below remains request-driven; the new
background/SQLite/WebSocket runtime requires the long-lived `server.mjs` process.

Independent read-only Alpaca price service. No trading engines or order submission.
Node 24, no external dependencies. `npm test` runs execution-integrity tests.

## Deploy

Import `tufeeq/ai`, branch `tagit-next-independent-20260914`, into Vercel with Root
Directory `tagit-next/quote-service`, Framework Preset Other, and Node.js 24.
Set protected runtime variables in the hosting dashboard:

- `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` (APCA aliases also accepted).
- `TAGIT_DATA_FEED=iex` for the currently verified entitlement. `sip` only after the
  account actually supports it. `delayed_sip` is always labelled delayed.
- `TAGIT_ALLOWED_ORIGIN=https://tufeeq.github.io`.

Never put keys in the repository, public page, URL or chat. The ChatGPT Alpaca
connection cannot populate these server variables. There is no subscription change.

`GET /api/health` reports configuration only, not a successful market connection.
`GET /api/quotes?symbols=SENS,NUAI,BTCT` must succeed before claiming connection.
`GET /api/universe` supplies currently eligible small caps from timestamped reference
metadata. Add the deployed service origin to `web/live-config.json` as `endpoint`.

The public interface requests prices every five seconds only while visible, with
single in-flight requests, timeout, abort on symbol change, and backoff on failure.
This transport is HTTP polling, not a tick-by-tick WebSocket stream or continuous
full-market scanner. The existing independent Python stream recorder remains a
separate not-yet-provisioned runtime for prospective research collection.

Reference source: the existing Finviz broad export, metadata fields only. Numeric
market cap is USD millions. Reject unknown caps, caps >= $1B, ETFs, closed-end funds,
shells, and metadata older than 24 hours or from the future. No ranking, technical
indicator, price, news inference or prior engine decision is imported from that feed.
The reference is not an exchange-complete point-in-time master and requires its own
upstream refresh; a stale/missing reference blocks quotes rather than inventing caps.

Prices: preserve original quote/trade timestamps, reject nonfinite/crossed prices,
zero sizes and future times; label event age over three seconds stale. IEX remains
single-exchange data even when recent. Bid/ask are distinct from the last trade.
No stale cache is returned following a provider failure. In-memory cache, request
coalescing and per-instance limits reduce duplicate requests; these are not a
distributed rate-limit guarantee. Quotes are observation data, never recommendations.

Official schemas:
https://docs.alpaca.markets/us/reference/stocksnapshots-1
https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data

## Activation verification

After deploying with the protected runtime variables above, run:

```
node scripts/verify-connection.mjs https://YOUR-SERVICE-HOST SENS,NUAI,BTCT --write-config
```

This checks CORS, configured health, real HTTP quote responses, timestamp integrity,
reference eligibility and symbol accounting before writing `web/live-config.json`.
It never accepts health alone as evidence of prices. A failed check leaves the config
untouched. The result reports quote freshness separately from transport connectivity;
neither grants strategy approval. Publish the updated web export only after success.

A mixed eligible/ineligible watchlist returns `PARTIAL`: eligible symbols retain their
own observed prices, excluded symbols are listed explicitly and never sent to Alpaca.
A list with no eligible symbols remains an explicit 422 response.
