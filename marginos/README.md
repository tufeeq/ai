# MarginOS MVP

MarginOS is a bilingual margin-protection workspace for agencies, consultancies, studios and professional-services teams.

## Core workflow
1. Freeze a project scope baseline.
2. Paste an inbound client request from WhatsApp, email, Slack, meeting notes or calls.
3. Detect likely scope drift.
4. Calculate deterministic hours, price and delivery impact.
5. Generate a client-facing change request.
6. Record approve/reject decisions in a change ledger.
7. Export commercial history to CSV.

## Why it is different
Most change-order tools start after a human notices the problem. MarginOS is designed around a **Scope Sentinel** that catches the commercial event at the message layer, before unpaid work begins.

## MVP architecture
This version is a dependency-free browser application with local persistence for instant testing. It contains no fake external integrations.

Production adapters to add:
- PostgreSQL multi-tenant persistence
- authentication + organization roles
- OpenAI structured classifier (classification/explanation only; pricing math remains deterministic)
- WhatsApp Business, Slack and email ingestion
- Moyasar subscriptions and approval-payment flows
- immutable audit events + signed approval receipts

## Deployment
Static-host `index.html` under any HTTPS origin. GitHub Pages works without a build step.
