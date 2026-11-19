import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve UI static root in dev, dist, and Electron packaged layouts */
export function resolveUiRoot(): string {
  const candidates = [
    process.env.VAULTAI_UI,
    // Electron packaged: extraResources → resources/ui
    process.resourcesPath ? join(process.resourcesPath, 'ui') : '',
    // Running from dist/server
    join(here, '..', '..', 'ui'),
    // Running from project root via tsx
    join(here, '..', '..', '..', 'ui'),
    join(process.cwd(), 'ui'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return join(here, '..', '..', 'ui');
}

/** Compiled shared ES modules (generator, strength) served to the UI at /shared. */
export function resolveSharedRoot(): string {
  const candidates = [join(here, '..', 'shared'), join(here, '..', '..', 'dist', 'shared'), join(process.cwd(), 'dist', 'shared')];
  for (const c of candidates) if (existsSync(join(c, 'generator.js'))) return c;
  return candidates[0]!;
}

/** Package root (contains bin/). In Electron this is …/resources/app.asar. */
export function resolveAppRoot(): string {
  return join(here, '..', '..');
}
