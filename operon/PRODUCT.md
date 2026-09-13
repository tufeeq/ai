# Founder decisions and release acceptance

## Customer and problem

Focus on service companies with fragmented sales, project delivery, finance, and account management. The product's value is closing the gap between noticing a business problem and confirming that someone resolved it. It should not become a disconnected collection of generic AI-officer cards.

## Product decisions

1. The command center is a work surface. Every financial indicator derives from entered records or explicit company assumptions.
2. Records are the source of truth. Recommendations cite exact records; source edits invalidate affected approvals.
3. Approval authorizes work; it does not prove that work happened. Work completion and outcome verification are distinct steps.
4. Sales wins create delivery projects and optional deposit invoices. Payment recording updates invoice balances and cash through a unique receipt reference.
5. Explainable rules precede model suggestions. No fabricated statistical confidence or guaranteed financial impact.
6. Each workspace has separate data and server-enforced roles. Client controls alone are never authorization.
7. External actions stay unavailable until real providers and permissions are connected. No fake “Connected” or “Agent active” badges.
8. Synthetic demonstrations are explicitly labeled and separate from newly created real workspaces.

## Implemented acceptance path

Account creation → empty workspace → customers and imported records → detection → evidence review → approval → assigned work → completion → evidence-backed outcome → persistent ledger → export.

Additional paths: deal win → project/deposit invoice; received payment → partial/full invoice settlement and cash update; invitation → email-bound acceptance → enforced member role; restart → same database and session.

## Remaining launch gates

Deploy the persistent service with HTTPS and backups; connect and test billing; implement verified email and account recovery; select the first accounting/CRM provider and build its reconciliation contract; run a limited real-customer pilot; establish uptime/error monitoring and support ownership. These gates are unfinished and must not be described as delivered because the browser demo works.

## Commercial experiment

Validate with 3–5 service companies using their own operational records. Measure weekly exception resolution time, days overdue, delivery recovery actions completed, and verified outcomes. Price only after observing workload, customer willingness to pay, and delivery cost. No revenue is claimed for this release.
