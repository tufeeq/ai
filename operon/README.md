# OPERON 2 — Business operations

OPERON converts business exceptions into approved decisions, owned work, and evidence-backed outcomes. Its initial customer is a service business running engagements, retainers, project teams, suppliers, and receivables.

## What is implemented

- Seven business domains: customers, invoices, sales opportunities, delivery projects, vendors, people/capacity, and service tickets.
- Create/edit/remove with validation and relationship checks; customer account overview; cross-record search; CSV import and export.
- Deterministic exception detection with record-level evidence, transparent financial exposure, source revision checks, and deduplication.
- Decision lifecycle: pending → approved → executing → awaiting verification → verified; rejection with reason, revision, reopening, and supersession.
- Execution board with owners, due dates, priorities, progress notes, and decision-linked work.
- Sales-to-delivery handoff: win a deal, create its linked project, and optionally create a deposit invoice atomically.
- Payment recording: unique reference, partial payment support, balance checks, and operating cash update. Records already-received funds; does not move money.
- Outcome ledger separating user-attested collections, savings, bookings, and operational results. Approval never automatically produces financial benefits.
- 30-day cash scenario sensitivity, with sales bookings kept separate from cash receipts.
- Persistent audit history, import history, cycle history, CSV/JSON exports, and database backup utility.
- Server accounts, scrypt password hashing, HttpOnly sessions, CSRF checks, workspace isolation, four roles, email-bound invitation tokens, and membership controls.
- Transactional SQLite persistence, optimistic concurrency, idempotent command receipts, scheduled detection, health endpoint, Docker packaging.
- Existing GitHub Pages frontend remains a clearly labeled interactive browser sandbox with synthetic records and local persistence.

## Run the full server

Requires Node 24 or newer. No package installation is necessary.

```sh
cd operon
npm start
```

Open http://127.0.0.1:3000. Create an account and an empty company workspace. Use the workspace switcher to create a separate synthetic demonstration workspace when needed. The server never seeds a new real workspace automatically.

```sh
npm test
npm run simulate
node backup.mjs
```

SQLite is stored under `data/` by default. `OPERON_DATA_DIR` overrides this. Keep that directory on a persistent volume. Run one application instance; this release is not a horizontally scaled database architecture.

## Deploy the server

```sh
docker compose up --build -d
```

Configure a reverse proxy with HTTPS and set:

- `OPERON_ORIGIN=https://your-domain` (exact origin, no trailing slash)
- `OPERON_SECURE_COOKIES=1`
- `OPERON_DATA_DIR=/data` with a persistent writable volume
- `OPERON_ALLOW_SIGNUP=0` to close registration after account provisioning if desired

The container listens on port 3000 and has a health check. The Compose example binds only to localhost for use behind a reverse proxy. Back up the database off-host using `node backup.mjs /path/to/backup.sqlite`. Restore by stopping the service, retaining the existing database as a rollback copy, restoring a consistent backup into the data directory, and restarting. Never copy only the main live SQLite file while omitting its WAL; use the backup utility.

GitHub Pages serves static files only. It cannot execute this Node service, persist server workspaces, or run scheduled jobs. The Pages version is a sandbox, not the hosted multi-user service. Do not enter confidential company records into a browser sandbox on a shared device.

## Operating loop

1. Create customers, then import or enter linked invoices, opportunities, and projects.
2. Set current cash, monthly operating outflow, and approval authority.
3. Run a cycle to identify exceptions; inspect source evidence.
4. Modify, reject, or approve. Managers are limited by exposure; owners approve larger decisions.
5. Assign the execution task. This creates internal work only.
6. Complete work and add progress notes.
7. Verify the observed outcome with a source reference. Outcomes are user-attested until an external reconciliation adapter is connected.
8. Run subsequent cycles; obsolete pending signals are superseded and approved decisions with changed source records require fresh approval.

## Production boundaries — do not misrepresent these

This is a functional self-hostable operating system release, not a fully launched commercial SaaS. The following are not implemented or activated:

- Hosted persistent production server/domain for this release.
- Paid subscription checkout, billing webhooks, plan enforcement, or tax invoicing compliance.
- Third-party OAuth connectors, banking reconciliation, email/WhatsApp delivery, automatic supplier payments, or autonomous external execution.
- LLM inference, predictive confidence calibration, or automatic model training. Recommendations are deterministic rules; outcome memory is a ledger.
- Email verification, email-based password recovery, MFA/SSO, and enterprise identity provisioning.
- Multi-region redundancy, managed offsite backup scheduling, production alerting, or large-tenant performance qualification.

An invoice created here is an internal operational record, not a certified Saudi e-invoice. Currency is one code per workspace; no FX conversion is performed. Human resource data is used only for workload arithmetic, not hiring or employment eligibility decisions.

## Source and compatibility

The original `engine.js`, `test.js`, and `stress-test.js` remain for historical regression compatibility. The new application uses `core.mjs`, `app.mjs`, and `server.mjs`; it does not call the legacy simulated-execution engine. All frontend assets are relative paths so the sandbox works under `/ai/operon/`.
