# TAG elite — release candidate 0.1.0

- Separate interface: `/elite/` on the existing read-only quote host.
- Mode: historical replay plus on-demand shadow observation. No strategy promotion.
- Pre-release checks: 15 new acceptance tests and 62 existing service tests pass; all 322 baseline events reproduce exactly.
- Existing NEXT frontend retained. Added observer hook does not change discovery thresholds or outputs.
- Production persistence gate remains blocked on a verified durable disk; default database is ephemeral and labeled so in the interface/API.
- Published HTTP and browser checks are recorded in the final handoff after the deployment finishes. This file does not claim a deployment succeeded before it is verified.
- Rollback target: previous Render service commit `8f02f78655bf37bac089c80f16a4f3c785b6e710`.
