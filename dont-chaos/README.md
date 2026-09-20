# DON'T: CHAOS — TURBO 2.0.0

A mobile-first, local-first scenario arcade. Twelve original worlds, five selectable levels per world (60 level configurations), three hearts, combo multipliers, hit chains, level stars, faster transitions and a level-five boss variant. The first six cards are new action worlds: Neon Chase, Rooftop Ninja, Meteor Raid, Lava Rush, Cannon Cove and Dragon Arena.

## Play
Choose a world and level, then press PLAY. Real instructions appear in green. React using on-screen buttons, A/S/D or a left/right swipe in supported worlds. School uses hold/release. Repeated-hit counters appear for armored enemies in higher levels. Five consecutive saves enable double-score combos. A mistake costs a heart. Three mistakes end the run. Every world has an instantly accessible boss variant; no purchases or unlock wait.

## Audio
Twelve original procedural music themes with melody, bass, chords and percussion, at 128–182 BPM depending on level. Music starts from a player gesture. Separate music/effects switches, master mute and volume are in Profile. The speaker button is visible on mobile. Pause/backgrounding stops the sequencer and suspends the audio context. No audio files, API calls, camera or microphone permissions are required.

## Timing
Encounter response windows start at 1.85 / 1.55 / 1.28 / 1.08 / 1.00 seconds depending on level, with extra time for multi-hit opponents. Successful encounters move on after 0.14 seconds (previously 0.58). World portals auto-start after 3.6 seconds and may be tapped to skip; initial solo countdown is 0.8 seconds. These are designed values, not claims about measured human engagement.

## Records and sharing
Local level stars and v2 score records. v1 scores are retained separately because the scoring model changed; nickname and motion preference migrate. Friend links encode v2 course seed, level, trap, nickname and self-reported score. v1 links are rejected with a clear message. Replays use recorded, encounter-relative inputs. No global leaderboard, live multiplayer, real cash rewards or licensed celebrity characters. The Director is scripted.

## Source and deployment
The downloadable source package contains editable expansion.js, art.js, audio.js, game.js, style.css, turbo.css, shell.html and build.py. The production bundle is ordinary static HTML/CSS/JS. The repository keeps its verified v1 release and applies a checksummed copy/insert delta to reconstruct v2 during Pages builds. No patching or decoding is required in the player's browser.

## Verification limitations
Automated Chromium checks and screenshots are included in the source package. In-memory browser tests do not certify physical iPhone/Safari behavior, human enjoyment or virality. Public deployment checks must be read separately from local browser tests. No persistent background testing is implied.
