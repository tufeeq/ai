# MarginOS — Product & Commercial Blueprint

## 1. Product thesis
MarginOS is a margin-protection operating layer for agencies, consultancies, studios, software shops and other fixed-scope professional-services teams.

The product watches the gap between **what was sold** and **what the client is now asking for**. It converts that gap into a commercial decision before unpaid work starts.

### Core promise
**Every “can you also…” becomes one of three things: in scope, rejected, or paid.**

## 2. Why this can win
Change-order products already exist. The wedge is not another form. MarginOS starts one step earlier:

1. Store an approved scope baseline.
2. Ingest client messages and meeting notes.
3. Detect likely scope drift automatically.
4. Compare the request to the baseline.
5. Calculate deterministic hours, price and delivery impact.
6. Draft the commercial response.
7. Get client approval without requiring an account.
8. Optionally collect payment/deposit.
9. Update project economics and keep an audit trail.

The durable product is the **Scope Sentinel + commercial decision engine**, not the change-order PDF.

## 3. Initial ICP
### Primary
- Digital agencies
- Branding/design studios
- Software development boutiques
- Marketing agencies
- Management/strategy consultancies
- Training/content production firms

### Starting geography
Saudi Arabia and GCC first, with Arabic/English workflows as a native capability rather than a translated afterthought.

### Best early customer
5–50 employees, 10+ simultaneous client projects, meaningful fixed-fee work, WhatsApp/email-heavy client communication, and recurring margin leakage from “small” requests.

## 4. Product workflow
### A. Project setup
- Client
- Project value
- Currency
- Delivery date
- Commercial model: fixed fee / retainer / hourly / hybrid
- Default internal cost and external rate
- Original scope baseline
- Included revision rounds
- Explicit exclusions

### B. Scope Sentinel
Inputs:
- pasted WhatsApp message
- forwarded email
- Slack message
- meeting note
- call note
- future: WhatsApp Business webhook and email forwarding

Outputs:
- in-scope / ambiguous / out-of-scope verdict
- confidence
- baseline evidence
- likely work units
- hours
- price
- delivery impact
- commercial risk score
- suggested reply

### C. Decision workflow
- Accept as in-scope
- Clarify with client
- Create change request
- Reject/defer

### D. Client approval
No client account required.
Client sees:
- requested change
- what is included
- price
- timeline change
- tax/fees if applicable
- Approve / Reject / Ask a question
- optional payment/deposit

### E. Ledger
Immutable event history:
- request received
- classified
- edited
- sent
- viewed
- approved/rejected
- paid
- implementation started

## 5. Pricing hypothesis
Pricing should be far below the value of one recovered change request.

### Founding Pilot
**SAR 499/month**
- up to 5 users
- unlimited projects
- 250 analyzed requests/month
- approval links
- CSV/PDF export
- Arabic/English
- onboarding included

### Standard post-pilot tiers
**Solo — SAR 199/month**
1 user, 10 active projects.

**Team — SAR 599/month**
5 users, 50 active projects, integrations.

**Studio — SAR 1,499/month**
20 users, unlimited projects, advanced permissions, branded client portal, analytics.

Potential usage add-on: additional AI classifications above plan allowance.

## 6. Revenue model
1. Monthly subscription.
2. Annual plan at ~2 months free.
3. Optional onboarding/data-migration fee for larger teams.
4. Later: payment-processing revenue share where commercially and legally appropriate.

## 7. Saudi payment path
Production billing should use a local payment provider supporting tokenization/recurring billing and common Saudi payment methods. Moyasar is a strong initial candidate for subscription billing and payment links.

## 8. Production data model
Main entities:
- Organization
- User
- Membership
- Client
- Project
- ScopeBaseline
- ScopeItem
- InboundRequest
- ScopeAssessment
- ChangeRequest
- ApprovalLink
- ApprovalDecision
- Payment
- AuditEvent
- Integration
- Subscription

## 9. AI policy
AI can:
- classify requests
- extract work units
- explain why a request conflicts with the baseline
- draft client-facing wording
- propose comparable historical changes

AI must not silently decide price.
Commercial math must stay deterministic and auditable using configured rates, units, margin rules and human-editable assumptions.

## 10. Commercial intelligence moat
Over time, MarginOS learns organization-specific patterns:
- request types that most often become unpaid work
- clients with highest scope-drift frequency
- project types with systematic under-scoping
- actual hours versus estimated change hours
- approval conversion by wording/price/timing
- recurring exclusions that should be added to future proposals

This creates a feedback loop from delivery back into quoting and scoping.

## 11. 30-day launch sequence
### Week 1
- production auth/database
- project + baseline setup
- request capture
- change ledger

### Week 2
- approval links
- email notifications
- bilingual client portal
- PDF receipt

### Week 3
- Moyasar subscription billing
- payment/deposit on approved change
- webhook-driven status updates

### Week 4
- Gmail/email forwarding connector
- Slack connector
- WhatsApp Business connector prototype
- analytics dashboard

## 12. Validation milestones
### Gate 1 — pain
10 service firms onboarded and 100 real client requests analyzed.

### Gate 2 — value
At least 5 customers document previously-unpriced work and at least SAR 25,000 total scope exposure is identified.

### Gate 3 — willingness to pay
3+ paying customers at SAR 499/month or higher.

### Gate 4 — retention signal
At least 60% of pilot customers still using the product weekly after 6 weeks.

## 13. North-star metric
**Recovered / protected gross margin per customer per month.**

Supporting metrics:
- scope-drift requests detected
- value identified
- approval rate
- approval time
- recovered revenue
- avoided delivery days
- active projects monitored

## 14. Positioning
Not project management.
Not invoicing.
Not generic AI chat.

**MarginOS is the commercial control layer between client communication and delivery.**
