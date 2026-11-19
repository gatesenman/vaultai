// Shared helpers for VaultAI E2E (real server processes, real HTTP)
import { spawn } from 'node:child_process';
import { mkdtempSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Spawn the built server (`node dist/server/index.js`) like `npm start` does. */
export async function startServer({ port, dataDir, env = {}, logFile }) {
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, VAULTAI_PORT: String(port), VAULTAI_DATA: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const sink = logFile ? createWriteStream(logFile) : null;
  const onData = (d) => { log += d.toString(); sink?.write(d); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early:\n' + log);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    child,
    port,
    dataDir,
    base: `http://127.0.0.1:${port}`,
    log: () => log,
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => { sink?.end(); resolve(); });
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
    }),
  };
}

/** Tiny result recorder: each case → { area, name, ok, detail } */
export class Recorder {
  constructor(area) { this.area = area; this.cases = []; }
  async run(name, fn) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      this.cases.push({ area: this.area, name, ok: true, ms: Date.now() - t0, detail: detail || '' });
      console.log(`  ✔ [${this.area}] ${name}`);
    } catch (e) {
      this.cases.push({ area: this.area, name, ok: false, ms: Date.now() - t0, detail: String(e?.stack || e) });
      console.log(`  ✘ [${this.area}] ${name}\n      ${String(e?.message || e)}`);
    }
  }
  skip(name, why) {
    this.cases.push({ area: this.area, name, ok: null, ms: 0, detail: why });
    console.log(`  - [${this.area}] ${name} (skipped: ${why})`);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

export async function j(base, path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}
