# Frozen six-case SIP path audit — 24 September 2026

**Measurement advanced; no profitable strategy or verified fill established.**
Retrieved 85,688 new quote records in 18 requests (17 successful, one provider
internal error), retaining boundary overlap and every error. Reused the five
previous one-minute probes and the cached 24 August BTCT prefix. Five complete API
time intervals were retrieved. The sixth stops at a saved continuation cursor.

The [protocol](research/continuation-path-protocol.json) was committed in
[f9cd172](https://github.com/tufeeq/ai/commit/f9cd172e4e06de24e3e7396b2ca13dbacd420c31)
before retrieval. The same six missingness-selected development cases were kept.
No new selection, feature fitting, live-rule changes, holdout access or purchases.
These are not a qualified historical NASDAQ under-$100M universe or independent
validation set.

## Reproduce offline

```sh
make -C tagit-next continuation-paths
```

Python 3.12+, no API key. This runs focused unit tests then byte-compares the report.
`make -C tagit-next verify` includes the new audit and all existing regressions
(also requires Node 24). Compressed raw responses, including the failed request,
are saved in `data/continuation-paths/`. Hashes are fixed in
`research/continuation-path-inputs.json`; no data are silently regenerated online.

## Retrieval and indication policy

1. Fetch only uncovered intervals, excluding the five already-fetched minute
   probes. The cached BTCT prefix is reused, not downloaded again.
2. Capped responses resume **inclusively** at their final timestamp. That boundary
   overlap avoids skipping unseen same-time quotes. A capped final timestamp is
   not qualified until continuation covers it. Stalled cursors remain unresolved.
3. API interval coverage and fresh executable quotes are different concepts.
   Empty intervals are not manufactured quotes; a complete API result does not
   prove a continuously attainable bid/ask or absence of halts.
4. Diagnostic anchor: first valid positive uncrossed ask within 30 seconds after
   the frozen minute-entry time. Inspect subsequent valid bids for +10% or -3%
   relative to that ask, through the original one-hour deadline. The deadline
   is anchored to the frozen minute, not extended by a later anchor quote.
5. Same-time opposite barriers or different entry asks remain order-unknown.
   Exact duplicate boundary observations are removed only from the price-state
   diagnostic, never from raw evidence. Timestamps are conservatively grouped at
   Python datetime microsecond precision; no finer order is invented.
6. A timeout requires a valid bid at/after the deadline within three seconds.
   An older bid is never carried forward as an exit. A post-deadline target/stop
   is classified as a timeout price, not an earlier barrier.
7. **These anchors are not entries approved by the live scanner.** Its spread,
   entry range, quantity, causal volume, receipt timing and execution costs are
   not applied by this indication diagnostic. Verified execution is deliberately
   blocked pending those inputs; `executable_net_return_pct` remains null.

## Results — all six cases

| Symbol / session | First observed ask anchor | First qualifying bid observation | Outcome of price indication | API interval |
|---|---:|---:|---|---|
| BTCT / 24 Aug | 1.94 at 14:05:00.074168 UTC | 1.88 at 14:05:13.587315 | Stop observed first, -3.0928% before unmodelled costs | Partial; observed crossing precedes missing suffix |
| SGLY / 1 Sep | 1.45 at 18:33:02.501529 UTC | 1.40 at 18:34:02.420133 | Stop observed first, -3.4483% before unmodelled costs | Retrieved |
| AKTX / 28 Aug | 9.60 at 15:41:00.903541 UTC | 9.30 at the same time | Spread alone crosses -3%; -3.1250% ask-to-bid | Retrieved |
| FWRD / 1 Sep | 16.76 at 14:19:00.384198 UTC | No fresh timeout bid | Unknown timeout price | Retrieved |
| NKLR / 4 Sep | 5.12 at 15:05:03.888562 UTC | No fresh timeout bid | Unknown timeout price | Retrieved |
| BTCT / 31 Aug | 2.06 at 17:45:01.247564 UTC | No fresh timeout bid | Unknown timeout price | Retrieved |

**Three stop indications, three unresolved timeout prices, zero verified execution
outcomes.** No mean of the three indications is presented as a strategy return.
For AKTX the immediate difference is bid/ask spread, not a subsequent price fall.
Its roughly 3.23% spread relative to bid (and SGLY's roughly 2.84%) would exceed
the recorded discovery-1 0.8% spread ceiling. These diagnostic anchors must not be
represented as approved live trades or evidence that the existing spread gate
was absent. Do not add or tune a live rule from these cases.

The former BTCT same-bar ambiguity now has a **stop-first quote indication** under
this separately frozen ask-anchor policy. This does not overwrite its candle label:
the candle-open anchor and quote-ask anchor are different reference prices.
The three other cases show why obtaining more quotes does not guarantee a usable
price exactly at a time exit. Observed update gaps ranged up to approximately
801 seconds in SGLY; this is neither proof of a halt nor proof that standing quotes
were unavailable throughout that gap.

## Saved continuation and remaining execution work

Alpaca's 18th call returned `Mcp error: -32603: Internal error`. Per the frozen
no-retry policy, it is retained rather than immediately repeated. This is a
provider-call failure, not a demonstrated credential or subscription problem.

Resume the same BTCT 24 August request inclusively from
`2026-08-24T14:39:37.928302+00:00` to `2026-08-24T15:05:03+00:00`, SIP ascending,
limit 10,000. The exact job is in `data/continuation-paths/retrieval.json` and the
report. No earlier prefix or previous probes should be fetched again. Future
responses belong to a new checkpoint and must not mutate this frozen report.

Before execution outcomes can be computed, qualify dated quote-size/round-lot
metadata, align causal prior-minute volume, declare receipt/latency scenarios,
and calibrate fees/impact/quantity. The current code refuses to fabricate those
inputs. Full historical universe qualification and an independent >=500-evaluable
final holdout remain outstanding. Hosting activation is a separate unfinished
operational task; this research audit does not imply an always-on server exists.
