# TAG elite — shadow release 0.1.0

- Separate interface: `/elite/` on the existing read-only quote host.
- Mode: historical replay plus on-demand shadow observation. No strategy promotion.
- Pre-release checks: 16 new acceptance tests and 62 existing service tests pass; all 322 baseline events reproduce exactly.
- Existing NEXT frontend retained. External transport observer leaves the entire frozen scanner file unchanged.
- Production persistence gate remains blocked on a verified durable disk; default database is ephemeral and labeled so in the interface/API.
- User explicitly authorized updating the existing Render service on 2026-09-25 after the initial authorization gate. Deployment `dep-dar3jl97lnhs739tljt0` reached `live` at 2026-09-25T09:08:32Z, serving commit `72afd73b375f50b6b66f6adeb4c2bd5e2a759677`.
- Running interface: https://tagit-next-quotes.onrender.com/elite/ . Select **رصد حي موازٍ** for on-demand observation. The private static research preview remains archival: https://tag-elite.tufeeq11.chatgpt.site .
- Post-deploy verification: `/api/health`, `/api/elite/status`, `/api/elite/opportunities`, `/elite/` all returned HTTP 200. The actual scanner returned `OK`, IEX, 150 rows at 2026-09-25T09:09:05.292Z. The observer completed without error, wrote 171 input records, and reported zero processed minute bars / zero opportunities at that premarket check. This validates transport and observer invocation, not live detection of a qualifying wave.
- Browser QA on the deployed Render interface: Arabic RTL layout loaded, archived data loaded, the live-mode button switched to shadow observation, and the connection displayed IEX 05:09 NY with temporary storage explicitly disclosed.
- No change to infrastructure plan, continuous worker, order execution, storage durability, or promotion of experimental rules. Historical research constraints remain unchanged.
- Rollback target: previous Render service commit `8f02f78655bf37bac089c80f16a4f3c785b6e710`.
