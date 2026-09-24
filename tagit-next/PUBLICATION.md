# Public frontend publication — 2026-09-24

Published by explicit user request. Browser-verified public URLs:

- https://tufeeq.github.io/ai/tagit-next/
- https://tufeeq.github.io/ai/tagit-next/performance.html

Main commit: `73960916d694dfd1ce8d95172ac578bee1cda641`.
Research source: `d806c0fba654bbb1de4c15b5496f683fa0fd13b8`.
Successful deployment: https://github.com/tufeeq/ai/actions/runs/36016291786

Published Phase 1 evidence, Phase 2 comparisons, a visible main-page link, Arabic
methodology evidence and the performance page. The Pages workflow includes these
assets and verifies their exact public bytes against a release manifest. All
existing application workflow checks were retained.

Production scanner, app logic and live endpoint configuration were preserved.
The research branch was not merged wholesale; no rejected filter, paid host,
continuous observer, stream transport or Sharia integration was activated.

Verification: 14 targeted Node tests passed; full Pages checks/deploy succeeded;
ten manifest assets plus the manifest returned HTTP 200 with matching bytes.
Browser navigation from the main page opened performance.html; the 322/84/238
baseline and both comparisons rendered, including 199 ATR-unknown cases. The main
page reached its existing connected-market state.

The server journal endpoint is not available to this page; the UI reports that
it cannot be reached. This does not affect static evidence and is not presented
as zero live outcomes. Browser proof:
[published performance page](qa/published-evidence-20260924.jpg).
This screenshot proves publication, not trading profitability.

Subsequent frontend releases must update main-branch `evidence-release.json` hashes
for intentional changes and run `verify-evidence-release.py --local`. Research
code/tests and the unopened final holdout remain unchanged.
