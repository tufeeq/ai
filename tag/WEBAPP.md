# TAG8 Web App

TAG8 is published as a Progressive Web App on GitHub Pages while preserving the existing analytical engine and data pipelines.

## Web-app layer

- `manifest.webmanifest` — installable app metadata.
- `service-worker.js` — caches only the static application shell. Market/data JSON is explicitly network-only to reduce stale-data risk.
- `webapp.js` — app command bar, source-health dashboard, persistent filters, keyboard shortcuts, install prompt, stock deep links, and manual refresh.
- `webapp.css` — responsive app-shell styling.
- `tag-icon.svg` — PWA icon.

## Data-safety rule

`/tag/data/*.json` is never served from the service-worker cache. If the network cannot return current data, TAG should rely on its existing stale/fail-closed integrity rules rather than silently serving an old market snapshot.

## User experience

- Press `/` to focus stock search.
- Press `R` to refresh live data and source health.
- Filters persist in local storage.
- Stock rows create shareable `#stock=TICKER` routes.
- Source Health displays Finviz, enrichment (Yahoo/News/SEC), and final reconciliation availability/age.
- Supported browsers may install TAG8 as a standalone web app.

## Publishing

The application remains under `tag/` on the `main` branch and is compatible with the repository's existing GitHub Pages deployment:

`https://tufeeq.github.io/ai/tag/`

No predictive-performance claim is implied by the web-app upgrade. Model validation and Final Snapshot Reconciliation remain governed by TAG's existing integrity policies.
