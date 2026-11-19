import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'VaultAI-src.zip');
if (existsSync(out)) unlinkSync(out);

execSync(`python3 - <<'PY'
import zipfile, os
from pathlib import Path
root = Path(${JSON.stringify(root)})
out = Path(${JSON.stringify(out)})
skip_dirs = {'node_modules', 'release', 'dist', 'data', '.git', '.cache', 'win-unpacked', 'results', 'pw-artifacts', 'tmp'}
skip_names = {'.DS_Store'}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob('*'):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        if any(part in skip_dirs for part in rel.parts):
            continue
        if p.name in skip_names or p.suffix == '.log':
            continue
        # never ship real vault data; the synthetic test vaults under e2e/fixtures are required by the migration E2E
        if ('vault.data' in p.name or p.name.endswith('.vault')) and rel.parts[:2] != ('e2e', 'fixtures'):
            continue
        z.write(p, Path('VaultAI') / rel)
print('wrote', out, 'bytes', out.stat().st_size)
PY`)
console.log('Source zip:', out);
