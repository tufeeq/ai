# DON’T: CHAOS — Director’s Cut 3.0.0

Four rebuilt continuous-action games: Neon Getaway (lanes and shield), Orbit Rescue (aim, projectile combat and friendly ships), The Last Shift (sustained flashlight and energy management), and Skybound Temple (gravity, gaps, gems and red crystals). Original layered Canvas 2.5D artwork; not WebGL or AAA assets. Arabic mobile-first UI, five chapter configurations per world, explicit comfortable/balanced/expert pacing. Earlier twelve-world v2 implementation is preserved at ./classic/.

## What changed
Default comfortable movement, explicit three-second countdown, five-second opening grace before hazards spawn, no hidden acceleration. Five health pips and damage protection. Actual objectives rather than passive timer-only completion. Touch, keyboard, hold and drag controls. Deterministic input replay, validated seeded challenge links with unverified client scores, local records, and PNG scorecards.

## Sound
Four original MP3s rendered offline by source/music.py using Python and ffmpeg, served from the same origin. Native HTML media music starts from an explicit button. Web Audio is used only for short effects. Visible playback/error status and an independent native media test player are included. Media time advancing is evidence of browser playback, not proof of physical phone audibility.

## Source and deployment
The checksummed directors.part00–07 archive contains readable HTML, CSS, JS, music renderer and engine tests. directors-install.py reconstructs the source at build time, preserves v2 at classic/, renders the MP3s, and runs syntax and engine tests. No decoding or patching happens in the player's browser. directors-smoke.cjs is the canonical HTTP browser test (supersedes the bundled initial smoke script). The Pages workflow retains the other applications and validates public release bytes, including music.

## Scope and limitations
No camera/microphone, analytics, API credentials, payments, licensed characters, global leaderboard or live multiplayer. The Director is scripted. Thirty-two engine checks passed locally, including input-only automated completion of twenty chapter configurations at comfortable pace on one seed. Those are deterministic correctness tests, not proof of human enjoyment or all possible courses. In-memory Chromium checks verified controls, MP3 playback progress and pause; live HTTP Chrome/WebKit results are recorded separately in the DIRECTORS CUT Actions run. Physical iPhone/Safari speaker output and real-world retention are not certified.
