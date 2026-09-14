# TAGit10 10.6: opening patterns and failure evidence

The fixed experiment did **not** establish a profitable trading model. Release 10.6 makes earlier price/volume structures observable and their subsequent outcomes auditable. It does not promote the failed model or change the legacy 10.3 screening thresholds.

## What changed

- An independent closed-5-minute detector can observe an opening impulse after the first five minutes. The legacy scanner needs 30 minutes of complete data and therefore cannot answer this early-opening question.
- Three explicitly defined hypotheses: opening impulse, range breakout and pullback reclaim. High volume without price progress, a strong close and VWAP support does not qualify. Missing opening bars or gaps in the feature window remain unavailable.
- The **Session patterns / أنماط الجلسة** tab shows fresh research observations. They expire after 60 seconds from the 5-minute bar close, require a fresh underlying quote and a common equity, and disappear if the latest price falls below the observed close. These observations never set `tradeEligible` or override the existing screening gates.
- Each observation freezes its detection time, decision time, model identity and feature values before measuring an outcome. A prospective budget of five first-stock observations per family per session leaves room for continuation patterns. Overlapping families are dependent and cannot be added as independent trades.
- The engine measures +3% before −2% over 30 minutes from a delayed entry, and separately +10% / +20% before −2% until close. Entry is the open one full five-minute interval after the decision. Ambiguous bars resolve to the stop; adverse stop gaps use the worse open. Missing bars remain unknown and can be resolved if complete data later arrives. Returns deduct an assumed 0.4% round-trip cost and are not executable fills.
- Frozen observations and resolved outcomes survive session resets and state reconciliation. Pending observations receive bounded scanner priority. The Performance page shows prospective known, unknown, pending and target outcomes by family, separately from historical results.

## Fixed historical experiment

The study verified all 16 stored shard digests and reused **6,496,632 five-minute bars from 1,997 stocks**, with no new downloads. It used 21 training sessions, 6 calibration sessions and 6 later test sessions, separated by two embargo dates. Training contained 210,802 known-outcome examples, including 183,211 high-volume failures or rejection examples. One fixed gradient-boosted return regressor was fitted; its exported inference matched the checked training-library predictions.

| Test method | Alerts | Known / unknown | +3% before −2% | Mean net per known alert |
|---|---:|---:|---:|---:|
| Volume and positive momentum | 30 | 28 / 2 | 9 | −0.6615% |
| Unweighted pattern rules | 30 | 27 / 3 | 9 | −0.2601% |
| Fitted return model, threshold ≥0 | 0 | 0 / 0 | 0 | Unavailable |

The raw-pattern comparison had four +10% outcomes and one +20% outcome before a −2% stop, with eight and nine unknown outcomes respectively. This shows some large moves existed in the sample; it does not establish a profitable method for selecting them. All 30 raw-pattern alerts were opening patterns because the shared five-alert daily budget was consumed early. Continuation families have not passed a separate held-out budget test.

The fitted model selected no nonnegative expected-return setup alerts at any of the four predeclared calibration thresholds, nor in the later test. Model `914c5caece0ca35e` remains `NOT_SUPPORTED_FOR_TRADING`, `promoted: false`. A zero-alert model is not a successful opportunity detector. We did not lower its threshold after examining the test to manufacture passing alerts.

The report's zero-alert active-session count was corrected from six to zero. That reporting fix changes no fitted parameters, selected alerts or return values. The study workflow is manually rerunnable to avoid repeating the same expensive historical fit on every UI or runtime edit.

## Limits and remaining work

These historical dates were already examined by earlier experiments; this is not a new untouched prospective test. The cohort contains current survivors and does not include a complete historical delisted universe. Five-minute historical bars may differ from aggregation of live one-minute bars. Prior-session reference coverage remains necessary and unavailable symbols are not treated as negative examples. Known-outcome training necessarily excludes missing labels; failures are not the same as unknown data.

The replay reports a deliberately severe −100% penalty for unknown outcomes only in the threshold-selection bootstrap stress bound. It is not an observed trading loss and is not included in the displayed mean net return. Neither costs nor spreads have been verified against executable bid/ask quotes.

The live feed still uses Yahoo minute bars, Finviz relative volume and a rotating directory scan. It is not a consolidated streaming feed. Alpaca was connected for this task, but its callable market-data methods were not exposed to this session; a bounded dashboard access attempt timed out. No broker credentials, orders or account configuration were changed. Streaming coverage, quote spreads, timestamped catalysts and point-in-time corporate-action/universe data remain material requirements for a defensible trading validation.

The retrospective five-total-alert policy and prospective five-per-family observation policy must be evaluated separately. Future results must be compared with the frozen baselines, including failed signals, missing data, costs, missed movers and detection delay, before any predictive accuracy is claimed. The user's reported personal 50% loss is not an independently audited brokerage result in these reports.

Software verification establishes that the data and decision rules are implemented consistently. It does not establish trading profitability.

## Reproduce

Run the `TAGit10 fixed session setup study` workflow manually against the stored history to recreate the fixed fit and evidence. For runtime checks, run `PYTHONPATH=tagit10 python -m unittest discover -s tagit10/tests`. The study-summary tests require the pinned NumPy and scikit-learn dependencies in the study workflow. The Quality Regression workflow also exercises the real page in Chromium, including an early opening observation, stale expiry, price invalidation, missing feed states and the mobile paper-plan flow.
