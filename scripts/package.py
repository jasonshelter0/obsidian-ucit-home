#!/usr/bin/env python3
"""Package only runtime assets. Never include a vault, data.json or test fixtures."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(['node', str(root / 'scripts/docs.mjs'), 'check'], check=True)
manifest = json.loads((root / 'manifest.json').read_text())
package = json.loads((root / 'package.json').read_text())
assert manifest['id'] == 'ucit-home'
assert manifest['version'] == package['version']
assert json.loads((root / 'versions.json').read_text())[manifest['version']] == manifest['minAppVersion']
out = root / 'dist'
out.mkdir(exist_ok=True)
assets = ['main.js', 'manifest.json', 'styles.css']
for asset in assets:
    shutil.copyfile(root / asset, out / asset)
with zipfile.ZipFile(out / 'ucit-home.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for asset in assets:
        info = zipfile.ZipInfo('ucit-home/' + asset, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / asset).read_bytes())
shutil.copyfile(root / 'docs/usage.json', out / 'usage.json')
with (out / 'SHA256SUMS').open('w') as hashes:
    for asset in assets + ['ucit-home.zip', 'usage.json']:
        hashes.write(hashlib.sha256((out / asset).read_bytes()).hexdigest() + '  ' + asset + '\n')
print('Release ' + manifest['version'] + ': ' + ', '.join(assets + ['ucit-home.zip', 'usage.json', 'SHA256SUMS']))
