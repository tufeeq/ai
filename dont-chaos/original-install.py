#!/usr/bin/env python3
"""Install the verified English story-game release; never unpack in the browser."""
from pathlib import Path
import base64, hashlib, io, json, shutil, subprocess, sys, tarfile
repo=Path(__file__).resolve().parent
parts=sorted(repo.glob('original.part[0-9][0-9]'))
assert len(parts)==13, 'English release chunk count mismatch'
data=base64.b64decode(''.join(p.read_text() for p in parts),validate=True)
assert hashlib.sha256(data).hexdigest()=='360e58d4915a097f80cdb249c076fa537d90da3d2245fe09a6110225632a2882', 'English source checksum mismatch'
work=Path('/tmp/dont-chaos-original-source')
if work.exists(): shutil.rmtree(work)
work.mkdir(parents=True)
with tarfile.open(fileobj=io.BytesIO(data),mode='r:xz') as archive:
    archive.extractall(work,filter='data')
target=Path(sys.argv[1]);target.mkdir(parents=True,exist_ok=True)
# Preserve the previous four-world Arabic implementation and its music.
legacy=target/'directors';legacy.mkdir(exist_ok=True)
for name in ['index.html','style.css','engine.js','renderer.js','sound.js','app.js','manifest.webmanifest','icon.svg','sw.js','README.md']:
    src=target/name
    if src.is_file():shutil.copy2(src,legacy/name)
if (target/'music').exists():shutil.copytree(target/'music',legacy/'music',dirs_exist_ok=True)
# Browser assets are ordinary readable files, with no runtime build dependencies.
for src in (work/'site').iterdir():
    if src.is_file():shutil.copy2(src,target/src.name)
shutil.copy2(work/'README.md',target/'README.md')
for name in ['engine.js','renderer.js','sound.js']:
    (target/name).unlink(missing_ok=True)
for src in (work/'site').glob('*.js'):subprocess.run(['node','--check',str(src)],check=True)
subprocess.run(['node','--test',str(work/'tests/core.test.cjs')],check=True)
html=(target/'index.html').read_text()
assert 'lang="en" dir="ltr"' in html and 'original-4.1.0' in html
names=[p.name for p in (work/'site').iterdir() if p.is_file()]+['README.md','music/neon.mp3','music/orbit.mp3','music/night.mp3','music/temple.mp3','classic/index.html','directors/index.html']
files={name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in sorted(names)}
(target/'original-release.json').write_text(json.dumps({'build':'original-4.1.0','files':files},indent=2))
print('ORIGINAL CHAOS 4.1.0 installed: English, six scenario worlds, animated characters, MP3, replay and revenge.')
