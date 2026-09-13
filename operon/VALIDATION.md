# OPERON 2 validation — 13 September 2026

## Result

19 automated core/API tests passed locally. Initial release commit `166de332e7ee5b601ce46b4a7b9fd9418bb78439` passed the GitHub Pages deployment workflow, run `34741986837`. The public frontend was opened and exercised in the browser at https://tufeeq.github.io/ai/operon/.

## Automated evidence

- Full server account/session lifecycle, workspace isolation, membership invitation binding and expiry checks in code, role enforcement, CSRF and origin rejection.
- Optimistic version conflict rejection, repeat-request idempotency, conflicting idempotency-key rejection.
- Database persistence and session usability after stopping and restarting the server.
- Source changes block previously approved execution; fresh detection invalidates the approval.
- Complete decision → approval → task → completion → evidence → outcome lifecycle.
- Rejection requires a reason; duplicate execution cannot create another task.
- Payment recording checks balance, updates cash, and rejects repeated receipt references.
- Winning a deal creates one linked project and optional deposit invoice, without inventing cash.
- CSV parsing and validation, import atomicity, name-based import deduplication, foreign customer rejection, safe CSV export.
- Scenario isolation: modeled bookings are not cash; simulation leaves source records unchanged.
- Backup restore rejects unsafe identifiers and disables inherited automatic cycles.
- Legacy engine regression and 10,000 legacy synthetic stress scenarios retained in the deployment gate.

Run `npm test` from `operon/` to reproduce the current 19-test suite. The API test uses its own temporary database and removes it afterward.

## Browser-observed evidence

| Workflow | Observed result |
| --- | --- |
| Command center | Rendered with record-derived KPIs and explicit sandbox label |
| Decision approval | Changed to Approved without creating a task or a financial outcome |
| Execution assignment | Created a linked Todo task and changed decision to Executing |
| Task completion | Saved notes, changed task to Completed, and decision to Awaiting verification |
| Outcome review | Recorded synthetic evidence; showed one verified operational outcome and zero recorded collections/savings |
| Reload | Outcome ledger and workspace state remained present |
| Sales handoff | Created ninth project and a SAR 16,250 deposit invoice from a SAR 65,000 deal |
| Partial receipt | Recorded a synthetic SAR 250 receipt against that invoice; remaining status stayed Open |
| Visual inspection | Desktop command center screenshot inspected; mobile viewport was not separately exercised |

Browser console inspection surfaced browser-extension metadata errors. The inspected application workflows completed; this is not a claim that every possible client error was exhaustively excluded.

## Accelerated three-day simulation

This advanced a synthetic business date through three days. It was not three elapsed days of continuous production operation and does not validate financial returns or real customer behavior.

| Simulated day | Signals | Persisted decisions | Tasks completed / outcomes recorded | Cash invented |
| --- | ---: | ---: | ---: | ---: |
| 1 | 38 | 38 | 8 | 0 |
| 2 | 39 | 39 | 16 | 0 |
| 3 | 40 | 40 | 24 | 0 |

Separate repeated-company run: 100 synthetic companies, 7,300 business records, 3,800 initial signals. Assertions checked finite nonnegative exposure, no duplicate decisions, one task per decision revision, and zero fabricated cash. Run `npm run simulate` to reproduce.

## Deployment and launch boundary

The frontend is published. The Node/SQLite server is implemented, tested, and packaged with a persistent-volume Docker configuration, but has not been deployed to a public persistent host. GitHub Pages cannot run it.

Billing, external accounting/CRM/messaging connections, banking reconciliation, email verification/recovery, production monitoring and scheduled offsite backups remain launch work. Recommendations are deterministic rules; no language model or learning model is connected. This release must not be represented as a finished commercial SaaS or a revenue-generating business.
