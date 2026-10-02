# Pulse live study 1: pre-registration

This file was written and committed on 2026-10-02, after the close. That is before any signal that carries
news context or a price path existed. Its git commit time is the proof. Nothing here may change after
2026-10-05 09:30 New York, except to add results below the line at the end.

## Why

The live ledger of the consolidated pulse detector (rules `discovery-1c`) shows that most detected bursts lose
money when bought at detection. This matches every earlier study on these signals. The study asks one question:
is there a subset or an entry rule with a positive net expectancy? We measure this prospectively, on data that
did not exist when the rules were chosen.

## Population

- Every ledger entry with rules `discovery-1c` detected in the regular session between 2026-10-05 and 2026-10-16 (New York dates).
- The source is `GET /api/pulse/export?since=2026-10-05`.
- An entry is excluded only if its `observed.path` is empty. That means no consolidated price was seen after
  detection. Report the count of excluded entries.

## Outcome: net 30-minute return with stop (`net30`)

- **Entry:** the detection price `price`.
- **Exit:** the first of these two events.
  - The stop. On the first path point at or below `stop`, exit at `min(stop, that price)`.
  - The last path point at or before 30 minutes. Use `observed.m30` when the path ends earlier.
- **Cost:** subtract a fixed cost of 0.5 percentage points per round trip.
- **Unit:** percent of entry price.

## Hypotheses

Each hypothesis compares `net30` in the group against zero. It also compares the group against its complement.

| ID | Group | Field |
| --- | --- | --- |
| H1 | Fresh news: at least one Alpaca/Benzinga item in the 2 h before detection | `news.count_2h >= 1` |
| H2 | No news in the 24 h before detection | `news.count_24h == 0` |
| H3 | First signal of the day for the symbol | `first_today == true` |
| H4 | Price at least $2 | `price >= 2` |
| H5 | First hour of the session | `minutes_since_open <= 60` |
| H6 | Pullback entry (alternative entry, all signals) | see below |

**H6 rule.**
- **Entry:** enter only if a path point within 15 minutes of detection is at or below `price × 0.98`
  and still above `stop`. The entry is at that point's price.
- **Exit:** the stop, or 30 minutes after entry, whichever comes first. Exit at the last path point at or
  before then; the path covers 60 minutes.
- **Cost:** the same.
- **No pullback:** the signal is not traded, and it is counted as "no trade", not as zero.

## Split and decision rule

- **Development:** 2026-10-05 to 2026-10-09. Holdout: 2026-10-12 to 2026-10-16.
- If the holdout has fewer than 250 signals, extend it by whole weeks until it has 250. Do not look at the
  holdout before that.
- **A group counts as promising only if all of these hold:**
  1. Mean `net30` is positive in development.
  2. In the holdout, the group has n ≥ 60 trades.
  3. In the holdout, mean `net30` > 0, with a day-block bootstrap lower bound above 0. The bootstrap uses
     10,000 resamples at the 99.2% level, which is Bonferroni for 6 tests at 95%.
- A promising group is still not a recommendation. It becomes the rule for study 2, a fresh forward test
  with the same rules.
- If no group passes, the honest result is that these bursts have no tradable long edge. Publish that result.

## Known limits

- Path points are taken when the service sees a consolidated price. This happens about every 1–2 minutes
  for symbols that signalled in the last hour, so the stop and pullback fills are approximate.
- News is what Alpaca (Benzinga) carries. SEC filings were tested earlier with no edge and are not part of
  this study.
- No orders are placed at any point.

---

Results (added after evaluation only):
