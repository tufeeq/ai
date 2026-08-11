# TAG5 Web Scanner

Browser-based prototype of the TAG5 early-momentum detection framework.

## Included
- Early Regime Shift Score
- Extended-hours signals (pre-market / after-hours inputs)
- RVOL and float-turnover features
- Discovery / Ignition / Late / Exhaustion classification
- Extended-Hours Persistence concepts
- Catalyst Clock and fresh-catalyst handling
- Exhaustion Memory penalty
- Sharia gate: VERIFIED / UNVERIFIED / EXCLUDED
- CSV import/export
- Manual single-stock analyzer
- Data-integrity warnings and Final Snapshot Reconciliation policy

## Important
This static version does **not** claim a live market-data connection. It analyzes user-supplied or CSV data. A production live scanner requires a licensed/authorized market-data API and server-side secret handling.

## CSV schema
`ticker,price,changePct,volume,avgVolume,float,pmChange,ahChange,ahVolume,catalystAgeHours,spreadPct,sharia`

## GitHub Pages
If Pages is enabled for this repository from the `main` branch/root, open `/tag/` under the repository's Pages URL.

Research and decision-support only; not investment advice.