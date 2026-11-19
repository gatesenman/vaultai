// Verifies that every i18n key referenced by the UI exists in zh-CN and en, and that both tables have the same keys.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('../ui/', import.meta.url).pathname;
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: {} } };
vm.runInNewContext(readFileSync(join(root, 'js/i18n.js'), 'utf8'), ctx);
const { STRINGS } = ctx.window.VaultI18n;
const zh = new Set(Object.keys(STRINGS['zh-CN'])), en = new Set(Object.keys(STRINGS.en));
const files = ['index.html', ...['js', 'js/pages'].flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.js') && f !== 'i18n.js').map((f) => join(d, f)))];
const used = new Set();
for (const f of files) {
  const s = readFileSync(join(root, f), 'utf8');
  for (const m of s.matchAll(/\b(?:t|tf)\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)) if (en.has(m[1])) used.add(m[1]);
  for (const m of s.matchAll(/'([a-z]+_)' \+/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n(?:-ph|-title)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/(?:labelKey|titleKey|secretKey|help|desc|labelK):\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
}
// dynamic families
for (const tab of ['home', 'passwords', 'connections', 'assistants', 'activity', 'settings']) used.add(`meta_${tab}_title`), used.add(`meta_${tab}_desc`);
for (const l of ['off', 'read', 'write', 'full']) used.add('lv_' + l), used.add('lvd_' + l);
for (const k of ['claude_desktop', 'cursor', 'claude_code', 'terminal', 'custom']) used.add('clh_' + k);
for (const k of ['backup', 'converted', 'noBase', 'webRemoved', 'demoRemoved', 'chatgpt', 'gmailDraft', 'limits', 'folders', 'autofill', 'dbStorage', 'v19']) used.add('mig_' + k);
for (let i = 0; i <= 4; i++) used.add('st_' + i);
const prefixes = [...used].filter((k) => !en.has(k) && [...en].some((x) => x.startsWith(k) && x !== k));
for (const p of prefixes) { used.delete(p); for (const x of en) if (x.startsWith(p)) used.add(x); }
const bad = [];
for (const k of used) { if (!zh.has(k)) bad.push('missing zh: ' + k); if (!en.has(k)) bad.push('missing en: ' + k); }
for (const k of zh) if (!en.has(k)) bad.push('zh only: ' + k);
for (const k of en) if (!zh.has(k)) bad.push('en only: ' + k);
const unused = [...en].filter((k) => !used.has(k));
if (unused.length) bad.push('unused: ' + unused.join(', '));
console.log(`i18n: ${used.size} referenced keys, ${en.size} en / ${zh.size} zh`);
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('i18n OK');
