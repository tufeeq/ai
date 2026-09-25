"""Verify stored input hashes and reproduce selection/test without modifying them."""
import gzip
import hashlib
import json
from pathlib import Path
from study import evaluate, heldout, choose, protocol_hash

root=Path(__file__).resolve().parent
manifest=json.loads((root/'data/study-manifest.json').read_text())
for entry in manifest['files']:
    assert hashlib.sha256((root/entry['path']).read_bytes()).hexdigest()==entry['sha256'], entry['path']
protocol=json.loads((root/'data/study-protocol.json').read_text())
path=root/'data/study-selection.json.gz'
selection=json.loads(gzip.decompress(path.read_bytes()))
assert selection['protocol_sha256']==protocol_hash(protocol)
for h in protocol['hypotheses']:
    for phase in ('training','validation'):
        assert evaluate(protocol,protocol[phase],h['overrides'])==selection['results'][h['name']][phase], (h['name'],phase)
assert choose(selection['results'])==selection['selected']
test=json.loads((root/'data/study-test.json').read_text())
assert heldout(protocol,selection)==test
print(f"Verified {manifest['total_bars']} bars, frozen selection, and held-out outcomes")
