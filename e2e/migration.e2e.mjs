// VaultAI 1.5.0 migration E2E: real encrypted vaults written by VaultAI 1.3.1 and 1.4.0 are opened by 1.5.0.
// Checks: pre-1.5.0-backup is byte-identical to the original, no secret is lost (the exact stored credential
// reaches the mock upstream), permission ladder + client kinds converted, notices shown, idempotent re-unlock.
import { readFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startServer, Recorder, assert, j, tempDir, ROOT } from './lib.mjs';
import { startMockUpstream } from './mock-upstream.mjs';

const FIX = join(ROOT, 'e2e', 'fixtures');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sha16 = (s) => sha(Buffer.from(s)).slice(0, 16);
export const FIXTURES = ['vault-v131', 'vault-v140'].filter((f) => existsSync(join(FIX, f)));
export const fixtureSecrets = () => Object.fromEntries(FIXTURES.flatMap((f) => {
  const fx = JSON.parse(readFileSync(join(FIX, f + '.json'), 'utf8'));
  return [[`${f}.master`, fx.master], ...Object.entries(fx.secrets).map(([k, v]) => [`${f}.${k}`, v])];
}));

export async function runMigration({ logDir, dataDirs, port = 3853, mockPort = 3873, onServer }) {
  const rec = new Recorder('Migration');
  for (const [i, name] of FIXTURES.entries()) {
    const fx = JSON.parse(readFileSync(join(FIX, name + '.json'), 'utf8'));
    const ver = fx.createdWith;
    const mock = await startMockUpstream(mockPort + i);
    const dir = tempDir(`vaultai-e2e-mig-${name}-`); dataDirs.push(dir);
    cpSync(join(FIX, name), dir, { recursive: true });
    const orig = Object.fromEntries(readdirSync(join(FIX, name)).map((f) => [f, sha(readFileSync(join(FIX, name, f)))]));
    const env = {};
    for (const k of ['GITHUB', 'NOTION', 'STRIPE', 'LINEAR', 'SENTRY', 'SLACK']) env[`VAULTAI_API_BASE_${k}`] = mock.base;
    const srv = await startServer({ port: port + i, dataDir: dir, env, logFile: join(logDir, `server-mig-${name}.log`) });
    const B = srv.base;
    const tok = (t) => ({ headers: { Authorization: `Bearer ${t}` } });
    const invoke = (t, nm, args = {}) => j(B, '/api/tool/invoke', { method: 'POST', ...tok(t), body: JSON.stringify({ name: nm, arguments: args }) });
    try {
      await rec.run(`${ver}: wrong master refused, nothing written (no backup yet)`, async () => {
        const r = await j(B, '/api/vault/unlock', { method: 'POST', body: JSON.stringify({ password: 'wrong-master-xyz' }) });
        assert(r.status >= 400, 'wrong password accepted');
        assert(!existsSync(join(dir, 'pre-1.5.0-backup')), 'backup created before a successful unlock');
        for (const [f, h] of Object.entries(orig)) assert(sha(readFileSync(join(dir, f))) === h, f + ' modified');
      });
      await rec.run(`${ver}: unlock migrates; pre-1.5.0-backup is byte-identical to the ${ver} files`, async () => {
        const r = await j(B, '/api/vault/unlock', { method: 'POST', body: JSON.stringify({ password: fx.master }) });
        assert(r.status === 200, 'unlock ' + JSON.stringify(r.json));
        for (const [f, h] of Object.entries(orig)) assert(sha(readFileSync(join(dir, 'pre-1.5.0-backup', f))) === h, 'backup differs: ' + f);
        assert(sha(readFileSync(join(dir, 'vault.data.enc'))) !== orig['vault.data.enc'], 'vault not rewritten in 1.5.0 format');
      });
      const apps = (await j(B, '/api/applications')).json.applications;
      const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
      await rec.run(`${ver}: Linear/Sentry/Slack converted in place to Generic HTTP presets (same id, base URL set); legacy generic flagged`, async () => {
        for (const [k, preset] of [['linear', 'linear'], ['sentry', 'sentry'], ['slack', 'slack']]) {
          const a = byId[fx.ids[k]];
          assert(a, k + ' connection missing');
          assert(a.kind === 'generic' && a.meta.preset === preset, `${k}: ${a.kind}/${a.meta.preset}`);
          assert(a.meta.baseUrl && a.meta.baseUrl.startsWith(mock.base), k + ' base ' + a.meta.baseUrl);
        }
        assert(byId[fx.ids.github]?.kind === 'github', 'github kept');
        assert(byId[fx.ids.generic]?.meta.baseUrl === 'https://api.example.com/v2' && byId[fx.ids.generic].meta.headerName === 'X-Api-Key', 'generic meta kept');
        assert(byId[fx.ids.genericNoBase] && !byId[fx.ids.genericNoBase].meta.baseUrl, 'legacy generic without base kept (needs edit)');
        assert(!apps.some((a) => ['web', 'demo', 'linear', 'sentry', 'slack'].includes(a.kind)), 'removed kinds still present: ' + apps.map((a) => a.kind));
      });
      await rec.run(`${ver}: no secret lost — each stored credential reaches the upstream byte-for-byte`, async () => {
        const call = async (t, nm, args, secretHeader) => {
          const before = mock.hits.length;
          await invoke(t, nm, args);
          const hit = mock.hits.slice(before).find((h) => h.authSha);
          assert(hit, nm + ': no upstream request');
          assert(hit.authSha === sha16(secretHeader), `${nm}: credential differs`);
        };
        await call(fx.tokens.cursor, `generic_${fx.ids.linear}_http_request`, { method: 'POST', path: '/graphql', body: { query: '{ viewer { id } }' } }, fx.secrets.linear);
        await call(fx.tokens.chatgpt, `generic_${fx.ids.sentry}_http_request`, { method: 'GET', path: '/' }, `Bearer ${fx.secrets.sentry}`);
        await call(fx.tokens.chatgpt, `generic_${fx.ids.slack}_http_request`, { method: 'POST', path: '/auth.test' }, `Bearer ${fx.secrets.slack}`);
        await call(fx.tokens.cursor, 'github_list_repos', {}, `Bearer ${fx.secrets.github}`);
      });
      await rec.run(`${ver}: Linear GraphQL mutation needs Write (Cursor has Read) — refused`, async () => {
        const r = await invoke(fx.tokens.cursor, `generic_${fx.ids.linear}_http_request`, { method: 'POST', path: '/graphql', body: { query: 'mutation { issueCreate(input: {title: "x"}) { success } }' } });
        assert(r.json.code === 'PERMISSION_DENIED', JSON.stringify(r.json));
      });
      await rec.run(`${ver}: assistants — ChatGPT → Other client, Gmail Draft → Read (never escalated), Manage → Write; tokens still valid`, async () => {
        const { assistants } = (await j(B, '/api/permissions')).json;
        const gpt = assistants.find((a) => a.id === fx.ids.chatgpt), cur = assistants.find((a) => a.id === fx.ids.cursor);
        const full = (await j(B, '/api/assistants')).json.assistants;
        assert(full.find((a) => a.id === fx.ids.chatgpt).kind === 'custom', 'chatgpt kind');
        assert(full.find((a) => a.id === fx.ids.cursor).kind === 'cursor', 'cursor kind');
        assert(gpt.permissions.app_gmail_builtin === 'read', 'draft→read ' + gpt.permissions.app_gmail_builtin);
        assert(gpt.permissions.app_gcal_builtin === 'full', 'gcal full kept');
        assert(cur.permissions.app_gmail_builtin === 'write', 'manage→write ' + cur.permissions.app_gmail_builtin);
        assert(gpt.permissions[fx.ids.linear] === 'write' && gpt.permissions[fx.ids.slack] === 'full' && gpt.permissions[fx.ids.sentry] === 'read', 'preset levels kept');
        assert(cur.permissions[fx.ids.github] === 'write' && cur.permissions[fx.ids.linear] === 'read', 'cursor levels kept');
        assert(gpt.permissions.passwords === 'read', 'passwords read kept');
        assert(!('app_web_builtin' in gpt.permissions) && !('app_demo_builtin' in gpt.permissions), 'dangling web/demo permission');
        const p = await invoke(fx.tokens.chatgpt, 'passwords_list');
        assert(p.json.ok === true, 'chatgpt token no longer works: ' + JSON.stringify(p.json));
      });
      await rec.run(`${ver}: passwords intact (values decrypt), folders folded into tags, limits for removed tools dropped with a note`, async () => {
        const { passwords } = (await j(B, '/api/passwords')).json;
        const bank = passwords.find((x) => x.title === 'Bank');
        assert(bank && passwords.length === 3, 'passwords ' + passwords.map((x) => x.title));
        const rev = (await j(B, `/api/passwords/${bank.id}/reveal`)).json;
        assert(rev.password === fx.secrets.site, 'password value changed');
        assert(!passwords.some((x) => 'folder' in x), 'folder field survived');
        assert(bank.tags.includes('money'), 'tags lost');
        const { limits, defaultDailyLimit } = (await j(B, '/api/limits')).json;
        const keys = (limits || []).map((l) => l.toolKey);
        assert(keys.includes('github:create_issue'), 'kept limit dropped: ' + keys);
        assert(!keys.some((k) => /^(linear|web|demo):/.test(k)), 'removed-tool limit kept: ' + keys);
        assert(defaultDailyLimit === 100, 'default limit ' + defaultDailyLimit);
        const s = (await j(B, '/api/settings')).json.settings;
        assert(!('allowNonLoopback' in s), 'allowNonLoopback survived');
        assert(s.idleLockMinutes === 20, 'user setting lost');
      });
      let notes = [];
      await rec.run(`${ver}: migration notices on the home overview (backup, conversions, needs-base, removed, ChatGPT, Gmail Draft, limits)`, async () => {
        notes = (await j(B, '/api/overview')).json.notices;
        const codes = notes.map((n) => n.code);
        for (const c of ['mig.backup', 'mig.converted', 'mig.noBase', 'mig.webRemoved', 'mig.demoRemoved', 'mig.chatgpt', 'mig.gmailDraft', 'mig.limits', 'mig.autofill']) assert(codes.includes(c), 'missing ' + c + ' in ' + codes);
        assert(codes.filter((c) => c === 'mig.converted').length === 3, 'converted ×3');
        assert(notes.find((n) => n.code === 'mig.backup').params.dir.includes('pre-1.5.0-backup'), 'backup dir param');
        assert(!JSON.stringify(notes).match(/good|FIXTURE/), 'secret in notes');
        return codes.join(', ');
      });
      await rec.run(`${ver}: idempotent — lock + unlock again adds no notices, keeps the oldest backup`, async () => {
        const bk = sha(readFileSync(join(dir, 'pre-1.5.0-backup', 'vault.data.enc')));
        await j(B, '/api/vault/lock', { method: 'POST', body: '{}' });
        const r = await j(B, '/api/vault/unlock', { method: 'POST', body: JSON.stringify({ password: fx.master }) });
        assert(r.status === 200, 'unlock 2');
        assert((await j(B, '/api/overview')).json.notices.length === notes.length, 'notices duplicated');
        assert(sha(readFileSync(join(dir, 'pre-1.5.0-backup', 'vault.data.enc'))) === bk, 'backup overwritten');
      });
      if (onServer && name === FIXTURES[FIXTURES.length - 1]) await onServer(srv, fx, mock);
      await rec.run(`${ver}: dismissing a notice persists`, async () => {
        const before = (await j(B, '/api/overview')).json.notices;
        await j(B, `/api/migrations/${encodeURIComponent(before[0].id)}/dismiss`, { method: 'POST', body: '{}' });
        const after = (await j(B, '/api/overview')).json.notices;
        assert(after.length === before.length - 1 && !after.some((n) => n.id === before[0].id), 'dismiss');
        await j(B, '/api/migrations/all/dismiss', { method: 'POST', body: '{}' });
        assert((await j(B, '/api/overview')).json.notices.length === 0, 'dismiss all');
      });
    } finally {
      await srv.stop();
      await mock.stop();
    }
  }
  return [rec];
}
