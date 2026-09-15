# Cumulative research progress

## 2026-09-15 — timeout quote integrity

Starting state: rejected independent small-cap hypotheses; ten quote-entry cases,
five resolved and five unknown timeout exits. Prior CI passed. No live promotion.

Recovered source and existing quotes at commit
`4edd2311297b097c56d2702f970412ed3ce71f09`. Used no old TAGit engine and did not
re-download market history already saved in the repository. GitHub's connector
could not decode gzip blobs; the exact committed binary files were recovered from
their raw GitHub URLs instead.

One evidence-backed implementation repair: the exit evaluator used to stop at the
first invalid quote after the deadline, even when a valid quote followed within
the existing three-second allowance. It could also carry a prior quote after a
new invalid update. It now continues within the SAME allowance, clears invalidated
fallback, and rejects nonfinite quote prices/sizes. No trading threshold changed.

The frozen ten-case replay is unchanged: five resolved, five unknown. The fix is
covered by regression tests, not claimed as a historical accuracy improvement.

A timing-only protocol was committed before five new SIP requests covering all
five unknown cases. The requests returned 181 quotes; first valid updates arrived
after their respective exit deadlines by:

| Case | Seconds after deadline |
|---|---:|
| SENS, entry 13:53 UTC | 3.814 |
| SGLY | 21.592 |
| METC | 3.831 |
| VUZI | 18.366 |
| SENS, entry 14:27 UTC | 34.894 |

All exceed the frozen three-second allowance; no outcome was reclassified. These
are exchange quote event times, not proof of an actual order fill or of a missing
market-data feed. An unchanged quote can persist without an update. A later quote
must not be moved backward in time to improve the reported P&L.

Validation: 50 local tests, regenerated timing report, and unchanged original exit
report. CI checks the existing study and both new/previous diagnostic replays.
Data budget: 5 of 20 allowed new market-data requests. No purchase, live trade,
production deployment or model promotion.

Next bounded cycle: predeclare an execution-latency experiment on DIFFERENT
chronological development cases. Compare freshness-based abstention and a delayed
exit policy with actual quote events and explicit delay/risk costs, without
retuning on these five cases or presenting a changed execution policy as a
successful detector. Preserve an untouched validation period before any promotion.
News coverage remains unknown; authentic publication/observation/version timing
is still required. No profitable or higher-accuracy model is established.


## September 15 — publish the research interface

At the user's explicit request, published a separate Arabic read-only interface at
https://tufeeq.github.io/ai/tagit-next/. The study engine remains on this independent
branch; PR #13 is still draft and no strategy was promoted or brokerage order placed.

The public export retains all 125 September 2–4 test cases and all ten August 24
quote-exit cases, including the five unknown exits. It supports symbol search,
outcome filters, pagination and per-case historical details. It displays no resolved-
subset average as sample profitability. It explicitly states that live prices and
archived timestamped news are not connected. The source snapshot remains research
commit 74f536a294994b89b97d0dc66bcbe9982fe929ae; this publication changes no findings.

Verified locally in Chromium at mobile and desktop widths: complete case counts,
filters, unknown outcomes, details, late-quote disclosure, keyboard dismissal,
pagination, missing-data error handling and no JavaScript exceptions. The check
found and fixed mobile table overflow and RTL display of the resolved-case ratio.
The Pages build/deploy passed (run 34989723252); follow-up ratio fix is commit
d5eecdce2d8441c36d8c7e05f47bd24a17d1f700. No new market-data calls were used.

Future research cycles must refresh the public snapshot explicitly when publishing
new findings; it is not an automatic live feed. The next research experiment remains
execution latency on different predeclared development cases, with validation kept
separate. Publishing this interface establishes no trading accuracy or profitability.


## September 15 — dynamic quote integration and capability checks

Added an independent read-only Node service and Arabic price panel: last trade,
bid/ask, provider event timestamps, advancing age, explicit IEX/SIP/delayed coverage,
bounded five-second refresh, cancellation, visibility suspension and retry backoff.
The service requires timestamped metadata below $1B, excludes invalid caps/funds/
shells and imports no old engine decisions. 2,197 eligible reference rows were found
in the current saved broad export; this is not a full-market scan or a new training
sample. Historical detector and execution outcomes remain unchanged.

Actual connector tests restored IEX after initial internal errors. SIP returned a
subscription rejection. Saved raw IEX snapshots for SENS, NUAI and BTCT plus a later
clock check; this confirms connector access, not deployed-server connectivity.
No strategy accuracy, full-market coverage or real fill claim is made.

50 Python + 22 Node checks passed. Browser fixture checks covered changing prices,
separate trade/bid/ask, idle aging, pause/resume, errors, backoff and symbol changes;
no fixtures were published. Existing research ledger checks also passed.

Production deployment of the completed service was attempted; Vercel rejected it
with HTTP 402, exhausted 100/day free deployment quota, reset reported
2026-09-16T16:13:06.470Z. Runtime Alpaca keys are also absent. The frontend is prepared
with endpoint null and an explicit blocked status; no fake live quotes. See
[LIVE_FINDINGS.md](LIVE_FINDINGS.md) for evidence and activation steps. Do not retry
before quota reset or change the subscription. Next: deploy, set protected runtime
keys, verify actual HTTP prices, then publish the verified endpoint. The independent
latency experiment and forward validation still remain; this plumbing work does not
supersede those research gates.
