# TAGit NEXT research interface

Publication target: https://tufeeq.github.io/ai/tagit-next/

This is a read-only Arabic research interface. It has no live market feed, no brokerage integration and no approved trading strategy. All 125 September 2–4 candle-test cases and all ten August 24 quote-exit cases are retained. Unknown returns remain null; no resolved-subset mean is displayed as profitability.

The bundled snapshot is derived from research commit `74f536a294994b89b97d0dc66bcbe9982fe929ae`, specifically `data/study-test.json`, `data/study-manifest.json`, `data/exit-audit.json` and `data/timeout-timing-report.json`. Dates in the interface refer to the research snapshot, not fresh market data. Source data is never replaced by fabricated live rows.

Serve this folder over HTTP. The four public assets are index.html, style.css, app.js and snapshot.json. The main branch publishes only these assets under tagit-next; research engines remain on this independent branch and PR #13 remains draft. The existing Pages workflow preserves all other apps.

For future research cycles, update the snapshot and dated explanatory copy together, verify all rows and missingness, and explicitly publish the four assets to main. The public snapshot does not update automatically when research data changes. Never enable recommendation labels merely because software tests pass.
