# Quote-path exit diagnostic

Extended all ten eligible entry windows from the first twelve chronological BASE
training signals through a 45-minute holding horizon. Retrieved 56,743 SIP quotes,
including a continuation page for the initially truncated NUAI window. BTCT's
capped prefix contains its target exit; data after that exit is unnecessary for
this diagnostic.

The model enters at the eligible displayed ask and exits at the displayed bid,
retaining the frozen original stop and target and charging 0.25% per side.
This is still a historical quote approximation, not actual execution evidence.

- Ten quote-entry candidates; five resolved exit approximations.
- Two timeouts, two stops and one target among resolved cases.
- Two of five resolved returns positive; five other exits unknown because no
  sufficiently fresh quote was available at the timeout.
- Mean among only resolved cases: +1.279%. **This is not a full-sample return or
  evidence of improvement.** Half the candidate outcomes remain unknown and one
  large positive result strongly influences the mean.

No missing outcome is counted as a win, zero return, or automatically interpolated
price. The model detects exits within an available capped prefix, but never infers
a timeout beyond that prefix. A timeout quote must be within three seconds of the
deadline. Stop gaps use the actual observed lower bid, not the nominal stop price.

Reproduce with `python exit_audit.py`; input data is in
`data/exit-windows.json.gz`. The 41 tests cover bid-based exits, truncation,
staleness and invalid quotes as well as previous engine and data-integrity tests.

The ten candidates belong to development data. No held-out accuracy, actual fills,
portfolio return, verified halt handling or live profitability is claimed. The
frozen earlier study is unchanged. Broader validation and news integration remain
outstanding; the independent app remains research-only.
