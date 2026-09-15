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
