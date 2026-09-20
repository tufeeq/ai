"""Reconstruct the verified TURBO bundle. Copy/insert data only; no dynamic execution."""
from pathlib import Path
import hashlib,json,zlib,sys,subprocess
root=Path(__file__).resolve().parent
site=Path(sys.argv[1] if len(sys.argv)>1 else '_site/dont-chaos')
parts=sorted(root.glob('turbo.delta.part*'))
if len(parts)!=4:raise SystemExit('Expected exactly four TURBO delta parts')
packed=b''.join(p.read_bytes() for p in parts)
expected=(root/'turbo.delta.sha256').read_text().strip().split()[0]
if hashlib.sha256(packed).hexdigest()!=expected:raise SystemExit('TURBO transfer checksum mismatch')
patch=json.loads(zlib.decompress(packed))
base=(site/'index.html').read_text()
if hashlib.sha256(base.encode()).hexdigest()!=patch['base']:raise SystemExit('Unexpected v1 base; refusing to patch')
chunks=[]
for op in patch['ops']:
    if isinstance(op,str):chunks.append(op)
    elif isinstance(op,list) and len(op)==2 and all(isinstance(n,int) and n>=0 for n in op) and sum(op)<=len(base):chunks.append(base[op[0]:op[0]+op[1]])
    else:raise SystemExit('Invalid copy/insert operation')
html=''.join(chunks)
if hashlib.sha256(html.encode()).hexdigest()!=patch['result']:raise SystemExit('Reconstructed TURBO checksum mismatch')
(site/'index.html').write_text(html)
for name,content in patch['files'].items():
    if name not in {'sw.js','manifest.webmanifest','README.md'}:raise SystemExit('Unexpected asset name')
    (site/name).write_text(content)
# Validate the exact combined production script, not only source modules.
script=html.split('<script>',1)[1].split('</script>',1)[0]
check=site/'turbo-check.js';check.write_text(script)
subprocess.run(['node','--check',str(check)],check=True);check.unlink()
json.loads((site/'manifest.webmanifest').read_text())
print('TURBO 2.0.0 verified:',len(html.encode()),'bytes; SHA256',patch['result'])
