# TAGX — Independent Early Discovery Engine

TAGX is a clean-generation replacement for the overlay-heavy TAG500 runtime. It reuses lessons, not runtime code.

## Product goal
Detect behavioral regime shifts before a stock becomes an obvious top gainer, then present a concise decision surface: why now, what confirms, what invalidates, how late the origin is, and what data/compliance blocks execution.

## Architecture
1. **Discovery Layer** — market anomaly detection; does not disappear when catalyst/compliance enrichment is incomplete.
2. **Decision Layer** — ranks Early / Forming / Ignition / Late / Exhaustion, explains evidence, confirmation, invalidation and chase risk.
3. **Compliance Layer** — VERIFIED / UNVERIFIED / EXCLUDED is separate from discovery. UNVERIFIED remains visible for research but is not executable.
4. **Training Truth Layer** — intraperiod evidence is never final truth. Final Snapshot Reconciliation is required before outcomes become training labels.

## Lessons inherited from TAG500
- Universe timing matters more than polishing a ranking fed by reactive top-gainer sources.
- First-seen gain is mandatory; huge RVOL after +20–40% is not early discovery.
- Temporal trajectory matters: first seen, velocity, persistence slope and peak-referenced gain retention.
- Catalyst relevance/freshness/timing must be checked before catalyst credit.
- Do not let missing enrichment erase a market anomaly; lower confidence/execution eligibility instead.
- Keep one runtime and one state model; avoid release overlays.
- Executive UX must lead with decision information, not diagnostics.
- Fail closed selectively for execution/training claims, not the entire discovery surface.

## Success KPIs
A new release is useful only if it improves one or more of these on multi-session evaluation:
- **Early Capture @ <10%** — fraction of validated major movers first alerted before +10%.
- **Early Capture @ <20%** — fraction first alerted before +20%.
- **Median Lead Time** — time from first alert to +30% / session high milestone.
- **Remaining Upside at First Alert** — subsequent peak gain from alert price.
- **False Ignition Rate** — high-confidence early alerts that fail to continue.
- **Universe Late-Entry Debt** — major movers whose source-universe first appearance is already >= +20%.

Version count is not a KPI.
