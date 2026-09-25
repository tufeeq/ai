# Breadth observation and entry research — 0.1.3

Definitions frozen before deployment on 2026-09-25. This release has no independent performance evidence. Neither the number of discovered symbols nor engineering test success establishes a trading advantage.

## Coverage

`breadth-1` is a separate observation path beside the original NEXT shortlist. It keeps the discovery-1 formulas and adds all eligible current reference symbols to candle evaluation. It uses the current dated Finviz reference intersection with active NASDAQ assets; unknown, stale or excluded metadata are not silently inferred. It does not represent all NASDAQ securities. Current scope remains below $100M.

Each full cycle attempts all eligible symbols in batches of 100, two simultaneous requests. Initial history is 95 minutes; subsequent successful batches overlap the previous end by two minutes. Retention is 100 minutes, with the detector using the last 90 minutes as before. A maximum of three pages per batch bounds traffic. Pagination that remains incomplete is explicitly partial; failed/partial batches cannot create new discoveries. Existing cached candles can preserve observations but never imply a successful fresh batch. Snapshot quote/trade timestamps remain authoritative, regardless of scan success.

Provider calendar supports DST/short sessions. Automatic coverage runs during premarket and regular trading, not after-hours. A single-flight worker starts at boot; manual refresh joins/coalesces with it. Cycles are separated by 60 seconds after completion; a 429 backs off for 120 seconds. `TAG_ELITE_SWEEP=0` disables the automatic worker without changing the legacy scanner. Unconfigured/stale references, entitlement errors and partial results are visible.

On Render Free this worker only runs while the process is awake. It is not a 24/7 guarantee. No self-pings circumvent sleep and no paid infrastructure is implicitly added. Both databases and the history cache remain vulnerable to ephemeral-host restart; the deployment snapshot is partial decision evidence, not a full backup. Paid/always-on hosting and a persistent input journal remain deployment gates.

## `reclaim-paper-1` proposals

The shared pure `entryProposal` function uses saved events plus timestamped quote evidence. It can be called with an earlier cutoff and only considers confirmations available then. It is used for prospective simulation proposals, not broker execution. Existing archive has no such proposal history and is not represented as a backtest of this model.

1. Require an existing RECOVERY_CONFIRMED transition from the state engine (two contiguous confirmation closes at the frozen recovery level). Renewal uses the same rule after a failed wave.
2. Freeze level L, ATR A and prior five-bar low P from the confirmation event. These are observed historical bars, not future-confirmed pivots.
3. Entry band is L to L + min(0.5*A, 1%*L). Scenario invalidation is P - 0.25*A. Expiration is exactly two minutes from confirmation, not refreshed by later quotes.
4. A proposed entry requires current eligible metadata (including the existing Sharia gate), current quality allowing entry (23 contiguous bars), valid movement state, and all other existing blocking conditions. It additionally requires ask in the band, positive stop below ask, stop distance 0.5–6% of ask, bid/ask spread no more than 0.8% of bid, and quote age at most ten seconds. Quote receipt must precede evaluation; quote timestamp must be at least one second after the confirmation decision. No quote-based price is reported as a fill.
5. Limit to the first two confirmed recovery attempts in the symbol/session, regardless of whether either became executable. This is a conservative research definition, not a measured optimal number of trades.
6. Planned simulation exit conditions: stop breach, movement failure, 30-minute maximum holding or session close. Actual execution must use a subsequent executable quote plus fees/slippage; halt/gap fills and intrabar sequencing cannot be assumed. This release does not add a completed position simulator for these new proposals or a net-performance report.
7. `PROPOSED`, `BLOCKED`, `WAITING`, `EXPIRED` and stale quotes are distinct. Candidate events are appended once per confirmation/version; they are not sent as trade orders. Original detection and proposal time remain separate.

The UI shows conditional levels only once their inputs exist. Unknown eligibility does not become compliant, and no price is invented to fill an empty entry list. Client refresh expires stale proposals between server cycles. IEX is visibly single-exchange, not consolidated execution evidence.

## Remaining work and rollback

Full persistent storage, always-on hosting, consolidated-feed entitlement, verified Sharia metadata, browser notification-receipt telemetry, actual fill records and independent forward evaluation are not completed. No result of those absent systems is fabricated.

Revert the code to `1854d49976cc488bade0c7014854443622da8b88` to remove breadth/proposal changes while retaining the current-first interface. Preserve the latest public decision snapshot separately before rollback. Disable `TAG_ELITE_SWEEP` for an operational rollback. The legacy NEXT scanner and its thresholds are unchanged.
