# TAGit NEXT — independent small-cap rebuild

**Status: research foundation completed; profitable trading strategy NOT established;
continuous live operation NOT connected.** This code imports none of the earlier
TAGit engines, models, scores, UI, or approval rules. It does not place orders.

**Expanded study completed:** 164,248 additional bars, 96 outcome-independently
sampled stocks, 10 sessions, and a frozen chronological test. All three hypotheses
were rejected. See [STUDY_RESULTS.md](STUDY_RESULTS.md) for the full results and
limitations. The runtime is explicitly marked rejected-model data collection only.

**Quote audit added:** 10,375 historical SIP quotes for 12 preselected entry windows
found five candle-based entry rejections with later eligible quotes. This exposes
an execution-measurement limitation, not a profitable model. See
[QUOTE_FINDINGS.md](QUOTE_FINDINGS.md). News availability checks are implemented;
a complete historical news feed has not been connected.

## What changes

- Equities with known market capitalization below USD 1 billion; price USD 0.15–30.
  Those are declared research-universe choices, not fitted profitable thresholds.
  No funds, ETFs, shell companies, or unknown capitalization should enter the supplied universe.
- No daily +10% ceiling. A stock already up substantially can still form a fresh
  consolidation breakout or VWAP reclaim. Opportunity means movement after an
  available entry, not the full daily percentage printed on a winners list.
- Two explicit hypotheses: base breakout and VWAP reclaim, with volume acceleration,
  traded value, minute continuity, bounded stop distance and an entry-price cap.
  These hypotheses failed to demonstrate stable profitability in the diagnostic.
- Timestamped setups carry entry, maximum entry, stop, net 2R target, and expiration.
  These are conditional research levels, not predictions or live recommendations.
- Real-time qualification requires fresh consolidated SIP bid/ask, nonempty sizes,
  acceptable spread, and entry within the frozen range. IEX is not silently treated
  as whole-market coverage. Delayed data cannot produce a live qualification.
- A continuous WebSocket recorder captures actual arrival times and revisions for
  future testing. Current historical revised candles are explicitly weaker evidence.

## Reproduce the diagnostic

```
cd tagit-next
python -m unittest discover -s tests -v
python replay.py
```

Python 3.11+; replay/tests use the standard library. The compressed original input,
its provenance and the generated report are committed. No legacy dataset is used.
Data was newly retrieved from the connected Alpaca SIP historical endpoint.

The 22,705 minute bars cover 24 symbols on September 10, 11 and 14, 2026. The last
session stops at 19:40 UTC (15:40 New York), before the close. The sample includes
16 September 14 movers plus eight non-positive controls. It is selected using the
known outcome and is **not** a representative market-wide validation or training set.
Market caps are a September 14 Finviz snapshot, not historical point-in-time caps.

| Session | Setups | Resolved entry simulations | Positive net | Mean net per resolved simulation |
|---|---:|---:|---:|---:|
| September 10 | 12 | 6 | 2 | -0.9179% |
| September 11 | 11 | 5 | 1 | -2.0734% |
| September 14, partial | 37 | 14 | 4 | +0.0462% |

September 14: 17 distinct symbols, two target hits, seven stops and five timeouts
among resolved simulations. Seventeen other setups had no next-minute open within
the permitted entry range, three had missing minutes and three were unresolved.
**37 setups is not 37 trades, not 37 early detections, and not evidence of accuracy.**
The two target simulations were both PDSB. No parameters were refitted after seeing
these results. There is no trained model and no validated success percentage.

Simulation assumptions: next-minute open, 0.25% cost per side, 45-minute horizon;
simultaneous stop/target candle is conservatively counted as a stop and separately
labelled. Missing minutes are not interpolated. Stops can gap through their level.
There are no historical bid/ask fills or portfolio returns. Setups may overlap;
these are individual opportunity diagnostics, not a capital-constrained backtest.

## Live read-only recorder

```
python -m pip install -r requirements.txt
python stream.py --universe /secure/current-universe.json
```

Use a persistent server with protected `ALPACA_API_KEY_ID` and
`ALPACA_API_SECRET_KEY` environment variables (APCA aliases also accepted).
Do not put credentials in the repository, web page, command line, or chat.
SIP real-time entitlement is required. The connected account returned
`sip_delay_window` for recent SIP bars during this rebuild; older SIP history worked.
A ChatGPT connector connection does not provision credentials to a deployed server.
GitHub Pages cannot host this continuously running Python process.

The current source sample is diagnostic only; it must not be presented as the full
small-cap universe. Supply a fresh complete eligible-equity reference list, frozen
before the session, with market cap and instrument type. Refresh it every session.
Each row:

```
{"symbol":"EXAMPLE","instrument_type":"equity","market_cap":50000000,
 "metadata_at":"2026-09-15T08:00:00Z"}
```

The recorder rejects stale/future metadata, journals all inbound provider events,
and creates a local `data/live.json` plus a private append-only event journal.
It starts cold and needs at least 23 usable minute bars per symbol; it must start
before the open. It resets on reconnect and does not reuse old executable setups.
Extended-hours bars provide context only; separate premarket entry logic is not
implemented or validated. Paper quote qualification is not an actual fill or order.
Live socket authentication/subscription behavior could not be verified without
runtime credentials and entitlement. The recorder is not advertised as deployed.

## Efficient path to a valid model

1. Freeze the complete small-cap universe before each evaluation session. Include
   failures and inactive symbols. Preserve listing history, splits and delistings;
   exclude or quarantine corporate-action windows until correctly reconciled.
2. Use `collect.py` to fetch every supplied symbol, with pagination and explicit
   missing-symbol reporting. This avoids selecting historical winners as training.
3. Replay signals using only information available at the signal time. Define
   multiple outcomes separately: +15%/+20% remaining movement, executable net 2R,
   stop-first failures, timeouts and coverage. Never equate hindsight highs with P&L.
4. Train only on older sessions, choose thresholds on a separate validation period,
   then freeze everything and evaluate untouched future sessions. Do not tune on
   September 14 after inspecting its results. Treat this sample as development only.
5. Compare against simple baselines under the same universe, costs and coverage;
   measure precision, recall, lead time, net expectancy, tail losses and capacity.
   A candidate must improve both false signals and missed opportunities, not just
   show more rows or increase the headline win rate by hiding unresolved outcomes.
6. Run timestamped forward paper observation with real bid/ask and halt status.
   Establish stable positive net expectancy and adequate sample size before any
   live-trading claim. No such claim is warranted by the diagnostic above.

The remaining blockers are substantive: unproven strategy performance, incomplete
point-in-time evaluation coverage, live data entitlement, and persistent runtime
configuration. Faster refreshing or a new visual design alone cannot resolve them.

References: https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data
and https://docs.alpaca.markets/us/reference/stockbars
