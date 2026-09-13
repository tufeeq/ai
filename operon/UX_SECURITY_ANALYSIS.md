# OPERON 2.1 — UX, security, efficiency and productivity review

13 September 2026. Analysis of the implemented source and synthetic benchmark; no customer productivity trial has been performed.

## Decisions reflected in this release

| Finding | Consequence | Implemented change | How to evaluate |
| --- | --- | --- | --- |
| Approval and assignment required separate review screens | Ready decisions waited between authorization and execution | Explicit “Approve & assign” action, atomically enforcing both capabilities and the exposure limit | Compare approval-to-assignment elapsed time and abandonment in a real pilot |
| Completion required opening and editing each task | Extra navigation for routine completion | Direct completion action; separate evidence verification retained | Measure task-completion interaction count and correction rate |
| Dashboard emphasized balances over operational delays | Waiting, overdue and unassigned work were hard to see | Performance dashboard: approval stages, oldest wait, overdue/unassigned/blocked tasks, weekly throughput, median decision cycle with sample size, owner workload and invoice aging | Establish a baseline using real timestamps; compare over equivalent periods |
| Role checks were distributed through commands | Hard to review or adapt authority consistently | Central capability catalog and editable Manager/Operator matrix, enforced in shared domain logic and server requests | Permission tests, denied mutation attempts, review matrix after role changes |
| Member changes lacked an administration audit entry | Reduced traceability of authority changes | Audited invitations, acceptances, revocations and membership changes | Review administrative events in the audit export |
| Session logout was limited to the current account flow | Users could not revoke an older session selectively | Account session list, revoke one other session, revoke all others | Verify revoked cookies immediately fail authentication |
| Removed records could not be recovered | Avoidable recovery effort | Recoverable archive and owner administration recovery center | Archive/restore test, linked-record and payment-ledger retention tests |
| Cycle detection repeatedly searched the entire decision array | Quadratic lookup cost as exception volume grew | Index existing decisions in a Map once per cycle | Reproducible synthetic benchmark below |
| Record and decision views rendered every result | Growing DOM and visual overload | 50-result pagination with search/filter page reset | Test large lists and measure browser responsiveness in a production pilot |
| No coherent acquisition page | Product value and readiness were difficult to understand | Dedicated landing page with use cases, product workflow, assumptions-based value calculator, pilot-brief download, FAQs and explicit readiness boundaries | Observe qualified pilot interest; no analytics or lead delivery service is connected |

## Benchmark: before and after indexed lookup

Command: `node tests/benchmark.mjs` from `operon/`. Node v24.19.0. Five in-process cycles per dataset, median shown. Values exclude HTTP, storage, rendering, and network costs. Small samples and runtime variance limit generalization.

| Synthetic records | Decisions | Before, median ms | After, median ms |
| ---: | ---: | ---: | ---: |
| 73 | 38 | 0.42 | 0.46 |
| 730 | 380 | 4.38 | 3.20 |
| 3,650 | 1,900 | 34.49 | 16.11 |

At the largest tested size, the observed reduction was 53.3%. The smallest dataset changed by 0.04 ms and should be treated as measurement noise, not a meaningful regression. This is not a promise of equivalent customer productivity or cost savings. The database still stores a workspace state document; very large workspaces require normalized persistence, incremental queries, retention policy, and broader load testing.

## Productivity measurement definitions

- Overdue work: uncompleted tasks whose due date precedes the current UTC business date.
- Unassigned work: open tasks with an empty or “Unassigned” owner.
- Seven-day throughput: distinct tasks with recorded completion events during the last seven days. It is an activity measure, not necessarily work still complete today.
- Decision cycle: elapsed time from decision creation to recorded verification; median displayed with sample count. Reopened decisions retain original creation time, so this is cumulative time since first detection, not isolated revision turnaround.
- Oldest approval wait: elapsed time since creation of the oldest pending decision.
- Owner workload: open task counts, not employee productivity scores. Counts omit complexity and available capacity.
- Invoice aging: unpaid balance grouped into 1–7, 8–30, 31–60 and over-60-day overdue buckets.

## Security scope

Implemented: server-enforced workspace isolation; centralized command permissions; fixed owner/viewer boundaries; owner-only financial exposure above threshold; immutable owner administration; CSRF/origin protection; scrypt password hashing including a dummy verification path for unknown accounts; IP and account-keyed login attempt throttling; HttpOnly sessions; optional Secure cookies and HSTS when HTTPS is configured; security headers; bounded request timeouts; invitation revocation; user-scoped session revocation; audited membership changes; restore validation and recoverable archive.

The current matrix governs actions, not row-level or field-level visibility. All workspace members can read workspace records. The public GitHub Pages app is a browser sandbox: its permissions demonstrate behavior but cannot provide multi-user security. Effective server enforcement requires running the persistent backend.

Remaining production work: live backend deployment, TLS/proxy operations, identity verification and recovery, MFA/SSO, distributed rate limiting, offsite backup scheduling, monitoring, billing and external integrations. No penetration-test certification or compliance certification is claimed.

## Marketing scope

The landing page is `welcome.html`; the working product remains at `index.html`. It includes no fabricated testimonials, customer logos, subscription plans, conversion statistics or savings promises. Its value calculator is explicitly assumption-based and excludes implementation/subscription costs. Pilot briefs download locally; no lead or email is transmitted, and no paid order is created. Public analytics are not installed, so marketing conversion performance is currently unmeasured.
