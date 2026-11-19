// Unit tests for the 1.5.0 vault migration (pure function), the Generic HTTP URL lock and the i18n tables.
import { Recorder, assert, ROOT } from './lib.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const imp = (p) => import(pathToFileURL(join(ROOT, 'dist', p)).href);

/** A vault shaped like VaultAI 1.3.x wrote it (no schemaVersion, no folders/clipboard settings). */
function v13Vault() {
  return {
    applications: [
      { id: 'app_lin', kind: 'linear', name: 'Linear', secretEnc: 'ENC-LIN', meta: {} },
      { id: 'app_sl', kind: 'slack', name: 'Slack', secretEnc: 'ENC-SL', meta: {} },
      { id: 'app_gen', kind: 'generic', name: 'Old Generic', secretEnc: 'ENC-GEN', meta: { template: 'openai' } },
      { id: 'app_web_builtin', kind: 'web', name: 'Web Fetch', meta: {} },
      { id: 'app_demo_builtin', kind: 'demo', name: 'Demo', meta: {} },
      { id: 'app_gmail_builtin', kind: 'gmail', name: 'Gmail', meta: {} },
    ],
    assistants: [
      { id: 'a1', name: 'GPT', kind: 'chatgpt', permissions: { app_lin: 'write', app_sl: 'full', app_web_builtin: 'read', app_demo_builtin: 'read', app_gmail_builtin: 'draft', passwords: 'write', app_gone: 'read' } },
      { id: 'a2', name: 'Claude', kind: 'claude', permissions: { app_gmail_builtin: 'manage', app_gen: 'bogus' } },
    ],
    dailyLimits: [{ toolKey: 'slack:post_message', limit: 5 }, { toolKey: 'web:fetch', limit: 100 }, { toolKey: 'github:create_issue', limit: 3 }],
    passwords: [{ id: 'p1', title: 'Bank', folder: 'Finance', tags: [] }, { id: 'p2', title: 'X', folder: '', tags: ['t'] }],
    activity: [],
    settings: { defaultDailyLimit: 100, allowNonLoopback: true },
  };
}

export async function runUnitMigrate() {
  const rec = new Recorder('Unit');
  const { migrateVault } = await imp('store/migrate.js');
  const { resolveTarget, requiredLevel } = await imp('connectors/generic.js');

  await rec.run('migrate 1.3-shaped vault: secrets kept in place, kinds converted, nothing escalated, notes for every change', () => {
    const v = v13Vault();
    const r = migrateVault(v, { dev: false });
    assert(r.fromVersion === 1 && r.changed, 'from/changed');
    const lin = v.applications.find((a) => a.id === 'app_lin');
    assert(lin.kind === 'generic' && lin.meta.preset === 'linear' && lin.secretEnc === 'ENC-LIN' && lin.meta.baseUrl.startsWith('https://'), 'linear ' + JSON.stringify(lin));
    assert(v.applications.find((a) => a.id === 'app_sl').secretEnc === 'ENC-SL', 'slack secret');
    const gen = v.applications.find((a) => a.id === 'app_gen');
    assert(gen.secretEnc === 'ENC-GEN' && !('template' in gen.meta) && gen.meta.preset === 'custom', 'generic ' + JSON.stringify(gen.meta));
    assert(!v.applications.some((a) => a.kind === 'web' || a.kind === 'demo'), 'web/demo removed');
    const [a1, a2] = v.assistants;
    assert(a1.kind === 'custom' && a2.kind === 'custom', 'kinds ' + a1.kind + '/' + a2.kind);
    assert(a1.permissions.app_lin === 'write' && a1.permissions.app_sl === 'full', 'levels kept');
    assert(a1.permissions.app_gmail_builtin === 'read', 'draft → read (never write)');
    assert(a1.permissions.passwords === 'read', 'passwords write → read');
    assert(!('app_gone' in a1.permissions) && !('app_web_builtin' in a1.permissions), 'dangling keys removed');
    assert(a2.permissions.app_gmail_builtin === 'write' && a2.permissions.app_gen === 'off' && a2.permissions.passwords === 'off', 'a2 ' + JSON.stringify(a2.permissions));
    assert(v.dailyLimits.length === 1 && v.dailyLimits[0].toolKey === 'github:create_issue', 'limits ' + JSON.stringify(v.dailyLimits));
    assert(v.passwords[0].tags.includes('Finance') && !('folder' in v.passwords[0]) && !('folder' in v.passwords[1]), 'folders');
    assert(!('allowNonLoopback' in v.settings) && v.settings.schemaVersion >= 5 && v.settings.clipboardClearSeconds === 30 && v.settings.autofillEnabled === true && v.settings.autofillTextTrigger === 'pp', 'settings ' + JSON.stringify(v.settings));
    const codes = r.notes.map((n) => n.code);
    for (const c of ['mig.converted', 'mig.noBase', 'mig.webRemoved', 'mig.demoRemoved', 'mig.chatgpt', 'mig.gmailDraft', 'mig.limits', 'mig.folders', 'mig.autofill', 'mig.dbStorage']) assert(codes.includes(c), 'missing ' + c + ' in ' + codes);
    assert(r.notes.find((n) => n.code === 'mig.limits').params.keys === 'slack:post_message', 'only custom limits reported');
  });
  await rec.run('migrate schema 2 → 5 adds autofill + DB storage + save-login defaults without rewriting passwords', () => {
    const v = { applications: [], assistants: [], dailyLimits: [], passwords: [{ id: 'p1', title: 'A', username: 'u', tags: [] }], activity: [], settings: { schemaVersion: 2, clipboardClearSeconds: 30, idleLockMinutes: 30 } };
    const r = migrateVault(v, { dev: false });
    assert(r.fromVersion === 2 && r.changed, 'from2');
    assert(v.settings.schemaVersion === 5 && v.settings.autofillEnabled === true && v.settings.autofillHotkey.includes('Shift') && v.settings.saveLoginHotkey.includes('Shift'), 'af ' + JSON.stringify(v.settings));
    assert(v.settings.quickCreateHotkey && v.settings.dbStorage && v.settings.dbStorage.enabled === false, 'qc/db ' + JSON.stringify(v.settings));
    assert(r.notes.some((n) => n.code === 'mig.autofill') && r.notes.some((n) => n.code === 'mig.dbStorage'), 'notes');
    assert(v.passwords[0].title === 'A', 'passwords untouched');
  });
  await rec.run('migrate is idempotent: second run changes nothing and adds no notes', () => {
    const v = v13Vault();
    migrateVault(v, { dev: false });
    const snap = JSON.stringify(v);
    const r2 = migrateVault(v, { dev: false });
    assert(!r2.changed && r2.notes.length === 0 && JSON.stringify(v) === snap, 'second run changed: ' + JSON.stringify(r2));
  });
  await rec.run('migrate in developer mode keeps the Demo connector', () => {
    const v = v13Vault();
    const r = migrateVault(v, { dev: true });
    assert(v.applications.some((a) => a.kind === 'demo') && !r.notes.some((n) => n.code === 'mig.demoRemoved'), 'demo kept in dev');
  });
  await rec.run('generic URL lock: paths stay under the base URL; other hosts, traversal and bad bases refused', () => {
    const ok = (b, a, want) => { const r = resolveTarget(b, a); assert(r.url === want, `${b} ${JSON.stringify(a)} → ${JSON.stringify(r)}`); };
    const no = (b, a, code) => { const r = resolveTarget(b, a); assert(r.error === code, `${b} ${JSON.stringify(a)} → ${JSON.stringify(r)}`); };
    ok('https://api.example.com/v1', { path: '/items?x=1' }, 'https://api.example.com/v1/items?x=1');
    ok('https://api.example.com/v1/', { path: 'items' }, 'https://api.example.com/v1/items');
    ok('https://api.example.com', { url: 'https://api.example.com/a' }, 'https://api.example.com/a');
    no('https://api.example.com/v1', { path: '/../admin' }, 'URL_NOT_ALLOWED');
    no('https://api.example.com/v1', { url: 'https://api.example.com/v10/x' }, 'URL_NOT_ALLOWED');
    no('https://api.example.com', { url: 'https://evil.example/' }, 'URL_NOT_ALLOWED');
    no('https://api.example.com', { url: 'http://api.example.com/' }, 'URL_NOT_ALLOWED');
    no('', { path: '/x' }, 'NO_BASE_URL');
    no('ftp://files.example.com', { path: '/x' }, 'NO_BASE_URL');
  });
  await rec.run('generic levels: GET = Read, writes = Write, Linear GraphQL query = Read but mutation = Write', () => {
    assert(requiredLevel('GET', null, { preset: 'custom' }) === 'read', 'GET');
    assert(requiredLevel('DELETE', null, { preset: 'custom' }) === 'write', 'DELETE');
    assert(requiredLevel('POST', { query: '{ viewer { id } }' }, { preset: 'linear' }) === 'read', 'gql query');
    assert(requiredLevel('POST', { query: 'mutation { a }' }, { preset: 'linear' }) === 'write', 'gql mutation');
    assert(requiredLevel('POST', { query: '{ viewer { id } }' }, { preset: 'custom' }) === 'write', 'non-graphql POST');
  });
  await rec.run('i18n: every referenced key exists in en + zh, tables have identical keys, no unused keys', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-i18n.mjs')], { encoding: 'utf8' });
    assert(r.status === 0, r.stdout + r.stderr);
    return r.stdout.trim().split('\n')[0];
  });

  await rec.run('migrate schema 4 → 5 adds saveLoginHotkey + connectionState', () => {
    const v = { applications: [], assistants: [], dailyLimits: [], passwords: [], activity: [], settings: { schemaVersion: 4, quickCreateHotkey: 'CommandOrControl+Shift+N', dbStorage: { enabled: false, engine: 'sqlite', allowPlaintextStorage: false } } };
    const r = migrateVault(v, { dev: false });
    assert(r.fromVersion === 4 && r.changed, 'from4');
    assert(v.settings.schemaVersion === 5, 'sv5');
    assert(v.settings.saveLoginHotkey === 'CommandOrControl+Shift+S', v.settings.saveLoginHotkey);
    assert(v.settings.dbStorage.connectionState === 'off', v.settings.dbStorage.connectionState);
    assert(r.notes.some((n) => n.code === 'mig.v19'), JSON.stringify(r.notes));
  });
  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitMigrate();
  const bad = rec.cases.filter((c) => !c.ok).length;
  console.log(`\nUnit (migrate/url/i18n): ${rec.cases.length - bad} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
}
