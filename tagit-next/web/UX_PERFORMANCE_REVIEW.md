# TAGit NEXT — desk-4 review (2026-09-16)

## Correctness and functionality

- Merge trade and quote timestamps independently. Slow scanner responses cannot overwrite a newer quote or trade. Reject invalid/future observations in the merge. Do not reuse a previous session's close basis after a New York date change.
- Priority remains at least 8/12, with mandatory recent completed bars, $25,000 traded value in three minutes, 30 prints, acceptable concentration, current trade/scan, no excessive extension, and no delayed feed. This prevents weak liquidity from qualifying through unrelated checks.
- Reevaluate live extension, aging checklists and available-plan counts as time passes. Quote request timeout is 12 seconds, separate from cold-start scan timeout. Quote failure is visible and retries continue.
- Persist calculator inputs/results through refresh, invalidate results while editing or when the plan is no longer valid. Amounts are never substituted with defaults.

## Performance

- One assessment per row per second, invalidated on market updates or connection changes; reuse it in sorting, row output and priority groups.
- Reuse Intl number/date formatters. Save observations only when new samples arrive, with existing write throttling.
- Patch existing keyed DOM nodes instead of replacing entire tables/cards. Keep buttons, input focus, disclosure state and scroll containers intact. Timer rendering occurs only when derived states change; quote responses refresh prices.
- Local Node benchmark with a saved 165-row scanner fixture, 101 repetitions: assessment calls fell from 1,710 to 165 for sort/display/group assessment reuse. Median CPU time was 2.54 ms versus 0.27 ms. This measures a local calculation workload, not browser load time, market-data latency, or provider speed.

## Usability

- Collapsible liquidity and Sharia evidence bring the reason for appearance and financial facts closer to the top.
- Reset filters, explicit active-button state for assistive technology, 44px minimum touch targets, reduced-motion styles, and one-column phone calculator.
- Price/status filters are disabled in the journal because they do not apply to historical observations. Quote warnings are separate from scanner connectivity.
- The broad-universe freshness figure is explicitly labeled as measured at the last scan.

## Verification and limits

- 12 automated Node regression tests cover fresh/stale plans, position sizing, observation ordering, priority floors, pressure resets, sourced Sharia checks, independent trade/quote chronology, future timestamps and session boundaries.
- No fabricated live opportunity is introduced for testing.
- IEX remains partial coverage. Snapshot-volume pressure is a proxy, not measured buyer/seller flow. Sharia remains unknown without a dated sourced assessment.
- The current historical study does not establish profitable out-of-sample prediction. This release improves software behavior, not validated forecasting accuracy.
