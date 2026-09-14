# TAGit 10.3: discovery and outcome integrity

The user reported a 50% account loss. No broker trade history is connected, so this audit cannot attribute that loss to particular alerts or verify the account percentage.

## Findings from the actual source

- The live 10.2 engine used fixed weights. Continuous learning explicitly did not update its ranking.
- The Yahoo chart parser accepted an unfinished current candle and irregular terminal observations.
- EARLY did not require nonnegative recent price direction or a minimum dollar-volume floor.
- Repeated ACTIONABLE observations could become CONFIRMED even while the price fell between observations.
- Live outcome labels inspected minute closes rather than intraminute high/low and excluded costs. This was disclosed, but unsuitable as an executable success metric.
- Daily engine reset and cross-day writer reconciliation could discard earlier forward evidence.
- The main UI's detailed research results were behind a separate tab.

## Implemented repair

- Complete, valid, closed OHLC only; irregular terminal quotes removed.
- Require 30 contiguous minute bars, minimum active bars, recent dollar-volume floors, nonnegative 5/15-minute and session direction, price above a close-volume-weighted session proxy, and limited retreat from the session high.
- Candidate thresholds are declared in screening.py. They are conservative engineering policy, not fitted or validated profit thresholds.
- Confirm only distinct recent bars under the same policy/day/session and with price retention.
- Reject unsupported instruments as reported by the source. Instrument classification is not a comprehensive security-master audit.
- Reuse the repository's market holiday/early-close calendar; unsupported calendar years fail closed.
- Keep normal-session Finviz RVOL out of extended-session scoring; expose Finviz availability and coverage.
- Record new 10.3 observations separately. Entry uses the first full minute after the actual signal, at that candle's open. Outcomes inspect complete OHLC, treat both barriers in one bar as stop-first, include adverse stop gaps, and subtract an assumed 0.4% round-trip cost.
- Preserve frozen evidence across days and both existing writers. Missing outcome windows remain unscorable.
- Show research status and existing negative historical evidence on the main screen. Legacy or insufficiently verified feed rows remain in Watch.
- Add regression checks before scanner publication and Pages deployment.

## Evidence boundary

The stored historical-training.json dated 2026-09-12 has 236,177 five-minute bars and 18,904 examples. Its separate research model selected 107 test examples with 26.17% target-first precision and -0.4518% mean return after assumed costs; only 2/7 test sessions had a positive mean. It was not promoted to the live scanner.

These numbers are not a measurement of the new 10.3 screening policy and are not portfolio returns. The earlier 140,839-observation benchmark has not been replayed against 10.3 in this repair. The stored five-minute research corpus cannot reproduce a one-minute scanner, point-in-time Finviz RVOL, and bid/ask execution without additional source evidence.

Regression and browser checks establish specific software behavior, not predictive accuracy. Fresh forward observations must accumulate before a defensible before/after performance claim is possible. New and old versions, sessions, recall and target-first precision must remain separate.

Yahoo candles and Finviz scans are not broker executable quotes. Spread, live halt state, verified catalysts, market impact and actual fills are not connected. No new model is approved for live trading; no accuracy or recovery promise is made.

Calendar reference: https://www.nyse.com/markets/hours-calendars

## Live verification follow-up

The first repaired scan on 2026-09-14 restored publication but exposed zero Finviz relative-volume rows despite three successful HTTP exports. The provider now explicitly requests the established Elite rich columns through export.ashx, spaces requests by six seconds, and reports DEGRADED when required RVOL coverage is absent. No relative-volume values are estimated from cumulative volume.
