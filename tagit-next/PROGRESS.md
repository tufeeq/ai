# Cumulative research progress

## 2026-09-25 — original-signal clock and execution eligibility

Recovered fresh branch head `2a6c47b46a7a2cfa9d9da0c682ea7228f59fa9b0` from GitHub,
verified its successful CI, and reviewed the baseline/entry/exit/size findings.
Preregistered all six exposed cases and four 100-share delay/cost scenarios in
`2d4a8e1c92bf41a8123fb32752ecd27fc4764ed2` before new market-data retrieval.
Reused two entry windows and all later paths. Four requests returned 121 new SIP
quotes, no errors/truncations; no duplicated downloads or paid changes.

Added an offline adapter to the unchanged shared execution engine. Levels use the
last completed close, never the old ledger's future `entry` open. Coverage gaps and
conflicting same-time updates stop the qualified prefix. Missing potentially
decisive volume stays unknown instead of manufacturing NO_ENTRY. All four fixed
scenarios found five no-entry cases and one unknown, zero simulated positions,
zero resolved returns. These are six cases, not 24 independent observations.

At one-second/base settings: SGLY has no entry-window quote update; AKTX/FWRD/NKLR
fail the 1% volume scenario; BTCT Aug31 exceeds the entry cap; BTCT Aug24 remains
unknown after conflicting same-time sizes. The result is specific to the frozen
close-anchored plan, not a finding that the market offered no opportunities.
Full negative baseline and previous missing-data ledgers reproduce unchanged.
Local checks: 175 Python + 66 Node tests pass; 13 new adapter tests. CI now includes
the signal-clock reproduction. See SIGNAL_CLOCK_FINDINGS.md for all assumptions.

Cumulative: the 322-event bar audit remains 118 resolved proxies, 179 unknown/
ambiguous and 25 no-session entries. The six later quote paths still contain three
stop-price indications and three unknown fresh timeout prices, not verified fills.
Original-signal eligibility is a different evidence layer and does not overwrite
those findings. No final holdout, live-rule change, production merge or order.

Next: freeze a broader sample and a quote-anchored plan at its actual decision
timestamp, then delay entry from that point. Do not loosen this diagnostic's
thresholds or reuse its outcomes as independent validation. Runtime activation
and PIT metadata requirements remain separate and unfulfilled. A current tool
inventory found no dedicated Alpaca historical-news capability; news is UNKNOWN.

## 2026-09-24 — corrected SIP share units and measured quantity limits

Corrected an erroneous paper-observer assumption using Alpaca's dated CTA/UTP
notice: post-November-2025 SIP quote sizes are shares, not round-lot counts. A
versioned normalizer prevents 100x capacity inflation, removes an unnecessary
lot-file gate, and leaves older/unknown encodings unqualified. Existing terminal
outcomes and frozen reports are preserved. This supersedes the lot-metadata
requirement in earlier progress entries, not their negative/unknown results.

Before computing new quantity results, committed the six-case protocol as
`2a190a743cc7d1ba305d9e02bd91e8ac835b82c1`. Reused the full saved quote paths and
minute bars; zero market requests, no holdout access, no live-rule changes. At
100 shares, one case meets displayed-size/1%-volume requirements at both observed
checkpoints, four fail the volume cap and one remains unknown. Three exit prices
remain missing, including two cases with known entry failures. No execution
outcome or profitability claim is created. See SHARE_CAPACITY_FINDINGS.md.
Local full verification passed 162 Python tests and 66 Node tests, with unchanged
reproduction of earlier reports. CI runs the new capacity replay as an added gate.

Cumulative: 322 development events, 118 resolved bar proxies, 179 unknown/ambiguous
and 25 no-session entries; six quote-path cases, five fully retrieved intervals,
three observed stop-price indications and three unknown fresh timeout prices.
These denominators measure different evidence layers and are not interchangeable.
The three-rising-closes hypothesis and prior features remain unapproved; the
negative baseline is unchanged. No independent final holdout has been opened.

Next: preregister original-signal 30-second entry windows for these six cases and
quantity/latency/cost scenarios, retrieve only missing intervals, and report every
failure/unknown. Do not recast minute-later first-ask anchors as actual signal-time
entries. Live observer activation still requires protected runtime keys and
operational verification; research changes do not imply deployment.

## 2026-09-24 — Phase 2 development ablations and public comparison evidence

User authorized proceeding with Phase 2 and later stages. Frozen two isolated
hypotheses and all 322 current-discovery events in `99d67d31812673da7a4a1ec68a4b577920daef0d`
before new feature calculations. Both use exposed development dates, never an
independent/holdout claim. No live signal rule or conditional plan was changed.

Implemented causal session and prior-ATR features plus same-time 20-session RVOL,
explicit availability/revision handling, a reproducible comparison runner, paired
session-bootstrap intervals and full included/excluded/unknown-feature ledgers.
Calendar localization handles DST and early closes. Reused every stored price bar;
one Alpaca calendar metadata request, zero new price/quote/trade requests.

Core-session filter: 231 selected, 79 evaluated, 152 missing; conditional mean
-1.3207% against -1.4259%, difference +0.1052 pp, 95% CI [-0.0592,+0.3378].
Momentum/ATR: 119 selected, 63 evaluated, 56 missing; conditional mean -1.4532%
against -1.6385% on the same feature-observable population. Difference +0.1853 pp,
95% CI [-0.1034,+0.6426]. ATR unavailable for 199 signals, retained separately.
Both Bonferroni-adjusted intervals also cross zero. Neither filter is approved;
no accuracy/remaining-upside/expectancy improvement is established. RVOL cannot
yet be evaluated on only ten stored sessions or an unverified split-volume basis.

Added an RTL evidence table with validation of counts, arithmetic and claim status;
updated README, feature registry, implementation status and PHASE2_FINDINGS.md.
One-command reproduction: `make -C tagit-next phase2`. Local full checks passed
110 Python and 62 Node tests and exact negative baseline reproduction. CI includes
the new artifact replay. Software tests are not trading validation.

Existing background/SQLite/stream/paper and Sharia adapters remain unactivated
pending documented runtime/data/licensing decisions. No paid change, deployment,
order or production merge. Next: qualify PIT/split metadata and preceding RVOL
history under a frozen retrieval manifest; independent comparisons require new
qualified dates and complete quote entry/exit observations. Keep the final holdout
locked, preserve both negative studies, and do not tune these thresholds again on
this sample.

## 2026-09-24 — server observation, exact scanner replay and phased delivery

Extended the approved implementation without altering discovery-1. Added persistent
SQLite signal/scan/event/HTTP evidence, source WebSocket with browser SSE fallback,
opt-in background regular-session scanning, and a paper evaluator calling the same
Phase 1 execution function. Entry-size conversion requires dated round-lot metadata;
partial feeds/gaps remain unknown. A captured-clock replay now reproduces concurrent
scanner responses, cache hits and original scan output, with corruption checks.

Added RTL server performance page and a live-only Zoya adapter that refuses to
declare compliance when financial-statement dates are absent. Added a review-only
Docker/persistent-host template; no paid deployment or subscription change.

Two preregistered Alpaca metadata calls returned a 251-session calendar and current
SENS reference fields. The latter has no historical share-count/publication fields;
the calendar does not establish price/universe coverage. Zero new price-data calls.
Local verification: 98 Python tests and 60 Node test-runner cases passed, including
HTTP-to-SQLite-to-replay integration; existing browser opportunity assertions also
ran. CI additionally builds and starts the credential-free mixed-runtime container.

Phase 1 still lacks the full historical PIT dataset and calibrated execution;
Phase 2 features are registered but NOT TESTED, no holdout opened. All earlier
negative/unknown results retained. Render connector requires confirmation of the
listed My Workspace before service access. Activation also needs approved hosting,
runtime keys/entitlement and durable-volume checks. See IMPLEMENTATION_STATUS.md
for exact blockers, prices, scope and next research step.

Initial container CI built the image and imported the Python evaluator, but its
first HTTP probe hit a connection reset immediately after container start. The
readiness check now retries startup transport failures for at most 30 seconds and
prints container logs on failure; it still requires an actual successful health
payload. No application check was removed or converted into a passing assumption.

## 2026-09-24 — approved Phase 1 measurement foundation

Starting from `d6940f3d18cbc7cfbfd4fbcec93f43740bb126ce`, kept discovery-1 rules
unchanged and added an offline, hash-checked reproduction command:
`make -C tagit-next phase1`. All baseline report fields/events reproduced exactly:
322 signals, 84 evaluable, 238 missing, resolved close-return mean -1.4258583700865177%.
The session bootstrap interval for that observed subset is [-2.2325474069001867%,
-0.6613290450628821%], conditional on only ten sessions and incomplete outcomes;
it is neither an independent strategy test nor the expectancy of all signals.

Added availability-ordered event and detector clocks, PIT metadata component,
quote triple-barrier approximation with liquidity/fee sensitivities, metrics,
split/purge checks and fail-closed claim prerequisites. Tests cover future-data
perturbations, delayed completed bars, delisting history, stop latching, deadline
precedence and coverage gaps. Local full suites: 93 Python and 49 service Node
tests passed. New methodology evidence is generated from the audit for the branch
UI. CI now includes the one-command reproduction check.

Zero new market-data calls; no paid changes or strategy promotion. Original
rejected hypotheses, presignal failures and unknown execution outcomes remain
unchanged. Phase 1 is explicitly incomplete: no 12-month PIT universe, full live
shortlist replay, calibrated fills, walk-forward results or untouched holdout yet.
Next: ingestion coverage manifests plus full scanner replay adapter, followed by
PIT source inventory before freezing calendar folds. See `PHASE1_REPORT.md`.

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

Frontend deployment succeeded in Pages run 34994737101; research CI run 34994732934
passed the 72 software checks. Public re-verification from this workspace timed out
in HTTP and browser attempts; local UI checks passed. This failed external check
is retained in LIVE_FINDINGS.md, and no successful direct price connection is claimed.


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


## September 16 — frozen execution-latency experiment

Added a separate 1/3-second entry and 3/30-second exit-wait comparison on six
chronological August 25 development signals, frozen before quote requests in
af7c1118e9773c6326789404f81cb8d938332706. Eight new regression tests pass; 58 Python tests total.
Original evaluator and rejected study outcomes are unchanged. All eight attempted
Alpaca SIP requests failed with internal errors; zero quotes and six PROVIDER_ERROR
cases in each of four scenarios are preserved. No new performance result exists.
See EXECUTION_LATENCY_FINDINGS.md and data/execution-latency-input.json for errors,
request budget (8/20) and exact resume parameters. Next: retrieve the same frozen
windows after recovery, retain failures, then quantify paired delay/price risk.
News coverage remains unknown. No deployment, orders or strategy promotion.


## September 16 — provider recovered; same frozen sample completed

Alpaca recovered during the user-requested continuation. Six successful SIP calls
returned 15,317 quotes: OCGN 1,347; MITK 1,582; SLDB 9,212; MIST 678;
HLLY 622; VUZI 1,876. No response hit 10,000, so no continuation page was needed.
No sample or threshold changed. The eight prior failed requests are preserved in
execution-latency-input.json and in the compressed successful input's request log.
Cumulative requests: 14, including 8 failed + 6 successful; this continuation: 6.

Raw quote input: data/execution-latency-quotes.json.gz. The report now uses that
input when present; it retains the failure-only input as a historical checkpoint.

| Entry delay | Exit quote allowance | Resolved of 6 cases | Unknown exits | No eligible entry |
|---|---|---:|---:|---:|
| 1 second | 3 seconds | 3 | 2 | 1 |
| 1 second | 30 seconds | 5 | 0 | 1 |
| 3 seconds | 3 seconds | 3 | 2 | 1 |
| 3 seconds | 30 seconds | 5 | 0 | 1 |

The three-second cases are one fresh-last-quote timeout (OCGN), two stops
(MITK/HLLY), two unknown timeouts (SLDB/VUZI), and no eligible entry quote (MIST).
The extended allowance observes SLDB's bid 9.67 after 4.204488 seconds,
net quote approximation -1.2139%; VUZI's bid 2.79 after 26.918962 seconds
(1-second entry latency) or 20.608271 seconds (3-second entry latency),
net +0.2197%. These are actual later event timestamps, not backdated fills.
Neither baseline unknown has an executable deadline price, so paired price
slippage versus that missing price cannot be estimated.

For BOTH 30-second scenarios, the five quote-entry approximations comprise four
negative outcomes and one positive outcome, plus the sixth case with no eligible
entry. Per-case net approximations: OCGN -0.4988%, MITK -1.8685%,
SLDB -1.2139%, HLLY -1.8254%, VUZI +0.2197%. No subset mean or portfolio return
is reported. Entry latency shifts HLLY/VUZI event times but not their observed
prices or outcome classifications in this small sample.

Conclusion: the longer wait reduces unknown quote observations in this sample;
it does NOT improve the detector or establish favorable expectancy. Reject any
claim that resolving these unknowns constitutes trading success. Keep the original
policy unchanged. No quotes prove actual fills, continuous availability, queue
position, halt status or historical receipt latency. Original August 24 unknowns
and all rejected strategy findings are unchanged.

58 Python tests passed locally; CI retains the exact report replay and original
diagnostic checks. No production UI or live endpoint was changed; Cloudflare
tools remain unavailable and news archive coverage remains unknown.

Next bounded research step: freeze a timestamped, pre-signal quote-liquidity
feature study on additional development cases BEFORE retrieving those windows;
use negative controls and full failure accounting. A new untouched future period
and prospective bid/ask observations are necessary before a performance claim.
Do not retune this six-case sample or promote the 30-second policy.

## September 16 — watchlist integrity and published execution evidence

Recovered `9685012e16c7c823a385aaecef4882d7398a085a`, passed the existing 58
Python and 28 Node tests. Rechecked three real IEX snapshots through the connector:
requests succeeded but some events were stale and spreads wide. A current SIP
snapshot request failed with `premium_feed_required` / recent SIP not permitted.
Connector success still does not provision the hosted service.

Repairs in this cycle:
- A mixed watchlist now fetches eligible symbols and explicitly lists excluded
  symbols, rather than suppressing the entire response. Excluded symbols never
  reach the provider; no eligible symbols still returns 422.
- Client validation now checks timestamp/age consistency, response receipt time,
  per-row reference age, finite numeric sizes, feed/status agreement, and complete
  non-overlapping symbol accounting. A failed refresh clears the connection badge.
- Added an activation probe requiring successful health, CORS and an actual validated
  price response. It writes the public endpoint only after those checks pass; it
  reports freshness separately and never promotes the trading strategy.
- Exported the exact frozen six-case execution diagnostic into the Arabic page with
  four selectable timing scenarios. All unknowns and the no-entry case remain.
  CI checks the public report against the frozen diagnostic byte for byte.

Validation: 58 Python + 40 Node tests pass. Trading rules and historical study data
are unchanged; no improved accuracy or profitability is claimed.

Hosting observations: the connected Vercel team exists, but lists no projects and
returns 404 for the former project ID. The prior quota reset record is September 16
16:13 UTC, still in the future during this work; no billable upgrade was attempted.
Cloudflare was offered for installation/connection and is not confirmed connected.
No runtime Alpaca credentials were available. Endpoint remains null with an accurate
HOSTING_ACCESS_REQUIRED state instead of asserting the old quota is the only cause.
The cloud browser cannot open the local test server (ERR_BLOCKED_BY_CLIENT); this is
an environment restriction, not evidence of a broken page or a passed browser test.

Required to activate: connect an accessible host, set protected Alpaca data keys,
run the activation probe against the deployed HTTP origin, then publish the verified
endpoint. IEX observations remain limited to one exchange; real-time SIP requires an
entitled data subscription. No live orders were placed.

Publication verification: source CI 35103153193 and Pages deployment 35103227324
succeeded. The public page loaded the new execution panel; selecting 1-second entry /
30-second exit showed four negative outcomes, one positive and one no-entry case,
including SLDB 4.204s and VUZI 26.919s late exits. Detected mixed cached JS on the
published page and added explicit asset release parameters, including the imported
price-state module. No app-origin JS error was observed; browser-extension telemetry
errors were unrelated. Desktop interaction verified; no new mobile browser result
is claimed in this cycle.


## 2026-09-22 — prevent entries after a stop breach during processing delay

Recovered branch head 6ba65cdfd0f5607c682d7f8f7b5e1c70cdbdf276; its CI passed (run 35137575071).
The latest head records live-watchlist filter changes; those files were left untouched. The
historical research universe remains below $1B; this repair neither expands nor
changes the newer live NASDAQ under-$100M filter.

Found an entry-audit causality defect: quotes before the assumed 1/3-second
processing delay were skipped before checking stop invalidation. Thus a valid
stop breach after setup creation but before entry eligibility could be forgotten
and a subsequent rebound labelled eligible. This contradicts the documented
no-resurrection rule. Entry now remains delayed, but observed stop breaches
invalidate the setup from its creation time. Quotes before setup creation and
after expiration still cannot invalidate it retroactively.

Seven new synthetic regression tests cover a breach during 1/3-second latency,
a breach at setup creation, pre-setup quotes, invalid zero-size quotes, exclusion
of pre-latency entries, preservation of prior entry observations and expiry.
Before the repair three assertions failed; after it all 65 Python tests pass,
with no skips. Synthetic fixtures are NOT historical market observations.

Recovered saved quote blobs by immutable GitHub URLs and verified their Git blob
hashes. Replaying the 12-case entry audit (10,375 quotes), six-case/four-scenario
latency study (15,317 quotes), and ten-case exit audit (56,743 quotes) produced
exactly unchanged reports. The old five unknown exits remain unknown. This fixes
a real software error, but demonstrates no improvement in measured profitability
or discovery accuracy on those samples.

No new market history downloaded: zero historical requests. One Alpaca clock
check succeeded; it does not verify hosted price connectivity. No timestamped news
archive tool was available; news coverage remains UNKNOWN. No orders, deployment,
production merge, old engine imports or policy promotion. Evidence:
data/entry-causality-check.json.

Next: predeclare a pre-signal quote-liquidity feature study on additional
development cases and matched non-signal controls before collecting their windows.
Keep prior validation/test periods separate; do not choose thresholds based on
the already observed August 24/25 outcomes. Forward bid/ask evidence is still needed.


## 2026-09-23 — frozen pre-signal quote-liquidity feature study

Frozen an outcome-independent eight-signal August 26 development sample and same-
symbol ten-minute controls before retrieval in `19bc2b9e593a5b7bf857bcf51bc859b1b4ae89cf`. Eight SIP
requests returned 10,607 quotes; none were capped or failed. The primary descriptive
hypothesis passed in 7/8 pairs: signal windows usually had higher quote-update rates
without wider median spread. This may reflect activity already captured by the
price/volume detector and is not a remaining-move or profitability result.

The predeclared liquidity-ready gate could not be evaluated: groups were 6 ready
and 2 not ready, below the minimum of three each. Quote entry was observed in 5/6
ready versus 2/2 not-ready cases, so this evidence does not justify filtering
signals. Known candle outcomes (six ENTRY_NOT_AVAILABLE, one STOP, one TIMEOUT)
were not used for selection. No return aggregate or accuracy claim.

Added a reproducible analyzer, eight regression tests, raw data, exact report and
CI replay; all 73 Python tests pass locally. Data budget: 8/20 requests. News
coverage remains unknown. No orders, deployment or production promotion. See
[PRESIGNAL_LIQUIDITY_FINDINGS.md](PRESIGNAL_LIQUIDITY_FINDINGS.md). Next: freeze
the identical features on a deterministic August 31–September 1 validation sample,
without retuning these development results.


## 2026-09-24 — independent replication rejects the liquidity gate

Recovered branch head `adffe76771de868446818f5d0ac45d1e3c96c86d`; its CI passed
(run 35824964530). The identical pre-signal features were frozen on twelve
deterministically selected BASE validation signals from August 31–September 1
before quote retrieval in `7e70712adf295ca567691c74acfb3f11c54c5f98`.
Selection used only SHA256(seed|signal ID); known candle outcomes did not select
cases or thresholds. The replication threshold was fixed at 9/12, preserving the
development study's 75% paired rate. Liquidity-ready remained five quotes, p90
spread <=80 bps and terminal age <=3 seconds.

Twelve SIP requests returned 8,979 quotes with zero failures and zero capped
responses. Raw windows were saved before analysis in
`2259316f79c4b57a4a46f8102adf8e8039b5efa9`. Data budget: 12/20 requests.
The descriptive activity result replicated in 10/12 pairs, but this can reflect
activity already captured by the detector and does not measure remaining upside.

The false-signal/executability hypothesis was decisively rejected: groups were
adequate at seven ready and five not-ready, yet quote entry was observed in 7/7 and
5/5 respectively, a zero percentage-point difference. Do not add this gate. All
twelve cases had an eligible quote event although their candle labels included six
ENTRY_NOT_AVAILABLE, two UNSCORABLE_GAP, two UNRESOLVED, one NO_NEXT_MINUTE and one
TIMEOUT. That is a data-resolution correction, not proof of favorable fills or exits.

Updated the analyzer to use frozen per-protocol thresholds while preserving the
old development report byte-for-byte. Added exact replay and selection-integrity
checks; all 78 Python tests pass locally. No return aggregate, accuracy, order,
deployment, subscription change or production promotion. News remains
UNKNOWN_NOT_CONNECTED. See
[PRESIGNAL_VALIDATION_FINDINGS.md](PRESIGNAL_VALIDATION_FINDINGS.md).

Next: freeze a prospective, post-protocol sample with actual observation/receipt
times and complete bid/ask exits, then test whether the replicated activity change
predicts remaining movement after executable entry. Preserve all negative, missing
and halted cases; do not tune on either historical feature sample.
