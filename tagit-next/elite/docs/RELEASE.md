# TAG elite — release candidate 0.1.0

- Separate interface: `/elite/` on the existing read-only quote host.
- Mode: historical replay plus on-demand shadow observation. No strategy promotion.
- Pre-release checks: 16 new acceptance tests and 62 existing service tests pass; all 322 baseline events reproduce exactly.
- Existing NEXT frontend retained. External transport observer leaves the entire frozen scanner file unchanged.
- Production persistence gate remains blocked on a verified durable disk; default database is ephemeral and labeled so in the interface/API.
- Private static review published successfully: https://tag-elite.tufeeq11.chatgpt.site . Live mode is disabled in that review. Render service deployment was rejected by automatic approval review because it changes the existing published service; user authorization is required before retrying. No Render deployment was performed. Browser visual QA was unavailable: local browser installation failed and managed static preview has no compatible browser endpoint; source/data integrity checks passed.
- Rollback target: previous Render service commit `8f02f78655bf37bac089c80f16a4f3c785b6e710`.
