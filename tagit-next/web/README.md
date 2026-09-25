# TAGit NEXT research and quote interface

Phase 1 evidence addition (2026-09-24): publish `phase1.js` and
`phase1-evidence.json` alongside `app.js` when this research branch is reviewed for
publication. Generate/check evidence with `make -C tagit-next phase1` from the repo
root. The new notice is research-only and does not change live signals. Older
deployment descriptions below are historical, not current service health checks.

Published at https://tufeeq.github.io/ai/tagit-next/

Historical records remain pinned to research commit
74f536a294994b89b97d0dc66bcbe9982fe929ae. All 125 test cases and ten quote-exit cases
are present, including unknown exits. No trading strategy is approved.

The price panel uses `live-config.json` and the independent `../quote-service` API.
The endpoint is currently null: deployment was blocked and no runtime keys are set.
See `../LIVE_FINDINGS.md` for the exact blockers, provider checks and activation.
Prices are never populated with fixture or historical research data.

Public assets: index.html, style.css, app.js, snapshot.json, prices.js,
price-state.mjs, live-config.json. Publish all seven together to main/tagit-next
via the existing Pages workflow. Keep endpoint origins HTTPS and credential-free.
Keys belong only in the service runtime. Changes to research source do not update
the public snapshot or endpoint automatically.

The price transport refreshes via HTTP every five seconds while visible; it is not
a tick-by-tick WebSocket stream. Every original price timestamp and advancing age
remain visible. IEX is always labelled single-exchange coverage. Existing historical
research is usable even when the price service is unconfigured or disconnected.
