# Alternative deployment: Cloudflare Workers

Status, 2026-09-15: implemented and covered by local adapter tests; NOT deployed.
Cloudflare account access and protected Alpaca runtime credentials remain absent.
This route removes the dependency on Vercel deployment availability; it does not
remove market-data authentication or entitlement requirements.

The Worker reuses the independent quote service and HTTP contract. No legacy
strategy is imported. The existing GitHub Pages interface can stay at its current
URL. Only its verified backend origin needs to change after activation.

## Deployment and activation

1. Authorize the Cloudflare connection, or use an authenticated Cloudflare account
   to import `tufeeq/ai`, branch `tagit-next-independent-20260914`, root directory
   `tagit-next/quote-service`. Use the included `wrangler.jsonc` configuration.
2. Deploy `worker.mjs` with Wrangler (`npx wrangler@4 deploy`). Do not purchase a
   plan or alter billing. If the account cannot deploy under its current plan,
   retain the provider error and stop.
3. In the Worker's protected Secrets settings add `ALPACA_API_KEY_ID` and
   `ALPACA_API_SECRET_KEY`. Never add these to plain-text variables, chat,
   configuration files, browser code, or the repository. Keep `TAGIT_DATA_FEED=iex`
   and `TAGIT_ALLOWED_ORIGIN=https://tufeeq.github.io` as configured.
4. Check the deployed `/api/health`, `/api/universe`, and
   `/api/quotes?symbols=SENS,NUAI,BTCT`. These symbols are integration examples,
   not recommendations. Health reports configuration only, not provider access.
   Confirm original event timestamps, feed, stale-state handling and errors.
5. Only after actual quote responses are verified, set `web/live-config.json`
   `endpoint` to the returned HTTPS Worker origin, update deployment status,
   publish the config to the existing Pages route and verify in the browser.

Without secrets the endpoint deliberately returns
`RUNTIME_CREDENTIALS_NOT_CONFIGURED`, with no fabricated quotes. SIP permission
was previously denied; this alternative does not change that entitlement.

## Scope and limits

The adapter translates standard Request/Response objects into the existing small
HTTP handler. Services/caches are reused per binding object within an isolate;
they are not distributed rate limiting or a persistent recording service.
The UI continues to poll every five seconds, not stream every tick. CORS is an
origin restriction, not authentication. No orders, recommendations, performance
claims or historical research outcomes are changed.

Six adapter tests cover execution without a Node process global, environment
isolation, CORS/methods, missing credentials, unchanged quote timestamps and
redacted errors/rate limits. All 28 Node tests passed locally. This is software
verification; actual hosted execution and Alpaca HTTP access are still unverified.

Official references:
- https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/
- https://developers.cloudflare.com/workers/configuration/secrets/


Alternative build verification: Wrangler 4.132.0 `deploy --dry-run` succeeded
(10.84 KiB bundle). Local workerd startup could not be verified: Wrangler failed
with `uv_interface_addresses returned Unknown system error 1` in this workspace.
The local smoke check timed out after 25 seconds and its process was stopped.
Do not equate the successful build and Node tests with a successful hosted run.
