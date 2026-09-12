# MarginOS — Production Architecture

## Target architecture

### Web application
- Next.js App Router + TypeScript
- server-rendered authenticated workspace
- bilingual English/Arabic UI with RTL support
- responsive client approval pages

### Data
- PostgreSQL
- organization-scoped multi-tenancy
- immutable audit events for commercial decisions
- encrypted secrets for integrations

### Authentication
- email magic-link or passkey-first sign-in
- organization membership and role checks on every server mutation
- roles: owner, admin, manager, member, viewer

### AI boundary
The model returns structured JSON only:
- verdict: in_scope | ambiguous | out_of_scope
- confidence
- matched baseline evidence
- extracted work units
- rationale
- clarification questions
- suggested client wording

The model never writes the final commercial amount directly into the ledger.

Pricing is calculated by deterministic server code from:
- configured rate card
- approved work units/hours
- urgency rule
- minimum change fee
- tax settings
- margin floor

### Billing
Moyasar is the initial Saudi/GCC payment adapter.

Two separate payment flows:
1. MarginOS subscription billing.
2. Optional customer payment/deposit attached to an approved change request.

All provider webhooks must be signature-verified and idempotent.

## Core routes

### Workspace
- `GET /app`
- `GET /app/projects`
- `GET /app/projects/:id`
- `GET /app/inbox`
- `GET /app/changes`
- `GET /app/analytics`
- `GET /app/settings`

### Client approval
- `GET /approve/:token`
- `POST /api/public/approvals/:token/decision`
- `POST /api/public/approvals/:token/payment`

## Core API

### Projects
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `POST /api/projects/:id/baselines`
- `POST /api/projects/:id/baselines/:baselineId/freeze`

### Requests and assessment
- `POST /api/requests`
- `POST /api/requests/:id/assess`
- `POST /api/requests/:id/mark-in-scope`
- `POST /api/requests/:id/clarify`

### Change requests
- `POST /api/change-requests`
- `PATCH /api/change-requests/:id`
- `POST /api/change-requests/:id/send`
- `POST /api/change-requests/:id/cancel`

### Integrations
- `POST /api/integrations/email/inbound`
- `POST /api/integrations/slack/events`
- `POST /api/integrations/whatsapp/webhook`
- `POST /api/integrations/moyasar/webhook`

## Required production controls
- tenant scope enforced server-side, never from client-supplied organization IDs alone
- CSRF protection for authenticated mutations
- rate limits on public approval endpoints
- approval tokens stored as hashes, not plaintext
- token expiration and revocation
- webhook replay protection and idempotency keys
- audit event generated for every commercial state change
- database backups and point-in-time recovery
- log redaction for message bodies and payment metadata
- no card data stored by MarginOS

## Request-assessment pipeline
1. Receive request.
2. Normalize text and metadata.
3. Retrieve latest frozen scope baseline.
4. Retrieve explicit exclusions and included revisions.
5. Ask classifier for structured assessment.
6. Validate model output against JSON schema.
7. Calculate risk score.
8. Calculate commercial impact deterministically.
9. Present assessment to human operator.
10. Require explicit action before sending anything to the client.

## Risk score v1
Example deterministic components:
- +25 explicit additive wording ("also", "add", "one more")
- +20 integration/new system dependency
- +15 accelerated deadline
- +15 extra revision round
- +10 bilingual/localization not in baseline
- +10 new deliverable type
- +5 unclear acceptance criteria

Clamp final score to 0–100.

## Commercial calculation v1
```
base = approved_hours * external_hourly_rate
urgency = base * urgency_multiplier
minimum = max(base + urgency, minimum_change_fee)
price = round_to_currency_rule(minimum)
delivery_shift_days = ceil(approved_hours / productive_hours_per_day)
```

## Data ownership
The customer owns project, client and communication data.
MarginOS should support export and deletion workflows at organization level.

## Saudi/GCC compliance path
For the pilot, minimize stored personal data and avoid payment-card storage entirely. Before selling into regulated or large-enterprise customers, complete a formal PDPL/data-transfer review, define retention rules, sign processor agreements, and choose hosting/data-residency options appropriate to customer requirements.

## Environments
- local
- preview
- production

Separate database and payment credentials per environment.

## Production environment variables
- `DATABASE_URL`
- `APP_URL`
- `AUTH_SECRET`
- `OPENAI_API_KEY`
- `MOYASAR_SECRET_KEY`
- `MOYASAR_PUBLISHABLE_KEY`
- `MOYASAR_WEBHOOK_SECRET`
- `EMAIL_INBOUND_SECRET`
- `SLACK_SIGNING_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

Never expose server secrets to browser bundles.

## Definition of production-ready v1
A release is v1 only when a new customer can:
1. sign up,
2. create an organization,
3. create a client/project,
4. freeze a scope baseline,
5. ingest a real request,
6. receive a defensible assessment,
7. create/send a change request,
8. have the client approve it through a unique link,
9. see the decision in the ledger,
10. pay for MarginOS through a real subscription,
11. export the audit trail,
12. delete/export organization data.
