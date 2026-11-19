// VaultAI 1.5 — professional forms E2E: hints, validation, assistance, generator, polish (zh + en).
// Runs against its own fresh server with VAULTAI_API_BASE_* pointing to e2e/mock-upstream.mjs.
import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRETS } from './forms-secrets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');
const MOCK = process.env.E2E_MOCK || 'http://127.0.0.1:3872';

test.describe.configure({ mode: 'serial' });
let page, context, base;

const shot = async (name, loc) => { await page.waitForTimeout(300); await (loc || page).screenshot({ path: join(SHOTS, name) }); };
const nav = async (tab, sub) => {
  await page.click(`.nav-btn[data-tab="${tab}"]`);
  if (await page.locator('#modal').isVisible()) await page.click('#modal-ok'); // discard unsaved
  await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  if (sub) { await page.click(`#tab-${tab} [data-sub="${sub}"]`); await expect(page.locator('#' + sub)).toBeVisible(); }
};
const openGen = async () => {
  await nav('passwords');
  await page.click('#btn-open-gen');
  await expect(page.locator('#gen-dialog')).toBeVisible();
};
const closeGen = async () => { await page.keyboard.press('Escape'); await expect(page.locator('#gen-dialog')).toBeHidden(); };
const openMore = async () => {
  const d = page.locator('#gen-page .gen-opts:not(.hidden) details.gen-more');
  if (!(await d.evaluate((el) => el.open))) await d.locator('summary').click();
  if (!(await d.evaluate((el) => el.open))) await d.evaluate((el) => { el.open = true; });
  await expect(d).toHaveJSProperty('open', true);
};
const tile = async (kind) => {
  await nav('connections');
  await page.click(`[data-tile="${kind}"]`);
  await expect(page.locator('#conn-dialog')).toBeVisible();
};
const closeConn = async () => {
  await page.keyboard.press('Escape');
  if (await page.locator('#modal').isVisible()) await page.click('#modal-ok');
  await expect(page.locator('#conn-dialog')).toBeHidden();
};
const setLang = async (lang) => {
  await nav('settings');
  await page.click('#tab-settings [data-sub="set-general"]');
  await page.selectOption('#set-lang', lang); // applies immediately, no Save button
  await expect(page.locator('html')).toHaveAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
};
const capsDown = (sel) => page.locator(sel).evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', bubbles: true, modifierCapsLock: true })));
const genVal = (p = 'gen') => page.locator(`#${p}-output`).getAttribute('data-value');
const setNum = async (sel, v) => { await page.fill(sel, String(v)); await page.dispatchEvent(sel, 'change'); };
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const apiPost = (path, data) => page.request.post(path, { data });

test.beforeAll(async ({ browser, baseURL }) => {
  base = baseURL;
  context = await browser.newContext({ baseURL });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  page = await context.newPage();
});
test.afterAll(async () => { await context?.close(); });

test('master password (create): meter, crack time, checklist, caps lock, match, no-recovery ack, summary + focus (en + zh)', async () => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vaultai_lang', 'en'));
  await page.reload();
  await expect(page.locator('#lock-create')).toBeVisible();
  await expect(page.locator('#create-pw')).toBeFocused(); // autofocus
  await expect(page.locator('#create-pw')).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.locator('#create-pw')).toHaveAttribute('spellcheck', 'false');
  await expect(page.locator('label[for="create-pw"]')).toHaveClass(/required/);
  await expect(page.locator('#btn-create')).toHaveAttribute('aria-disabled', 'true');
  // common password → very weak + warning + checklist
  await page.fill('#create-pw', 'password1');
  const meter = page.locator('[data-meter-for="create-pw"]');
  await expect(meter).toHaveAttribute('data-score', '0');
  await expect(meter.locator('.meter-label')).toHaveText('Very weak');
  await expect(meter).toContainText('most common');
  await expect(meter).toContainText('Time to crack offline');
  const ck = page.locator('[data-checklist-for="create-pw"] li');
  await expect(ck).toHaveCount(5);
  await expect(ck.nth(0)).toHaveClass(/ok/); // 8+ chars
  await expect(ck.nth(1)).not.toHaveClass(/ok/); // not common ✗
  await page.locator('#create-pw').blur();
  await expect(page.locator('#create-pw')).toHaveClass(/is-invalid/);
  await expect(page.locator('#create-pw')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#create-pw').locator('xpath=ancestor::div[contains(@class,"field")]').locator('.err')).toContainText('too common');
  // caps lock warning
  await capsDown('#create-pw');
  await expect(page.locator('[data-caps-for="create-pw"]')).toBeVisible();
  await expect(page.locator('[data-caps-for="create-pw"]')).toHaveText('Caps Lock is on');
  // strong master → score ≥ 3, required checklist satisfied
  await page.fill('#create-pw', SECRETS.master);
  await expect(meter).toHaveAttribute('data-score', /[34]/);
  await expect(ck.nth(1)).toHaveClass(/ok/);
  await expect(ck.nth(2)).toHaveClass(/ok/);
  // confirm-match indicator
  await page.fill('#create-pw2', SECRETS.master + 'x');
  await expect(page.locator('[data-match-for="create-pw2"]')).toHaveClass(/no/);
  await page.fill('#create-pw2', SECRETS.master);
  await expect(page.locator('[data-match-for="create-pw2"]')).toHaveClass(/ok/);
  await expect(page.locator('[data-match-for="create-pw2"]')).toContainText('Passwords match');
  // no-recovery acknowledgement required: submit shows summary and focuses the checkbox
  await page.click('#btn-create', { force: true });
  const summary = page.locator('#lock-create .form-errors');
  await expect(summary).toBeVisible();
  await expect(summary.locator('li')).toHaveCount(1);
  await expect(summary).toContainText('cannot be recovered');
  await expect(page.locator('#create-ack')).toBeFocused();
  await shot('74-master-meter-en.png', page.locator('.lock-box'));
  // multiple errors → summary lists all, focus goes to first invalid, links focus fields
  await page.fill('#create-pw', '');
  await page.fill('#create-pw2', 'zzz');
  await page.click('#btn-create', { force: true });
  await expect(summary.locator('li')).toHaveCount(3);
  await expect(page.locator('#create-pw')).toBeFocused();
  await summary.locator('a').nth(1).click();
  await expect(page.locator('#create-pw2')).toBeFocused();
  await expect(page.locator('#shell')).toBeHidden();
  // zh-CN strings
  await page.evaluate(() => localStorage.setItem('vaultai_lang', 'zh-CN'));
  await page.reload();
  await page.fill('#create-pw', 'password1');
  await page.locator('#create-pw').blur();
  await expect(meter.locator('.meter-label')).toHaveText('非常弱');
  await expect(page.locator('#lock-create')).toContainText('这个密码太常见了');
  await expect(page.locator('#lock-create')).toContainText('主密码无法找回');
  await page.fill('#create-pw', 'Velvet-Orbit-9');
  await page.fill('#create-pw2', 'Velvet-Orbit-');
  await shot('74-master-meter-zh.png', page.locator('.lock-box'));
  // suggest passphrase fills both fields with a very strong value
  await page.click('#btn-suggest-master');
  const v1 = await page.inputValue('#create-pw');
  expect(v1).toBe(await page.inputValue('#create-pw2'));
  expect(v1.split('-').length).toBe(6);
  await expect(meter).toHaveAttribute('data-score', /[34]/);
  // use our own known master; Enter submits
  await page.fill('#create-pw', SECRETS.master);
  await page.fill('#create-pw2', SECRETS.master);
  await page.check('#create-ack');
  await page.press('#create-pw2', 'Enter');
  await expect(page.locator('#shell')).toBeVisible();
});

test('password form: required markers, inline errors, summary, focus first invalid, Esc/Enter, unsaved guard (zh + en)', async () => {
  await nav('passwords');
  await page.click('#btn-pw-new');
  await expect(page.locator('#pw-dialog')).toBeVisible();
  await expect(page.locator('#pw-url')).toBeFocused();
  await expect(page.locator('label[for="pw-title"]')).toHaveClass(/required/);
  await expect(page.locator('label[for="pw-pass"]')).toHaveClass(/required/);
  await expect(page.locator('#pw-pass')).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.locator('#pw-pass')).toHaveAttribute('spellcheck', 'false');
  await page.click('#btn-pw-save', { force: true });
  const sum = page.locator('#pw-editor .form-errors');
  await expect(sum).toBeVisible();
  await expect(sum.locator('li')).toHaveCount(2);
  await expect(sum).toContainText('此项为必填');
  await expect(page.locator('#pw-title')).toBeFocused();
  await page.fill('#pw-url', 'not a url %%');
  await page.locator('#pw-url').blur();
  await expect(page.locator('#pw-url')).toHaveClass(/is-invalid/);
  await page.fill('#pw-user', 'bob@');
  await page.locator('#pw-user').blur();
  await expect(page.locator('#pw-editor')).toContainText('请输入有效的邮箱地址');
  await shot('70-pwform-errors-zh.png');
  // Esc on a dirty form → guard; cancel keeps the dialog
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('放弃未保存的更改？');
  await page.click('#modal-cancel');
  await expect(page.locator('#pw-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.click('#modal-ok');
  await expect(page.locator('#pw-dialog')).toBeHidden();
  // English
  await setLang('en');
  await nav('passwords');
  await page.click('#btn-pw-new');
  await page.click('#btn-pw-save', { force: true });
  await expect(page.locator('#pw-editor .form-errors')).toContainText('This field is required');
  await page.fill('#pw-url', 'github.com');
  await page.locator('#pw-url').blur();
  await expect(page.locator('#pw-url')).toHaveValue('https://github.com'); // normalized on blur
  await page.fill('#pw-user', 'alice@');
  await page.locator('#pw-user').blur();
  await expect(page.locator('#pw-editor')).toContainText('Enter a valid email address');
  await page.fill('#pw-pass', 'qwerty123');
  await expect(page.locator('[data-meter-for="pw-pass"]')).toHaveAttribute('data-score', '0');
  await shot('70-pwform-errors-en.png');
  await page.keyboard.press('Escape');
  await page.click('#modal-ok');
  await expect(page.locator('#pw-dialog')).toBeHidden();
  // clean dialog closes on Esc without a guard
  await page.click('#btn-pw-new');
  await expect(page.locator('#pw-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#pw-dialog')).toBeHidden();
  // Enter submits
  await page.click('#btn-pw-new');
  await page.fill('#pw-title', 'Enter Submit Item');
  await page.fill('#pw-pass', 'Enter-Submit-Pw-1937');
  await page.press('#pw-title', 'Enter');
  await expect(page.locator('#toast')).toContainText('Item saved');
  await expect(page.locator('#pw-dialog')).toBeHidden();
  await expect(page.locator('#pw-list')).toContainText('Enter Submit Item');
});

test('password assistance: site name + icon, letter fallback, title autofill, suggestions, duplicate + reuse warnings, open URL', async () => {
  let r = await apiPost('/api/passwords', { title: 'Mock Account', url: `${MOCK}/login`, username: 'alice@e2e.test', password: SECRETS.reused, tags: ['work', 'finance'] });
  expect(r.ok()).toBeTruthy();
  r = await apiPost('/api/passwords', { title: 'Other Site', url: 'https://other.example', username: 'carol', password: SECRETS.reused, tags: ['personal'] });
  expect(r.ok()).toBeTruthy();
  await nav('passwords');
  await expect(page.locator('#pw-list')).toContainText('Mock Account');
  await page.click('#btn-pw-new');
  await page.fill('#pw-url', `${MOCK}/login`);
  await expect(page.locator('#pw-title')).toHaveValue('Mock Site E2E', { timeout: 8000 }); // og:site_name
  await expect(page.locator('#pw-avatar')).toHaveClass(/has-img/);
  await expect(page.locator('#pw-site-host')).toHaveText('127.0.0.1');
  // duplicate (same site + username)
  await page.fill('#pw-user', 'alice@e2e.test');
  await expect(page.locator('#pw-dup-warn')).toBeVisible();
  await expect(page.locator('#pw-dup-warn')).toContainText('Mock Account');
  // reused password (values never returned, titles only)
  await page.fill('#pw-pass', SECRETS.reused);
  await expect(page.locator('#pw-reuse-warn')).toContainText('2 other item');
  await expect(page.locator('#pw-reuse-warn')).toContainText('Other Site');
  // username + tag suggestions
  const opts = await page.locator('#pw-user-list option').evaluateAll((os) => os.map((o) => o.value));
  expect(opts).toEqual(expect.arrayContaining(['alice@e2e.test', 'carol']));
  await page.fill('#pw-tags', 'fi');
  await page.locator('#pw-tag-suggest [data-tag="finance"]').click();
  await expect(page.locator('#pw-tags')).toHaveValue('finance, ');
  await expect(page.locator('#pw-tag-suggest [data-tag="finance"]')).toHaveCount(0);
  // open URL
  const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#btn-pw-open')]);
  expect(popup.url()).toContain('127.0.0.1:3872/login');
  await popup.close();
  // offline / unknown site → letter avatar + host-derived title (title still auto)
  await page.fill('#pw-url', 'https://nonexistent-e2e.invalid/path');
  await expect(page.locator('#pw-title')).toHaveValue('Nonexistent-e2e', { timeout: 8000 });
  await expect(page.locator('#pw-avatar')).not.toHaveClass(/has-img/);
  await expect(page.locator('#pw-avatar')).toHaveText('N');
  // manual title is never overwritten
  await page.fill('#pw-title', 'My Custom Title');
  await page.fill('#pw-url', `${MOCK}/login`);
  await page.waitForTimeout(900);
  await expect(page.locator('#pw-title')).toHaveValue('My Custom Title');
  await page.keyboard.press('Escape');
  await page.click('#modal-ok');
  await expect(page.locator('#pw-dialog')).toBeHidden();
});

test('generator dialog: “More options” collapsed by default; modes, length, class guarantees, exclusions, minimums, repeats, errors, entropy', async () => {
  await openGen();
  await expect.poll(async () => (await genVal())?.length).toBe(20);
  // progressive disclosure: type, length and the 4 classes are visible; the rest is folded away
  await expect(page.locator('#gen-page [data-opt="upper"]')).toBeVisible();
  await expect(page.locator('#gen-page [data-opt="symbols"]')).toBeVisible();
  await expect(page.locator('#gen-page [data-opt="excludeAmbiguous"]')).toBeHidden();
  await expect(page.locator('#gen-excl')).toBeHidden();
  await expect(page.locator('#gen-mind')).toBeHidden();
  await expect(page.locator('#gen-page .gen-opts:not(.hidden) .gen-more > summary')).toHaveText('More options');
  await shot('82-gen-collapsed-en.png', page.locator('#gen-dialog .modal'));
  await setNum('#gen-len', 64);
  await expect(page.locator('#gen-len-range')).toHaveValue('64');
  expect((await genVal()).length).toBe(64);
  await page.locator('#gen-len-range').evaluate((el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#gen-len')).toHaveValue('40');
  expect((await genVal()).length).toBe(40);
  await setNum('#gen-len', 3); await expect(page.locator('#gen-len')).toHaveValue('8');
  await setNum('#gen-len', 500); await expect(page.locator('#gen-len')).toHaveValue('128');
  await setNum('#gen-len', 16);
  const regen = () => page.click('#gen-page [data-act="regen"]');
  const sample = async (n, check) => { for (let i = 0; i < n; i++) { await regen(); const v = await genVal(); expect(check(v), v).toBe(true); } };
  await sample(25, (v) => v.length === 16 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v));
  await page.locator('#gen-page [data-opt="symbols"]').uncheck();
  await page.locator('#gen-page [data-opt="digits"]').uncheck();
  await sample(15, (v) => /^[A-Za-z]{16}$/.test(v));
  await page.locator('#gen-page [data-opt="symbols"]').check();
  await page.locator('#gen-page [data-opt="digits"]').check();
  await openMore();
  await expect(page.locator('#gen-page [data-opt="excludeAmbiguous"]')).toBeVisible();
  await page.locator('#gen-page [data-opt="excludeAmbiguous"]').check();
  await page.fill('#gen-excl', 'aeiouAEIOU#');
  await sample(20, (v) => !/[Il1O0o|aeiuAEIU#]/.test(v));
  await page.fill('#gen-excl', '');
  await page.locator('#gen-page [data-opt="excludeAmbiguous"]').uncheck();
  await setNum('#gen-mind', 5); await setNum('#gen-mins', 4);
  await sample(15, (v) => (v.match(/\d/g) || []).length >= 5 && (v.match(/[^A-Za-z0-9]/g) || []).length >= 4);
  await setNum('#gen-mind', 1); await setNum('#gen-mins', 1);
  await page.locator('#gen-page [data-opt="avoidRepeats"]').first().check();
  await sample(20, (v) => !/(.)\1/.test(v));
  await page.locator('#gen-page [data-opt="avoidRepeats"]').first().uncheck();
  for (const k of ['upper', 'lower', 'digits', 'symbols']) await page.locator(`#gen-page [data-opt="${k}"]`).uncheck();
  await expect(page.locator('#gen-err')).toContainText('Select at least one character type');
  for (const k of ['upper', 'lower', 'digits', 'symbols']) await page.locator(`#gen-page [data-opt="${k}"]`).check();
  await expect(page.locator('#gen-err')).toBeEmpty();
  await setNum('#gen-len', 20);
  const bits = Number(await page.locator('#gen-meter .meter-bits').getAttribute('data-bits'));
  expect(bits).toBeGreaterThan(120);
  await expect(page.locator('#gen-meter')).toContainText('bits of entropy');
  await expect(page.locator('#gen-meter .meter-label')).toHaveText('Very strong');
  await shot('72-gen-password-en.png', page.locator('#gen-dialog .modal'));
  // passphrase: only the word count is visible until “More options”
  await page.click('#gen-page [data-mode="passphrase"]');
  await expect(page.locator('#gen-words')).toBeVisible();
  await expect(page.locator('#gen-sep')).toBeHidden();
  await setNum('#gen-words', 6);
  await openMore();
  await page.selectOption('#gen-sep', '.');
  let v = await genVal();
  expect(v.split('.').length).toBe(6);
  expect(v.split('.').every((w) => /^[A-Z]/.test(w))).toBe(true);
  expect(/\d/.test(v)).toBe(true);
  await page.locator('#gen-page [data-opt="capitalize"]').uncheck();
  await page.locator('#gen-page [data-opt="includeNumber"]').uncheck();
  v = await genVal();
  expect(/^[a-z]+(\.[a-z]+){5}$/.test(v.replace(/-/g, ''))).toBe(true);
  await page.locator('#gen-page [data-opt="capitalize"]').check();
  await page.locator('#gen-page [data-opt="includeNumber"]').check();
  await page.selectOption('#gen-sep', '-');
  await shot('73-gen-passphrase-en.png', page.locator('#gen-dialog .modal'));
  await page.click('#gen-page [data-mode="pin"]');
  await setNum('#gen-pinlen', 8);
  await sample(10, (x) => /^\d{8}$/.test(x));
  await page.click('#gen-page [data-mode="password"]');
  expect((await genVal()).length).toBe(20); // password length kept separately from PIN length
  await closeGen();
});

test('generator: copy + clipboard, history (10, in memory, clearable), preferences remembered across reload', async () => {
  await openGen();
  for (let i = 0; i < 12; i++) await page.click('#gen-page [data-act="regen"]');
  await page.locator('#gen-dialog .gen-history-box > summary').click();
  await expect(page.locator('#gen-history li')).toHaveCount(10);
  await expect(page.locator('#gen-history')).not.toContainText(await genVal()); // masked
  await page.locator('#gen-history [data-hist-eye="0"]').click();
  await expect(page.locator('#gen-history [data-hist-val="0"]')).toHaveText(await genVal());
  await page.click('#gen-page [data-act="copy"]');
  await expect(page.locator('#toast')).toContainText('clipboard clears in 30s');
  expect(await clip()).toBe(await genVal());
  await page.click('#btn-gen-history-clear');
  await expect(page.locator('#gen-history')).toContainText('Nothing generated yet');
  await page.click('#gen-page [data-mode="passphrase"]');
  await setNum('#gen-words', 7);
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).settings.generatorPrefs?.words, { timeout: 5000 }).toBe(7);
  const prefs = (await (await page.request.get('/api/settings')).json()).settings.generatorPrefs;
  expect(prefs.mode).toBe('passphrase');
  expect(prefs.length).toBe(20);
  expect(prefs.pinLength).toBe(8);
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await openGen();
  await expect(page.locator('#gen-page [data-mode="passphrase"]')).toHaveClass(/on/);
  expect((await genVal()).split('-').length).toBe(7);
  await expect(page.locator('#gen-history li')).toHaveCount(1); // history reset on reload (memory only)
  await page.click('#gen-page [data-mode="password"]');
  await closeGen();
});

test('connections: tiles open a dialog; helper text + vendor links, prefix validation, risk warnings, Test connection (mock) ok/fail, presets, secret never shown', async () => {
  const result = page.locator('#conn-result');
  await tile('github');
  await expect(page.locator('#conn-dialog')).toContainText('Fine-grained token');
  await expect(page.locator('#conn-dialog-sub a.link-out')).toHaveAttribute('href', /github\.com\/settings\/personal-access-tokens/);
  await expect(page.locator('#conn-secret')).toHaveAttribute('spellcheck', 'false');
  await page.fill('#conn-secret', 'abc');
  await page.locator('#conn-secret').blur();
  await expect(page.locator('#conn-dialog')).toContainText('Should start with ghp_ / github_pat_');
  await page.click('#btn-conn-test');
  await expect(result).toBeHidden(); // invalid → no request
  await page.fill('#conn-secret', 'ghp_bad_E2Eabcdefghijklmnopqrstuv');
  await page.click('#btn-conn-test');
  await expect(result).toHaveClass(/fail/);
  await expect(result).toContainText('Authentication failed');
  await page.fill('#conn-secret', SECRETS.ghGood);
  await page.click('#btn-conn-test');
  await expect(result).toHaveClass(/ok/);
  await expect(result).toContainText('Connected as octo-e2e');
  await expect(result.locator('.chip')).toHaveText(['repo', 'read:user']);
  await expect(result).not.toContainText('ghp_');
  await shot('75-connector-test-en.png', page.locator('#conn-dialog .modal'));
  await page.click('#btn-conn-save');
  await expect(page.locator('#toast')).toContainText('GitHub added');
  await expect(page.locator('#conn-dialog')).toBeHidden();
  const row = page.locator('#apps-list tbody tr', { hasText: 'GitHub' });
  await row.locator('[data-test-app]').click();
  await expect(row.locator('.test-inline')).toContainText('octo-e2e');
  await expect(page.locator('#apps-list')).not.toContainText(SECRETS.ghGood);
  // notion
  await tile('notion');
  await expect(page.locator('#conn-dialog-sub a.link-out')).toHaveAttribute('href', /notion\.so/);
  await page.fill('#conn-secret', 'ntn_good_E2Eabcdefghijklmnopqrstu');
  await page.click('#btn-conn-test');
  await expect(result).toContainText('E2E Notion Bot');
  await expect(result).toContainText('E2E Workspace');
  await closeConn();
  // stripe: live secret key warns; restricted key note; publishable key rejected
  await tile('stripe');
  await expect(page.locator('#conn-dialog-sub a.link-out')).toHaveAttribute('href', /dashboard\.stripe\.com\/apikeys/);
  await page.fill('#conn-secret', SECRETS.stripeLive);
  await page.locator('#conn-secret').dispatchEvent('input');
  await expect(page.locator('#conn-form .warn-msg')).toContainText(/Unrestricted live secret key|不受限的正式密钥/);
  await page.click('#btn-conn-test');
  await expect(result).toContainText('E2E Shop');
  await expect(result).toContainText('live');
  await page.fill('#conn-secret', 'rk_live_good_E2E1234567890abcdefgh');
  await page.locator('#conn-secret').dispatchEvent('input');
  await expect(page.locator('#conn-form .warn-msg')).toBeEmpty();
  await page.click('#btn-conn-test');
  await expect(result).toContainText('restricted');
  await page.fill('#conn-secret', 'pk_live_E2E1234567890abcdefghijk');
  await page.locator('#conn-secret').blur();
  await expect(page.locator('#conn-dialog')).toContainText('Should start with rk_live_');
  await closeConn();
  // Generic HTTP with presets (Linear / Sentry / Slack replace the old dedicated connectors)
  await tile('generic');
  await expect(page.locator('#conn-preset button')).toHaveText(['Linear', 'Sentry', 'Slack', 'Custom']);
  await expect(page.locator('#conn-preset [data-preset="linear"]')).toHaveClass(/on/);
  await expect(page.locator('#conn-base')).toHaveValue(MOCK); // VAULTAI_API_BASE_LINEAR → mock
  await expect(page.locator('#conn-name')).toHaveValue('Linear');
  await expect(page.locator('#conn-header-field')).toBeHidden();
  await page.fill('#conn-secret', 'lin_api_good_E2Eabcdefghijklmnopq');
  await page.click('#btn-conn-test');
  await expect(result).toContainText('lin@e2e.test');
  await page.click('#conn-preset [data-preset="sentry"]');
  await expect(page.locator('#conn-base')).toHaveValue(`${MOCK}/api/0`);
  await expect(page.locator('#conn-name')).toHaveValue('Sentry');
  await page.fill('#conn-secret', 'not-a-sentry-token');
  await page.locator('#conn-secret').blur();
  await expect(page.locator('#conn-dialog')).toContainText('doesn’t look like a Sentry token');
  await page.fill('#conn-secret', 'sntryu_good_E2Eabcdefghijklmnopqrstu');
  await page.click('#btn-conn-test');
  await expect(result).toContainText('sentry@e2e.test');
  await page.click('#conn-preset [data-preset="slack"]');
  await expect(page.locator('#conn-base')).toHaveValue(`${MOCK}/api`);
  await page.fill('#conn-secret', 'xoxb-good-E2E-1234567890-abcdefgh');
  await page.click('#btn-conn-test');
  await expect(result).toContainText('e2ebot');
  await page.fill('#conn-secret', 'xoxb-bad-E2E-1234567890-abcdefghij');
  await page.click('#btn-conn-test');
  await expect(result).toContainText('Authentication failed');
  // custom: header + URL validation (base URL required), plain-http warning, test via mock
  await page.click('#conn-preset [data-preset="custom"]');
  await expect(page.locator('#conn-header-field')).toBeVisible();
  await expect(page.locator('#conn-base')).toHaveValue('');
  await page.fill('#conn-header', 'Bad Header!');
  await page.locator('#conn-header').blur();
  await expect(page.locator('#conn-dialog')).toContainText('Letters, digits and hyphens only');
  await page.fill('#conn-header', 'X-API-Key');
  await page.fill('#conn-secret', 'good-generic-key-123');
  await page.fill('#conn-name', 'Mock Generic');
  await page.click('#btn-conn-save', { force: true });
  await expect(page.locator('#conn-dialog')).toContainText('This field is required'); // base URL is mandatory
  await page.fill('#conn-base', 'http://api.example.com');
  await expect(page.locator('#conn-dialog .warn-msg').first()).toContainText('unencrypted');
  await page.fill('#conn-base', `${MOCK}/generic`);
  await page.click('#btn-conn-test');
  await expect(result).toContainText('Connected as HTTP 200');
  await page.click('#btn-conn-save');
  await expect(page.locator('#conn-dialog')).toBeHidden();
  await expect(page.locator('#apps-list')).toContainText('Mock Generic');
  await expect(page.locator('#apps-list')).not.toContainText('good-generic-key-123');
});

test('edit connection: rename, rotate secret, change base URL — access levels kept', async () => {
  const apps = (await (await page.request.get('/api/applications')).json()).applications;
  const gen = apps.find((a) => a.name === 'Mock Generic');
  const a = (await (await apiPost('/api/assistants', { name: 'Edit Check', kind: 'cursor', duration: '1d' })).json());
  await page.request.put(`/api/permissions/${a.assistant.id}/${gen.id}`, { data: { level: 'write' } });
  await nav('connections');
  await page.locator(`[data-app-row="${gen.id}"] [data-edit-app]`).click();
  await expect(page.locator('#conn-dialog-title')).toContainText('Mock Generic');
  await expect(page.locator('#conn-secret')).toHaveValue('');
  await expect(page.locator('#conn-base')).toHaveValue(`${MOCK}/generic`);
  await page.fill('#conn-name', 'Mock Generic (renamed)');
  await page.fill('#conn-secret', 'good-rotated-key-456');
  await page.click('#btn-conn-save');
  await expect(page.locator('#toast')).toContainText('Saved');
  await expect(page.locator('#conn-result')).toContainText('Connected as HTTP 200');
  await closeConn();
  await expect(page.locator('#apps-list')).toContainText('Mock Generic (renamed)');
  const perms = (await (await page.request.get('/api/permissions')).json()).assistants.find((x) => x.id === a.assistant.id).permissions;
  expect(perms[gen.id]).toBe('write');
  // the AI now uses the rotated key (mock accepts keys containing "good"; check what reached it)
  const r = await page.request.post('/api/tool/invoke', { headers: { Authorization: `Bearer ${a.token}` }, data: { name: `generic_${gen.id}_http_request`, arguments: { method: 'GET', path: '/x' } } });
  expect((await r.json()).ok).toBe(true);
  await page.request.delete(`/api/assistants/${a.assistant.id}`);
});

test('google (Beta) dialog: client-ID pattern, GOCSPX- prefix, redirect URI copy button', async () => {
  await tile('google');
  await expect(page.locator('#conn-dialog-title')).toContainText('Beta');
  await page.fill('#google-client-id', 'abc');
  await page.locator('#google-client-id').blur();
  await expect(page.locator('#google-card')).toContainText('apps.googleusercontent.com');
  await page.fill('#google-client-secret', 'xyz');
  await page.locator('#google-client-secret').blur();
  await expect(page.locator('#google-card')).toContainText('Should start with GOCSPX-');
  await expect(page.locator('#btn-save-google-client')).toHaveAttribute('aria-disabled', 'true');
  await page.click('#btn-copy-redirect');
  const port = new URL(base).port;
  expect(await clip()).toBe(`http://127.0.0.1:${port}/oauth/google/callback`);
  await expect(page.locator('#google-steps')).toContainText(`127.0.0.1:${port}/oauth/google/callback`);
  await page.fill('#google-client-id', '123456789012-e2eabcdefghijklmnopqrstuvwxyz0123.apps.googleusercontent.com');
  await page.fill('#google-client-secret', 'GOCSPX-e2e-secret-value');
  await expect(page.locator('#btn-save-google-client')).not.toHaveAttribute('aria-disabled', 'true');
  await page.click('#btn-save-google-client');
  await expect(page.locator('#google-badge')).toHaveText('Client saved');
  await closeConn();
  // unconnected Google is not offered in the access matrix
  await nav('assistants');
  await expect(page.locator('#perm-matrix')).not.toContainText('Gmail');
  await expect(page.locator('#perm-matrix')).not.toContainText('Calendar');
});

test('clipboard auto-clear: Settings › Security (2s clears, 0 never), range validation; rate limit lives under Advanced', async () => {
  await nav('settings', 'set-security');
  await page.fill('#set-clip', '9999');
  await page.locator('#set-clip').blur();
  await expect(page.locator('#settings-form')).toContainText('from 0 to 600');
  await expect(page.locator('#btn-save-settings')).toHaveAttribute('aria-disabled', 'true');
  await page.fill('#set-clip', '2');
  await page.click('#btn-save-settings');
  await expect(page.locator('#toast')).toContainText('Settings saved');
  expect((await (await page.request.get('/api/settings')).json()).settings.clipboardClearSeconds).toBe(2);
  await nav('settings', 'set-advanced');
  await page.fill('#set-rate', '5');
  await page.locator('#set-rate').blur();
  await expect(page.locator('#advanced-form')).toContainText('from 10 to 10000');
  await page.fill('#set-rate', '120');
  await page.click('#btn-save-advanced');
  await expect(page.locator('#toast')).toContainText('Settings saved');
  await nav('passwords');
  const row = page.locator('#pw-list tbody tr', { hasText: 'Mock Account' });
  await row.locator('[data-pw-copy]').click();
  await expect(page.locator('#toast')).toContainText('clears in 2s');
  expect(await clip()).toBe(SECRETS.reused);
  await expect.poll(clip, { timeout: 6000 }).toBe('');
  await nav('settings', 'set-security');
  await page.fill('#set-clip', '0');
  await page.click('#btn-save-settings');
  await expect(page.locator('#toast')).toContainText('Settings saved');
  await nav('passwords');
  await row.locator('[data-pw-copy]').click();
  await page.waitForTimeout(3000);
  expect(await clip()).toBe(SECRETS.reused);
  await nav('settings', 'set-security');
  await page.fill('#set-clip', '30');
  await page.click('#btn-save-settings');
  await expect(page.locator('#toast')).toContainText('Settings saved');
});

test('assistant dialog, limits and change-master forms validate inline; setup shows the real MCP port; server enforces master policy', async () => {
  await nav('assistants');
  await page.click('#btn-ai-new');
  await expect(page.locator('#ai-dialog')).toBeVisible();
  await page.fill('#asst-name', 'a');
  await page.locator('#asst-name').blur();
  await expect(page.locator('#asst-form')).toContainText('at least 2 characters');
  await page.click('#asst-kind-picker [data-client="claude-desktop"]');
  await page.fill('#asst-name', 'E2E Bot');
  await page.click('#btn-add-asst');
  await expect(page.locator('#ai-setup')).toBeVisible();
  await expect(page.locator('#token-once')).toHaveValue(/^vai_/);
  await expect(page.locator('#token-once')).toHaveAttribute('readonly', '');
  await page.click('#btn-copy-token');
  expect(await clip()).toMatch(/^vai_/);
  // regression: MCP URL uses the port we actually listen on
  const port = new URL(base).port;
  await shot('81-setup-en.png', page.locator('#ai-dialog .modal'));
  await page.click('#setup-tabs [data-setup-tab="http"]');
  await expect(page.locator('#setup-snippet')).toContainText(`http://127.0.0.1:${port}/mcp`);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ai-dialog')).toBeHidden();
  await page.click('#btn-ai-new');
  await page.fill('#asst-name', 'e2e bot');
  await expect(page.locator('#asst-form .warn-msg')).toContainText('already exists');
  await page.keyboard.press('Escape');
  if (await page.locator('#modal').isVisible()) await page.click('#modal-ok');
  // limits are part of Activity now
  await nav('activity');
  await page.fill('#limit-key', 'bad key');
  await page.locator('#limit-key').blur();
  await expect(page.locator('[data-form="limit"]')).toContainText('Use connection:action');
  await page.fill('#limit-val', '-5');
  await page.locator('#limit-val').blur();
  await expect(page.locator('[data-form="limit"]')).toContainText('from 0 to 100000');
  const keys = await page.locator('#limit-keys option').evaluateAll((os) => os.map((o) => o.value));
  expect(keys).toEqual(expect.arrayContaining(['github:create_issue', 'passwords:get_password']));
  expect(keys.some((k) => /^(demo|web|linear|sentry|slack):/.test(k))).toBe(false);
  await page.fill('#limit-key', 'github:create_issue');
  await page.fill('#limit-val', '50');
  await page.click('#btn-set-limit');
  await expect(page.locator('#limits-list')).toContainText('github:create_issue');
  await page.fill('#default-limit', '200000');
  await page.locator('#default-limit').blur();
  await expect(page.locator('[data-form="defaultLimit"]')).toContainText('from 0 to 100000');
  await nav('settings', 'set-security');
  await page.fill('#pw-old', SECRETS.master);
  await page.fill('#pw-new', SECRETS.master);
  await page.locator('#pw-new').blur();
  await expect(page.locator('#changepw-form')).toContainText('must be different');
  await page.fill('#pw-new', 'password1');
  await page.locator('#pw-new').blur();
  await expect(page.locator('#changepw-form')).toContainText('too common');
  await expect(page.locator('[data-meter-for="pw-new"]')).toHaveAttribute('data-score', '0');
  await page.fill('#pw-new', 'Brand-New-Master-Quartz-77');
  await page.fill('#pw-new2', 'Brand-New-Master-Quartz-7');
  await page.locator('#pw-new2').blur();
  await expect(page.locator('#changepw-form')).toContainText('Doesn’t match');
  const r = await apiPost('/api/vault/change-password', { oldPassword: SECRETS.master, newPassword: 'password1' });
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('WEAK_PASSWORD');
  const r2 = await apiPost('/api/vault/change-password', { oldPassword: SECRETS.master, newPassword: SECRETS.master });
  expect((await r2.json()).code).toBe('SAME_PASSWORD');
});

test('unsaved-changes guard on navigation: cancel stays, discard leaves and resets', async () => {
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.click('.nav-btn[data-tab="settings"]');
  await page.click('#tab-settings [data-sub="set-security"]');
  await page.fill('#set-idle', '7');
  await page.click('.nav-btn[data-tab="connections"]');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('Discard unsaved changes?');
  await page.click('#modal-cancel');
  await expect(page.locator('#tab-settings')).toBeVisible();
  await expect(page.locator('#set-idle')).toHaveValue('7');
  await page.click('.nav-btn[data-tab="connections"]');
  await page.click('#modal-ok');
  await expect(page.locator('#tab-connections')).toBeVisible();
  await page.click('.nav-btn[data-tab="settings"]');
  await page.click('#tab-settings [data-sub="set-security"]');
  await expect(page.locator('#set-idle')).toHaveValue('30');
});

test('security check (Passwords › Security check): weak, reused, old >180 days, one-click fix, no secrets in response', async () => {
  await apiPost('/api/passwords', { title: 'Weak One', username: 'w', password: 'password123', url: 'https://weak.example' });
  await apiPost('/api/passwords', { title: 'Old One', username: 'o', password: 'Old-But-Strong-Pw-5520', url: 'https://old.example', passwordUpdatedAt: '2025-01-01T00:00:00.000Z' });
  const h = await (await page.request.get('/api/password-health')).json();
  const raw = JSON.stringify(h);
  expect(raw).not.toContain('password123');
  expect(raw).not.toContain(SECRETS.reused);
  await nav('passwords', 'pw-check');
  await expect(page.locator('#pw-check-count')).not.toHaveText('');
  await expect(page.locator('#health-weak')).toContainText('Weak One');
  await expect(page.locator('#health-reused')).toContainText('Mock Account');
  await expect(page.locator('#health-reused')).toContainText('Other Site');
  await expect(page.locator('#health-old')).toContainText('Old One');
  await expect(page.locator('#health-old')).toContainText('days old');
  await expect(page.locator('#health-reused-n')).toHaveText('2');
  const score = parseInt(await page.locator('#health-score').textContent(), 10);
  expect(score).toBeLessThan(100);
  await shot('76-health-en.png');
  await page.locator('#health-weak li', { hasText: 'Weak One' }).locator('[data-fix]').click();
  await expect(page.locator('#pw-dialog')).toBeVisible();
  await expect(page.locator('#pw-title')).toHaveValue('Weak One');
  await page.click('#btn-pw-gen');
  await page.click('#pwgen-use');
  await page.click('#btn-pw-save');
  await expect(page.locator('#pw-dialog')).toBeHidden();
  await expect(page.locator('#health-weak')).not.toContainText('Weak One');
  // home dashboard reflects the same health data
  await nav('home');
  await expect(page.locator('#home-score')).not.toHaveText('');
});

const OVERFLOW_JS = () => {
  const bad = [];
  const sel = '.btn, .field-label, .nav-btn, .stat .k, .seg button, .chip, .form-section, .card-head h3, .check span, .help, .page-header h2, .subtabs button, .tile';
  for (const el of document.querySelectorAll(sel)) {
    if (!el.offsetParent) continue;
    if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`);
  }
  const main = document.querySelector('.main');
  if (main && main.scrollWidth > main.clientWidth + 1) bad.push('main overflows horizontally');
  return bad;
};
async function checkOverflow(label) {
  const problems = [];
  const views = [['home'], ['passwords', 'pw-items'], ['passwords', 'pw-check'], ['connections'], ['assistants'], ['activity'], ['settings', 'set-general'], ['settings', 'set-security'], ['settings', 'set-advanced']];
  for (const [tab, sub] of views) {
    await nav(tab, sub);
    await page.waitForTimeout(250);
    problems.push(...(await page.evaluate(OVERFLOW_JS)).map((p) => `${label}/${tab}${sub ? '/' + sub : ''}: ${p}`));
  }
  await nav('passwords');
  await page.click('#btn-pw-new');
  await page.click('#btn-pw-gen');
  problems.push(...(await page.evaluate(OVERFLOW_JS)).map((p) => `${label}/pw-dialog: ${p}`));
  await page.keyboard.press('Escape');
  if (await page.locator('#modal').isVisible()) await page.click('#modal-ok');
  await openGen();
  await openMore();
  problems.push(...(await page.evaluate(OVERFLOW_JS)).map((p) => `${label}/gen-dialog: ${p}`));
  await closeGen();
  return problems;
}

test('no text overflow in en; then zh-CN pass with Chinese messages + screenshots; no overflow in zh', async () => {
  expect(await checkOverflow('en')).toEqual([]);
  await setLang('zh-CN');
  await nav('passwords');
  await page.click('#btn-pw-new');
  await expect(page.locator('#pw-editor')).toContainText('会自动填入名称和图标');
  await page.keyboard.press('Escape');
  // generator zh: collapsed, then expanded
  await openGen();
  await expect(page.locator('#gen-page')).toContainText('口令短语');
  await expect(page.locator('#gen-meter')).toContainText('位熵');
  await expect(page.locator('#gen-page .gen-opts:not(.hidden) .gen-more > summary')).toHaveText('更多选项');
  await shot('82-gen-collapsed-zh.png', page.locator('#gen-dialog .modal'));
  await openMore();
  await shot('72-gen-password-zh.png', page.locator('#gen-dialog .modal'));
  await page.click('#gen-page [data-mode="passphrase"]');
  await shot('73-gen-passphrase-zh.png', page.locator('#gen-dialog .modal'));
  await page.click('#gen-page [data-mode="password"]');
  await closeGen();
  // connector zh
  await tile('github');
  await page.fill('#conn-secret', SECRETS.ghGood);
  await page.click('#btn-conn-test');
  await expect(page.locator('#conn-result')).toContainText('连接成功：octo-e2e');
  await expect(page.locator('#conn-dialog')).toContainText('获取令牌');
  await shot('75-connector-test-zh.png', page.locator('#conn-dialog .modal'));
  await closeConn();
  await nav('passwords', 'pw-check');
  await expect(page.locator('#pw-check')).toContainText('重复使用的密码');
  await shot('76-health-zh.png');
  expect(await checkOverflow('zh')).toEqual([]);
});
