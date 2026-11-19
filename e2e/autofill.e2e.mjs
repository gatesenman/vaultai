/**
 * Autofill API + ranking harness E2E (no real UIA — mocked fill via prepare + clipboard clear contract).
 */
import { Recorder, assert, startServer, tempDir, ROOT } from './lib.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MASTER = 'E2E-Autofill-Master-160!';

async function json(base, path, opts = {}) {
  const r = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

export async function runAutofillE2e({ logDir, dataDirs }) {
  const rec = new Recorder('Autofill');
  const d = tempDir('vaultai-e2e-af-');
  dataDirs.push(d);
  const srv = await startServer({ port: 3861, dataDir: d, logFile: join(logDir, 'server-autofill.log') });
  const base = srv.base;

  await rec.run('locked vault refuses autofill search/prepare', async () => {
    const st = await json(base, '/api/autofill/status');
    assert(st.j.ok && st.j.unlocked === false && st.j.enabled === false, 'status locked ' + JSON.stringify(st.j));
    const s = await json(base, '/api/autofill/search', { method: 'POST', body: { typed: 'a' } });
    assert(s.status === 423 && s.j.code === 'VAULT_LOCKED', 'search locked');
    const p = await json(base, '/api/autofill/prepare', { method: 'POST', body: { id: 'x' } });
    assert(p.status === 423, 'prepare locked');
  });

  await rec.run('create vault + password entries; settings expose autofill defaults', async () => {
    let r = await json(base, '/api/vault/create', { method: 'POST', body: { password: MASTER } });
    assert(r.j.ok, 'create ' + JSON.stringify(r.j));
    r = await json(base, '/api/settings');
    assert(r.j.settings.autofillEnabled !== false && r.j.settings.autofillTextTrigger === 'pp', 'defaults ' + JSON.stringify(r.j.settings));
    assert(r.j.settings.autofillHotkey.includes('Shift+P'), 'hotkey');
    for (const e of [
      { title: 'Gmail', username: 'alice@gmail.com', password: 'sec-gmail-1', url: 'https://mail.google.com', favorite: true },
      { title: 'GitHub', username: 'alice-dev', password: 'sec-gh-2', url: 'https://github.com/login' },
      { title: 'Bank', username: 'alice', password: 'sec-bank-3', url: 'https://bank.example.com' },
      { title: 'Noise', username: 'bob@other.com', password: 'sec-noise', url: 'https://other.example' },
    ]) {
      r = await json(base, '/api/passwords', { method: 'POST', body: e });
      assert(r.j.ok, 'add ' + e.title);
    }
  });

  await rec.run('search ranks username prefix + host + favorite', async () => {
    const r = await json(base, '/api/autofill/search', { method: 'POST', body: { typed: 'alice', host: 'https://mail.google.com', windowTitle: 'Gmail - Google Chrome' } });
    assert(r.j.ok && r.j.matches.length >= 2, 'matches ' + JSON.stringify(r.j.matches));
    assert(r.j.matches[0].title === 'Gmail' || r.j.matches[0].username.includes('gmail'), 'top ' + JSON.stringify(r.j.matches[0]));
    assert(!JSON.stringify(r.j).includes('sec-gmail'), 'no secret in search');
  });

  await rec.run('prepare returns secret once; activity logs title only', async () => {
    const list = await json(base, '/api/autofill/search', { method: 'POST', body: { typed: 'alice-dev' } });
    const id = list.j.matches[0].id;
    const p = await json(base, '/api/autofill/prepare', { method: 'POST', body: { id } });
    assert(p.j.ok && p.j.password === 'sec-gh-2' && p.j.username === 'alice-dev', 'prepare ' + JSON.stringify({ ...p.j, password: '***' }));
    assert(typeof p.j.clearAfterSec === 'number', 'clearAfter');
    const act = await json(base, '/api/activity');
    const row = (act.j.activity || act.j.items || []).find((a) => a.action === 'autofill:used');
    assert(row && row.reason === 'GitHub', 'activity ' + JSON.stringify(row));
    assert(!JSON.stringify(row).includes('sec-gh'), 'no secret in activity');
  });

  await rec.run('settings: disable autofill → search 403; re-enable; change trigger', async () => {
    let r = await json(base, '/api/settings', { method: 'PUT', body: { autofillEnabled: false } });
    assert(r.j.ok, 'off');
    r = await json(base, '/api/autofill/search', { method: 'POST', body: { typed: 'a' } });
    assert(r.status === 403 && r.j.code === 'AUTOFILL_OFF', '403');
    r = await json(base, '/api/settings', { method: 'PUT', body: { autofillEnabled: true, autofillTextTrigger: 'pp', autofillHotkey: 'CommandOrControl+Shift+P', autofillConfirm: true } });
    assert(r.j.ok && r.j.settings.autofillConfirm === true, 'on+confirm');
    r = await json(base, '/api/settings', { method: 'PUT', body: { autofillTextTrigger: 'bad trigger!' } });
    assert(r.status === 400, 'bad trigger rejected');
  });

  await rec.run('lock vault → status enabled false; unlock restores', async () => {
    let r = await json(base, '/api/vault/lock', { method: 'POST', body: {} });
    assert(r.j.ok, 'lock');
    r = await json(base, '/api/autofill/status');
    assert(r.j.unlocked === false, 'status');
    r = await json(base, '/api/vault/unlock', { method: 'POST', body: { password: MASTER } });
    assert(r.j.ok, 'unlock');
    r = await json(base, '/api/autofill/status');
    assert(r.j.unlocked && r.j.enabled && r.j.textTrigger === 'pp', 'restored ' + JSON.stringify(r.j));
  });

  await rec.run('pure match engine: ranking + trigger boundary (dist)', async () => {
    const mod = await import(pathToFileURL(join(ROOT, 'dist/shared/autofill-match.js')).href);
    const entries = [
      { id: '1', title: 'Gmail', username: 'alice@gmail.com', url: 'https://mail.google.com', favorite: true },
      { id: '2', title: 'GitHub', username: 'alice-dev', url: 'https://github.com' },
      { id: '3', title: 'Other', username: 'zoe', url: 'https://zoe.example' },
    ];
    const m = mod.rankAutofillMatches(entries, { typed: 'ali', host: 'github.com' });
    assert(m[0].id === '2' || m[0].username.startsWith('alice'), 'rank ' + JSON.stringify(m.map((x) => x.id + ':' + x.score)));
    assert(mod.isTriggerBoundary('') && mod.isTriggerBoundary(' ') && !mod.isTriggerBoundary('a'), 'boundary');
  });

  // Picker screenshots (file:// + live API)
  try {
    const { spawn } = await import('node:child_process');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(ROOT, 'e2e/screenshots'), { recursive: true });
    const code = await new Promise((r) => {
      const c = spawn('npx', ['playwright', 'test', 'autofill-picker.spec.mjs', '-c', 'playwright.config.mjs'], {
        cwd: join(ROOT, 'e2e'), stdio: 'inherit',
        env: { ...process.env, E2E_BASE: base, E2E_SPEC: 'autofill-picker' },
      });
      c.on('exit', r);
    });
    const { readFileSync, existsSync } = await import('node:fs');
    const rj = join(ROOT, 'e2e/results/autofill-picker.json');
    const specs = [];
    if (existsSync(rj)) {
      const walk = (su) => { for (const sp of su.specs || []) specs.push(sp); for (const c of su.suites || []) walk(c); };
      for (const su of JSON.parse(readFileSync(rj, 'utf8')).suites || []) walk(su);
    }
    for (const sp of specs) {
      await rec.run('mini picker UI: ' + sp.title, () => { assert(sp.ok, 'playwright failed: ' + sp.title); });
    }
    await rec.run('mini picker spec run + screenshots autofill-mini-{zh,en}.png', () => {
      assert(code === 0 && specs.length >= 10, 'playwright exit ' + code + ' specs ' + specs.length);
      assert(existsSync(join(ROOT, 'e2e/screenshots/autofill-mini-zh.png')) && existsSync(join(ROOT, 'e2e/screenshots/autofill-mini-en.png')), 'screenshots');
    });
  } catch (e) {
    await rec.run('picker zh/en screenshots via Playwright', () => { throw e; });
  }

  await srv.stop();
  return [rec];
}


if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { mkdirSync } = await import('node:fs');
  const logDir = join(ROOT, 'e2e/results/logs');
  mkdirSync(logDir, { recursive: true });
  const [rec] = await runAutofillE2e({ logDir, dataDirs: [] });
  const failed = rec.cases.filter((c) => c.ok === false).length;
  console.log(`SUMMARY autofill-e2e ${rec.cases.filter((c) => c.ok).length}/${rec.cases.length}`);
  process.exit(failed ? 1 : 0);
}
