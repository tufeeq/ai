# Railway deployment (replaces Render)

The quote service runs from the existing `quote-service/Dockerfile`, whose build context is the
`tagit-next/` folder (it copies `quote-service`, `research` and `elite`). `tagit-next/railway.json`
holds the build/deploy settings. Nothing here contains keys.

## One-time setup (≈10 minutes)
1. railway.com → sign in with GitHub → **New Project → Deploy from GitHub repo → `tufeeq/ai`**.
2. Open the new service → **Settings**:
   - **Source → Branch:** `tagit-next-independent-20260914`
   - **Source → Root Directory:** `/tagit-next`
   - **Config-as-code → Railway config file:** `/tagit-next/railway.json`
   - **Deploy → Region:** US East (Virginia)
   - **Deploy → Serverless / App sleeping:** OFF (the service must stay awake)
3. **Variables** (Raw Editor), then paste and fill the two keys:
   ```
   ALPACA_API_KEY_ID=
   ALPACA_API_SECRET_KEY=
   TAGIT_DATA_FEED=iex
   TAGIT_ALLOWED_ORIGIN=https://tufeeq.github.io
   HOST=0.0.0.0
   PORT=10000
   ```
4. **Settings → Networking → Generate Domain**, target port **10000**. Copy the URL
   (e.g. `https://tagit-next-quotes-production.up.railway.app`).
5. Deploy. `https://<your-domain>/api/health` must show `"credentials_configured":true`.
6. Send the URL to the maintainer (or run
   `node scripts/verify-connection.mjs https://<your-domain> SENS,NUAI,BTCT --write-config`)
   so the website and the GitHub Actions pipelines switch from Render to Railway.

Optional: add a **Volume** mounted at `/var/lib/tagit` and set
`TAGIT_JOURNAL_PATH=/var/lib/tagit/journal.sqlite` only if you later enable the background journal
(`TAGIT_BACKGROUND=1`); the default runs from process memory and needs no volume.

After Railway is verified for a few days, suspend or delete the Render service to stop paying for it.
Auto-deploy: every push to `tagit-next-independent-20260914` that touches the watched folders redeploys.
