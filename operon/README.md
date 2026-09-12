# OPERON — Autonomous Business Operating System

OPERON is an AI-native business control layer built around a closed operating loop: **observe → understand → decide → act → verify → learn**.

## Current executable MVP
- CEO Command Center and company health score
- Prioritized Decision Queue with modeled financial exposure
- CFO, Revenue, Delivery, Procurement, Customer and People officer model
- Deterministic decision/risk engine
- Approve/execute simulation with state mutation
- Scenario Lab
- Business Memory examples
- Responsive browser UI

## Architecture target
1. Connector layer: accounting, CRM, email, WhatsApp, project systems, commerce and banking feeds.
2. Canonical Business Graph: organizations, people, customers, vendors, projects, contracts, invoices, transactions, opportunities, messages and events.
3. Signal engine: rules + anomaly detection + model-assisted extraction.
4. Decision engine: evidence, impact, alternatives, confidence, authority and deadline.
5. Policy engine: role permissions, financial thresholds, allowed actions, human approval requirements.
6. Action engine: idempotent external actions with rollback/compensation where supported.
7. Outcome engine: verifies results and attaches outcomes to decisions.
8. Learning layer: decision/outcome history improves future recommendations.

## Safety architecture
No irreversible external action should be executed solely from model prose. Models propose structured decisions; deterministic policy checks authorize actions. Every state-changing action requires tenant scope, audit event, idempotency key and explicit authority.

## Validation thesis
The category is real but increasingly competitive. OPERON should not compete as a generic chatbot or generic all-in-one ERP. The differentiated wedge is a **CEO Decision Queue** that converts fragmented business signals into financially quantified decisions, executes authorized actions, then verifies outcomes.

## MVP test
Run `node operon/test.js` after checkout.
