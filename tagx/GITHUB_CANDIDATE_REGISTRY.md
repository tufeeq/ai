# TAGX GitHub Candidate Registry

Last reviewed: 2026-08-28

This registry is an evidence log for open-source components/patterns considered by TAGX. No entry is a production dependency unless separately benchmarked and promoted. All market/training use must preserve point-in-time timestamps and avoid look-ahead.

| Repository | Purpose / TAGX layer | Maturity /100 | Integration /100 | Data dependency /100* | Latency suitability | License | Security / causality notes | Decision |
|---|---|---:|---:|---:|---|---|---|---|
| `nikhager/sec-edgar-downloader-jadchaar` (upstream lineage: `jadchaar/sec-edgar-downloader`) | SEC/EDGAR retrieval; Fresh Catalyst, Dilution/Financing, Structural Risk | 82 | 74 | 88 | Event/research, not tick-latency | MIT | README requires SEC-compliant User-Agent; tests/CI/codecov structure present; all filing forms supported. Recent v6 commit 2026-02-02. Preserve SEC filing/acceptance time and never backfill amended knowledge into earlier decisions. The currently discoverable repo is a fork/lineage copy rather than the original URL, so dependency provenance must be verified before installation. | **BORROW PATTERN / SANDBOX** — use direct SEC endpoints and timestamp discipline first; do not add package to production yet. |
| `Lumiwealth/lumibot` | Backtesting/paper trading, broker adapters, agent orchestration, deterministic risk gates | 86 | 58 | 55 | Suitable for paper/replay; not selected as microcap tick-ingestion layer | GPL-3.0 in repository LICENSE | Active: repo pushed 2026-08-26; broad test tree including backtesting, performance and agent-eval harnesses. README currently shows an MIT badge while repository metadata and LICENSE are GPL-3.0; treat the LICENSE file as authoritative until maintainers clarify. Broker/news features require external credentials. Same-strategy backtest/paper pattern is useful, but data-provider differences can create hidden replay/live divergence. | **BORROW PATTERN / REJECT DIRECT INTEGRATION** — borrow research→bull/bear critic→deterministic trader separation and inspectable replay artifacts; do not add GPL dependency to TAGX production. |

\* Higher Data dependency score means easier/safer public-data dependency (low credential/cost burden), not higher data quality.

## 2026-08-28 sweep notes

### SEC retrieval pattern
The SEC downloader pattern is relevant to TAGX false-positive risk because a momentum signal can coexist with financing, merger termination, registration, prospectus, or other structural filings. TAGX now has a dependency-free SEC structural-risk challenger that records only evidence knowable at run time and is not production-active until benchmarked across multiple sessions.

### Lumibot pattern
Lumibot is actively maintained and has useful test/evaluation structure. The most relevant design pattern for TAGX is separation of read-only research/critic agents from the final trading actor plus reuse of the same strategy loop in backtest and paper trading. TAGX should borrow that architecture, not the dependency: our microcap early-capture problem needs stricter point-in-time market-data reconciliation than a generic strategy framework can guarantee, and the GPL-3.0 license plus README-license inconsistency makes direct integration unattractive.
