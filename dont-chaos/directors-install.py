#!/usr/bin/env python3
"""Verified source-only release; unpack at build time, never in the browser."""
from pathlib import Path
import hashlib, io, os, shutil, subprocess, sys, tarfile
repo=Path(__file__).resolve().parent
parts=sorted(repo.glob('directors.part[0-9][0-9]'))
data=b''.join(p.read_bytes() for p in parts)
expected=(repo/'directors.sha256').read_text().split()[0]
assert hashlib.sha256(data).hexdigest()==expected,'Source release checksum mismatch'
work=Path('/tmp/dont-chaos-v3-source')
if work.exists():shutil.rmtree(work)
work.mkdir(parents=True)
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:archive.extractall(work,filter='data')
target=Path(sys.argv[1]);target.mkdir(parents=True,exist_ok=True)
# Preserve the actual v2 implementation, including its local records and UI.
classic=target/'classic';classic.mkdir(exist_ok=True)
for name in ['index.html','manifest.webmanifest','icon.svg','sw.js','README.md']:
 if (target/name).is_file():shutil.copy2(target/name,classic/name)
if (classic/'sw.js').exists():
 old=(classic/'sw.js').read_text().replace('dont-chaos-shell-','dont-chaos-classic-')
 (classic/'sw.js').write_text(old)
for src in (work/'site').iterdir():
 if src.is_file():shutil.copy2(src,target/src.name)
# Provision the encoder only on the disposable GitHub-hosted build runner.
if not shutil.which('ffmpeg'):
 if os.environ.get('GITHUB_ACTIONS')!='true':
  raise RuntimeError('Install ffmpeg before building the original MP3 soundtrack.')
 subprocess.run(['sudo','apt-get','update','-qq'],check=True)
 subprocess.run(['sudo','apt-get','install','-y','--no-install-recommends','ffmpeg'],check=True)
# Music is a separately rendered, ordinary MP3 asset on the same origin.
subprocess.run([sys.executable,str(work/'source/music.py'),str(target/'music')],check=True)
for src in (work/'site').glob('*.js'):subprocess.run(['node','--check',str(src)],check=True)
subprocess.run(['node','--test',str(work/'tests/core.test.cjs')],check=True)
print('DIRECTORS CUT 3.0.0 installed; v2 preserved at classic/.')
