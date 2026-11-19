import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distUi = join(root, 'dist', 'ui');
// UI is served from /ui at project root — ensure it exists; also mirror for packaging
if (existsSync(join(root, 'ui'))) {
  mkdirSync(distUi, { recursive: true });
  cpSync(join(root, 'ui'), distUi, { recursive: true });
  console.log('Copied ui → dist/ui');
}

const preloadSrc = join(root, 'src', 'electron', 'preload.cjs');
if (existsSync(preloadSrc)) {
  mkdirSync(join(root, 'dist', 'electron'), { recursive: true });
  cpSync(preloadSrc, join(root, 'dist', 'electron', 'preload.cjs'));
  console.log('Copied preload.cjs');
}

const pickerPreload = join(root, 'src', 'electron', 'autofill', 'picker-preload.cjs');
if (existsSync(pickerPreload)) {
  mkdirSync(join(root, 'dist', 'electron', 'autofill'), { recursive: true });
  cpSync(pickerPreload, join(root, 'dist', 'electron', 'autofill', 'picker-preload.cjs'));
  console.log('Copied picker-preload.cjs');
}

const sheetPreload = join(root, 'src', 'electron', 'quickcreate', 'sheet-preload.cjs');
if (existsSync(sheetPreload)) {
  mkdirSync(join(root, 'dist', 'electron', 'quickcreate'), { recursive: true });
  cpSync(sheetPreload, join(root, 'dist', 'electron', 'quickcreate', 'sheet-preload.cjs'));
  console.log('Copied sheet-preload.cjs');
}
