# TAGit NEXT — shared brief for the expert agents (2026-09-27)

Goal from the owner: make the tool accurate and functional enough to be usable for real trading. Budget ~3 hours of work each. Complete freedom EXCEPT: it must cost the owner nothing (free tiers only, no paid APIs/services, no sign-ups that bill).

## Hard rules (integrity, not bureaucracy)
- Never place real orders or connect a brokerage. The tool is decision support.
- Never claim an edge that has not passed an untouched holdout. Pre-register hypotheses in the file header BEFORE you look at results; dev = first 2/3 of sessions, holdout = last 1/3, session-block bootstrap 95% CI, realistic costs (≥0.5 pp round trip for small caps; add borrow for shorts). Report negative results honestly — the site shows them.
- No look-ahead: a signal on bar t uses only data available at t.
- Don't commit secrets. GitHub secrets for Alpaca are empty; Alpaca is reachable ONLY via the Render relay below, and ONLY from GitHub Actions runners (this sandbox cannot reach onrender.com, Yahoo, Stooq).
- Push only to your own branch `claude/agent-<role>` (workflows in .github/workflows trigger on `claude/**` pushes, which is how you get compute + data). Do not push to main; the lead integrates.
- Do not edit `quote-service/.../scanner.mjs` on the backend branch (frozen by hash).
- If you change index.html/style.css/app.js/opportunity.mjs/src/**, update SHA-256 hashes in tagit-next/evidence-release.json and run `python tagit-next/verify-evidence-release.py --local`. Run `node --test tagit-next/tests/*.test.mjs` before every push.

## System facts
- Frontend: static ES modules, GitHub Pages https://tufeeq.github.io/ai/tagit-next/ (Arabic RTL). Controller app.js; core logic src/core/*; views src/views/*.
- Backend: Render free https://tagit-next-quotes.onrender.com (branch tagit-next-independent-20260914, auto-deploy off; owner redeploys manually). Endpoints /api/scanner, /api/quotes, /api/lab/provider.
- /api/lab/provider = read-only Alpaca relay: resource=bars|quotes|news|calendar|assets; feed=sip allowed if bars ≥16 min old; ≤100 symbols/request; 1Min windows ≤32 days, others ≤800 days; LIMIT 40 req/min shared by EVERYONE (all 5 agents + the live site) and ≤3 pending. Pace ≥3 s/request, back off on 429. Cache fetched bars as workflow artifacts (actions/upload-artifact, then download in later runs via actions/download-artifact with run-id + github-token) instead of refetching.
- Working free sources from runners: SEC EDGAR (User-Agent required), Nasdaq Trader symbol directory + halts RSS, FINRA short-interest API, Nasdaq.com quote/chart (unofficial). Blocked: Yahoo, Stooq, FINRA CDN.
- Pipelines: tagit-next/pipeline/*.mjs|py; helpers in sip_study.mjs (getJson paced, eligibleSymbols, session, label, summarize). Pattern for a study workflow: .github/workflows/tagit-next-daily-study.yml (tests → study → upload artifact → publish data/*.json on main → dispatch pages-tagx-deploy.yml).

## What has already been proven (do not repeat blindly)
1. Intraday burst detector (discovery-1, 3-min surge ≥0.7%, vol ≥2×): 47,124 SIP signals / 183 sessions → mean −0.72%, holdout −0.88% (after 0.5 pp).
2. Exit study: 11 exit rules all negative on holdout (best ≈ −0.70%).
3. Filter study: 332 filter combos; none holds (best dev combo −0.35% holdout).
4. Daily study (daily-study-1, 3,548 Nasdaq names incl. 556 delisted, 2023-01 → 2026-09): strong_close, gap_hold, flush_rebound, quiet_breakout, spike_pullback, momentum_5d — none holds; momentum_5d H5 dev +0.52% → holdout −1.11%; spike_pullback dev +4.6% → holdout −9.6%. Baseline random eligible long: −0.3 to −0.55% after costs.
Interpretation: long-after-the-move in Nasdaq small caps mean-reverts; buyers of extended moves lose. Data in tagit-next/data/*.json.

## Deliverable of every agent
Commits on your branch + a report file tagit-next/reports/<role>.md (English, concise: what you did, evidence with numbers, what is integrated, what is still open, exact run URLs). Your final message to the lead must list the branch, commits, workflow run IDs and results.
