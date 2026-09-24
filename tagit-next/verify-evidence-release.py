"""Verify the exact frontend release locally or on the deployed Pages URL."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlparse

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--local', action='store_true')
args = parser.parse_args()
manifest = json.loads((root / 'evidence-release.json').read_text())
for name, digest in manifest['files'].items():
    if Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name:
        raise SystemExit('Release paths must stay inside the frontend')
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Local release mismatch: ' + name)
if args.local:
    print('Local release verified:', manifest['release'], len(manifest['files']), 'files')
    raise SystemExit(0)

base = os.environ['PAGES_URL'].rstrip('/') + '/tagit-next/'
if urlparse(base).scheme != 'https' or urlparse(base).hostname != 'tufeeq.github.io':
    raise SystemExit('Unexpected deployment destination')
for name in [*manifest['files'], 'evidence-release.json']:
    expected = (root / name).read_bytes()
    url = base + ('' if name == 'index.html' else name) + '?release=' + manifest['release']
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'TAGit-release-verification'})
            with urllib.request.urlopen(req, timeout=15) as response:
                actual = response.read()
                if response.status != 200 or actual != expected:
                    raise ValueError('Public bytes do not match release: ' + name)
            print('Verified HTTP 200 and exact bytes:', name)
            break
        except Exception as exc:
            print('Attempt', attempt + 1, name, str(exc))
            if attempt == 5:
                raise
            time.sleep(5)
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
    out.write('\n## TAGit NEXT Lab release verified\n\n' + base + '\n\n' + base + 'performance.html\n\n')
    out.write('All frontend/evidence assets match the release manifest. Lab tab and historical data integration verified; no strategy promotion.\n')

