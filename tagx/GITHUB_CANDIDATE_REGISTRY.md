# TAGX GitHub Candidate Registry

Last reviewed: 2026-08-28

This registry is an evidence log for open-source components/patterns considered by TAGX. No entry is a production dependency unless separately benchmarked and promoted. All market/training use must preserve point-in-time timestamps and avoid look-ahead.

| Repository | Purpose / TAGX layer | Maturity /100 | Integration /100 | Data dependency /100* | Latency suitability | License | Security / causality notes | Decision |
|---|---|---:|---:|---:|---|---|---|---|
| `nikhager/sec-edgar-downloader-jadchaar` (upstream lineage: `jadchaar/sec-edgar-downloader`) | SEC/EDGAR retrieval; Fresh Catalyst, Dilution/Financing, Structural Risk | 82 | 74 | 88 | Event/research, not tick-latency | MIT | README requires SEC-compliant User-Agent; tests/CI/codecov structure present; all filing forms supported. Recent v6 commit 2026-02-02. Preserve SEC filing/acceptance time and never backfill amended knowledge into earlier decisions. The currently discoverable repo is a fork/lineage copy rather than the original URL, so dependency provenance must be verified before installation. | **BORROW PATTERN / SANDBOX** — use direct SEC endpoints and timestamp discipline first; do not add package to production yet. |

\* Higher Data dependency score means easier/safer public-data dependency (low credential/cost burden), not higher data quality.

## 2026-08-28 sweep notes

The SEC downloader pattern is relevant to recent TAGX false-positive risk because a momentum signal can coexist with financing, merger termination, registration, prospectus, or other structural filings. The package has a broad filing-type surface and a small interface, but TAGX should initially borrow its SEC-compliant retrieval and filing-type abstractions rather than install it. A challenger should record form, accession, filed/accepted timestamp, source URL, and whether the evidence was knowable at signal time. Promotion requires multi-session evidence that the added risk layer reduces adverse excursion/false positives without materially worsening Early-Capture Rate.
