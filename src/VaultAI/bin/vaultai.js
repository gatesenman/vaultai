#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'cli', 'index.js');
const src = join(root, 'src', 'cli', 'index.ts');

if (existsSync(dist)) {
  await import(pathToFileURL(dist).href);
} else if (existsSync(src)) {
  const r = spawnSync('npx', ['tsx', src, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  process.exit(r.status ?? 1);
} else {
  console.error('VaultAI CLI not built. Run: npm run build');
  process.exit(1);
}
