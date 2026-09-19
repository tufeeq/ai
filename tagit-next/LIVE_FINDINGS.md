# Live price integration — September 15, 2026

## Delivered implementation

Independent Node 24 service under `quote-service/`, with no order routes or old
engine imports. The public UI now has a dedicated quote panel, original exchange
event timestamps, distinct last trade / bid / ask, feed coverage, age that advances
while idle, five-second HTTP refresh, single in-flight requests, cancellation on
symbol changes, pause/resume, hidden-tab suspension, timeout and retry backoff.
Old prices are cleared after a connection error rather than shown as connected.
This is a bounded price-watch service, not a tick-by-tick stream or full-market
scanner. No model was retrained or promoted by this work.

The API validates market capitalization below $1B against fresh timestamped Finviz
reference metadata, excluding funds/shells/unknown caps. It imports no prices,
scores, rankings, signals or historical engine decisions from the prior feeds.
Reference source at commit `119b008ffffad8d6804125f67ffd4d9eee56c1cb`,
`tag/data/universe-broad.json`, timestamp 2026-09-15T13:02:37.501949+00:00.
The dataset is a reference export, not a complete point-in-time listing master.

## Actual connection checks

Initial Alpaca clock, SIP and IEX calls returned internal errors. Retrying restored
the connector. A SIP retry returned the explicit subscription rejection:
`subscription does not permit querying recent SIP data`.
IEX quotes and three-symbol snapshots (SENS, NUAI, BTCT) were returned successfully.
These symbols were chosen to check integration, not to claim independent signal
accuracy. Raw responses are in `data/live-connectivity-check.json`; normalized
observations are in `data/live-connectivity-analysis.json`.

IEX is a single exchange. Its latest trade, latest quote, and minute bar have
separate timestamps. The clock sampled after the snapshots is not a latency
measurement. Old events may be unchanged rather than evidence of a feed gap.
Historical tests and unresolved results remain unchanged. News coverage is unknown.

## Concrete deployment blockers

The connected Vercel account returned no projects. A deployment of the completed
service was attempted and rejected with HTTP 402, code `api-deployments-free-per-day`:
100 daily free deployments, zero remaining. The returned reset is
**2026-09-16 16:13:06 UTC / 19:13:06 Riyadh**. Do not retry before that time or
purchase/upgrade a subscription without the user's request.

No runtime Alpaca keys or Vercel CLI token are configured in this workspace. The
ChatGPT connector does not expose credentials to a deployed server. The public
`web/live-config.json` therefore keeps `endpoint: null`. The UI reports that live
prices are not connected and contains no fabricated quote fallback.

To activate after the quota resets:
1. Deploy the `quote-service` files as project `tagit-next-market` using the Vercel
   connector (target `production`, `name`, and `files` containing `file`/`data`).
   Alternatively import this branch with root `tagit-next/quote-service`.
2. Configure protected `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` in that
   project's hosting environment, and use `TAGIT_DATA_FEED=iex` with current
   permissions. The user must enter these secrets in the hosting dashboard, not
   chat or public source. The connector alone cannot complete this step.
3. Verify `/api/health`, then authenticated provider responses through
   `/api/quotes?symbols=SENS,NUAI,BTCT` and `/api/universe` on the deployed service.
   `CONFIGURED_UNVERIFIED` is not a successful quote connection.
4. Set the verified HTTPS service origin in `web/live-config.json`, publish the
   same files to the existing GitHub Pages route, and test actual changing data,
   timeouts, stale states and suspended/resumed requests in the public browser.
5. Keep IEX limitations visible. A consolidated real-time SIP claim requires actual
   entitlement and separate live verification. The continuous research recorder
   and forward validation are still outstanding.

## Validation

50 existing Python checks plus 22 new Node tests passed locally. New cases cover
stale/future/delayed prices, wide spreads, invalid sizes, unqualified caps, stale
metadata, preserved missing symbols, deduplicated concurrent requests, cache age,
permission errors without silent fallback, redacted failures, allowed origins,
blocked write methods and client validation. Mobile browser checks passed with
local test fixtures for connection, distinct price types, ticking ages, pause,
resume, rate-limit backoff, symbol changes and zero JavaScript exceptions. The
existing 135 historical rows and search/filter/detail behavior also passed.
Browser fixtures were not published. Software validation is not trading evidence.

Official endpoint/coverage definitions:
https://docs.alpaca.markets/us/reference/stocksnapshots-1
https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data


## Publication verification

Research CI passed on commit 05aba6241631c71c650f68a00abb15a2b5e15eb1
(run https://github.com/tufeeq/ai/actions/runs/34994732934), including the 22 Node
and 50 Python checks. The frontend build and GitHub Pages deployment both passed
for b0f09faaaa93f597a229b66ea37fbd97773c79b6
(run https://github.com/tufeeq/ai/actions/runs/34994737101).

Final public HTTP requests and two browser navigation attempts from this workspace
timed out. Local browser testing of the same assets passed, but a successful
post-publication browser check could not be claimed for this update. This does not
establish whether the public site is unavailable to the user. The price service
remains unconfigured and undeployed regardless of frontend publication status.


## September 15 — alternative Cloudflare deployment route

At the user's request to try another method, added a Cloudflare Workers adapter
and configuration under quote-service, reusing the independent service and HTTP
contract. Six new adapter tests pass (28 Node tests total). The handler now initializes
lazily so the Worker imports without a Node process global, and explicit environment
bindings reach the market service correctly. No new market data was requested.

Cloudflare is available for connection, but is not yet connected; no Cloudflare
runtime account/token or Alpaca runtime keys were found. This is a tested alternative
implementation, not a successful deployment. The public endpoint remains null.
See quote-service/CLOUDFLARE.md for exact activation steps. Next: obtain authorized
Cloudflare access, deploy without changing plans, configure protected Alpaca keys,
verify actual HTTP quotes and only then publish the verified backend origin.
Historical rejected hypotheses and five unresolved exits remain unchanged.


Alternative build verification: Wrangler 4.132.0 `deploy --dry-run` succeeded
(10.84 KiB bundle). Local workerd startup could not be verified: Wrangler failed
with `uv_interface_addresses returned Unknown system error 1` in this workspace.
The local smoke check timed out after 25 seconds and its process was stopped.
Do not equate the successful build and Node tests with a successful hosted run.
