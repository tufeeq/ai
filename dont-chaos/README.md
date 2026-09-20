# DON'T: CHAOS — playable browser beta 1.0.0

Six original scenario worlds, The Director, crossover runs, deterministic daily challenges, asynchronous friend traps, recorded-input replay, locally generated share cards, local progress, keyboard/touch controls and optional audio.

No accounts, dependencies, analytics, API credentials, camera or microphone access. No real cash prizes. The Director is scripted, not live AI. Scores are stored locally and friend targets are unverified. This release does not include synchronous multiplayer, global leaderboards or licensed celebrity/game characters.

## Release and source
The ordinary static HTML/CSS/JavaScript source, original inline SVG art, manifest, icon and service worker are inside the checksummed release. It is stored as six binary chunks to fit the publishing connector's per-request transfer size. No decoding is done in the player's browser.

From the repository root:

```sh
cat dont-chaos/release.part* > dont-chaos/release.tgz
sha256sum -c dont-chaos/release.sha256
mkdir -p /tmp/dont-chaos
# The verified archive contains only index.html, icon.svg, manifest.webmanifest, sw.js and README.md.
tar -xzf dont-chaos/release.tgz -C /tmp/dont-chaos
python3 -m http.server 8080 --directory /tmp/dont-chaos
```

The existing Pages workflow publishes the extracted assets under `/ai/dont-chaos/` while preserving its existing application directories. Future Pages deployments include this game automatically.

## Verification
Desktop 1440px and emulated mobile 390px layouts checked. Successful complete runs through all six worlds and all 18 crossover encounters. Forbidden actions fail, pause freezes progression, tested recorded-input replays match their original scores, challenge seed/trap/name/score round-trip, malformed payload rejection and deterministic daily courses checked. No uncaught JavaScript exceptions in these checks.

Local browser navigation was restricted by the build environment; game automation used in-memory Chromium documents. Physical iOS/Safari, real-world virality/load and offline service-worker behavior were not certified by those tests. See the delivered source ZIP for editable development sources and test evidence.
