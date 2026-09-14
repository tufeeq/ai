# TAGit10 10.7: conditional plans and Alpaca quote validation

This release supplies explicit conditional paper plans and a server-side Alpaca market-data adapter. It does not establish profitable prediction or enable brokerage orders. The previously failed models remain unapproved.

## User-visible behavior

The **Conditional plans / خطط مشروطة** tab shows price levels for regular-session equities that pass the existing complete-bar, liquidity and directional screening. Each plan specifies:

- An ask-price trigger above the observed closed 15-minute range, and a maximum entry 0.25% above that trigger.
- A stop reference below the observed range low. A range requiring more than 5% price risk is excluded, rather than manufacturing a closer stop.
- An arithmetic target providing at least 2R at the maximum entry under 0.2% slippage per side and zero commission. It is not a prediction that price will reach the target.
- A five-minute lifetime tied to a shared five-minute boundary. Both scanner processes derive the same levels from the 15 complete minutes preceding that boundary. Refreshing the page or changing subsequent bars does not move the levels.
- Bid/ask source, spread, quote age, and specific failed checks. Quotes older than 15 seconds, future timestamps, crossed/invalid quotes, zero displayed sizes and spreads above 0.3% cannot produce a paper-trigger observation.

A known stop breach or a price beyond the maximum entry invalidates the plan until expiry. Recovery does not silently reactivate it. Price-bar evidence can invalidate a plan even if quotes are unavailable. Targets, stops and expiry can be copied to the existing paper planner; the planner uses the maximum entry price and preserves the user's capital/risk settings and journal.

The first observed quote crossing is frozen before any outcome, with `outcomeStatus: UNASSESSED`. It is not an assumed fill, a win, or a record of an executed trade. Existing fixed-target bar-based research outcomes remain separately defined. No forward profitability has been established for this new plan policy.

## Actual Alpaca access versus unattended runtime access

The connected ChatGPT Alpaca service successfully returned IEX snapshots for twelve stocks. Ten had quote timestamps no older than 15 seconds at capture. The timestamped raw diagnostic is in `alpaca-connection-check-2026-09-14.json`; it expires as market information and is not used as a live fallback feed.

Live SIP access was denied by the connected account's subscription in the preceding verification; historical SIP bars succeeded. IEX is a single-exchange source, not consolidated market coverage. The application labels its scope and never treats an IEX quote as verified market-wide best bid/ask. See [Alpaca's market-data access and feed documentation](https://docs.alpaca.markets/us/docs/market-data-faq).

The GitHub Actions scanner cannot inherit the ChatGPT connector's authentication. The adapter uses server-side credentials, a fixed Alpaca data host, explicit `iex` or `sip` feed selection, a bounded 50-symbol snapshot request, and an eight-second timeout. It reports authentication/entitlement failures without logging credentials or response bodies. It never substitutes a denied feed silently. It does not request private account data or submit orders.

## Runtime activation, if credentials are missing

In this repository's **Settings → Secrets and variables → Actions**, configure:

- `ALPACA_API_KEY_ID`
- `ALPACA_API_SECRET_KEY`

Existing `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` names are accepted as aliases. Keep values in GitHub repository secrets, never in source files, page JavaScript, reports or chat messages. Both scanner workflows receive these secrets only in their runtime environment.

The optional repository variable `TAGIT_ALPACA_FEED` defaults to `iex`. Set it to `sip` only when the account has that entitlement. Restart **TAGit 10 Continuous Radar** after changing credentials so its process receives the updated environment. The emitted `quoteValidation.provider` reports `credentialsConfigured`, request/response counts, feed scope and status. A green software check alone does not mean credentials are configured; the actual published status must be inspected.

This adapter is REST polling through the existing scanner and publication path, not a streaming execution service. The browser independently expires quotes at 15 seconds, including between feed refreshes. Partial exchange coverage, transport delay, unverified halts/catalysts and failed model validation remain material limitations. Faster, reliably authenticated delivery and prospective outcomes are required before treating these as validated live trading signals.

## Verification

Runtime tests cover both Alpaca response formats, stale/future/crossed/wide quotes, missing credentials without network calls, denied entitlement without secret leakage or feed substitution, after-cost target arithmetic, frozen levels, no chasing, expiry, known stop breaches without quotes, immutable observation records and state reconciliation. Chromium exercises the actual conditional-plan card, single-exchange disclosure, copy-to-planner flow and stale-quote removal of the paper-trigger label.

The publication check verifies both the newest overall snapshot and a separately fresh continuous-scanner snapshot. A newer periodic snapshot does not itself imply that the continuous scanner has failed. Quote-provider authentication status is printed separately and is not disguised as a successful data integration.
