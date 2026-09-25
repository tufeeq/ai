# Pre-signal quote-liquidity validation — September 24, 2026

## Frozen design

The validation protocol was committed before any quote request in
`7e70712adf295ca567691c74acfb3f11c54c5f98`. It selects the twelve smallest
SHA256 ranks from all 83 BASE signals in the already-frozen August 31–September 1
validation ledger. The seed and signal ID are the only ranking inputs. Known candle
outcomes are retained for audit after selection and do not affect the sample,
features or thresholds.

Feature definitions were copied without retuning from the August 26 development
study: a strict 60-second pre-event window, quote-event rate, median/p90 spread,
displayed notional and terminal quote age. Liquidity-ready still means at least
five valid quotes, p90 spread at most 80 bps, and a terminal quote no more than
three seconds old. The paired replication threshold is 9/12, the same predeclared
75% rate as development's 6/8. The false-signal/executability comparison still
requires at least three ready and three not-ready cases and a 25-point entry-rate
advantage.

## Data and complete results

Twelve Alpaca SIP requests returned 8,979 quotes. No request failed or reached the
10,000-record cap. Counts were: SENS 205; FWRD 614; AIRJ August 31 791; PAL 712;
NUAI September 1 at 15:31 1,236; PROK at 19:51 603; NUAI at 17:36 1,282;
AIRJ September 1 887; NHP 129; STIM 666; PROK at 19:03 929; and NUAI August 31
925. Raw responses were committed without selecting results in
`2259316f79c4b57a4a46f8102adf8e8039b5efa9`.

The descriptive paired feature **replicated in 10 of 12 pairs**, above the frozen
9/12 threshold. AIRJ on August 31 failed because its median spread widened despite
more updates; NUAI at 17:36 on September 1 failed because its update rate fell
despite a slightly narrower spread. Thus quote activity commonly intensified near
signals on a second period. This still does not test remaining upside or profitability
and may simply measure activity already used by the price/volume detector.

The liquidity-ready gate **failed** the predeclared secondary check. Both groups
were adequate: seven ready and five not-ready. A quote-eligible entry was observed
in 7/7 ready and 5/5 not-ready cases, a zero percentage-point difference. The rule
therefore did not separate executable from non-executable setups and must not be
added as a false-signal filter.

The twelve candle labels were six ENTRY_NOT_AVAILABLE, two UNSCORABLE_GAP, two
UNRESOLVED, one NO_NEXT_MINUTE and one TIMEOUT. All twelve later had eligible quote
events under the frozen entry audit. This identifies candle-data measurement gaps;
it is not evidence of fills, favorable exits, remaining 15–200% moves or profit.
No exit replay, subset return, accuracy or portfolio result is reported.

## Integrity, decision and next step

The analyzer now reads protocol-specific thresholds, while replaying the prior
development report byte-for-byte unchanged. Five new tests cover the 9/12 threshold,
deterministic selection, non-signal controls, complete uncapped raw windows and exact
report replay. All 78 Python tests pass locally. CI also regenerates both development
and validation reports exactly.

Historical exchange event timestamps are not receipt timestamps, orders, queue
position, continuous liquidity or halt verification. The engine's validation ledger
and its candle outcomes existed before this feature replication, so this is a clean
replication of feature definitions but not a wholly untouched trading-performance
test. News coverage remains `UNKNOWN_NOT_CONNECTED`.

Decision: retain higher pre-signal quote activity only as a replicated descriptive
observation. Reject liquidity-ready as an executability or false-signal gate; do not
promote the detector, change trading rules or publish recommendations.

Next: predeclare a prospective sample collected after the protocol timestamp and
record actual observation/receipt times plus complete bid/ask exits. Test whether
the replicated activity change predicts **remaining movement after an executable
entry**, including every negative, missing and halted case. Do not tune on the
August 26 or August 31–September 1 samples.
