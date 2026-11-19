// 1.6.1 caret-following mini picker — harness login page + live autofill API.
import { test, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.E2E_BASE || 'http://127.0.0.1:3861';
const shotDir = join(ROOT, 'e2e/screenshots');
mkdirSync(shotDir, { recursive: true });
const HARNESS = readFileSync(join(ROOT, 'e2e/fixtures/mini-harness.html'), 'utf8');

test.describe.configure({ mode: 'serial' });

async function setup(page, { lang = 'en', typed = 'alice', host, cy } = {}) {
  await page.setViewportSize({ width: 1100, height: 640 });
  // Stub the Electron preload bridge inside the picker frame, wired to the harness parent.
  await page.addInitScript(() => {
    if (!location.pathname.startsWith('/autofill/index.html')) return;
    window.__calls = [];
    window.VaultAutofill = {
      dismiss: () => { window.__calls.push('dismiss'); parent.__closed(); },
      fill: (id) => { window.__calls.push('fill:' + id); parent.__closed(); },
      openApp: () => { window.__calls.push('open-app'); },
      resize: (n) => { parent.__resize(n); },
      onContext: () => {},
      onTyped: (cb) => { window.__typedCb = cb; },
      onKey: (cb) => { window.__keyCb = cb; },
    };
  });
  await page.route(base + '/__harness.html*', (r) => r.fulfill({ contentType: 'text/html', body: HARNESS }));
  const q = new URLSearchParams({ lang }); if (host) q.set('host', host); if (cy) q.set('cy', String(cy));
  await page.goto(base + '/__harness.html?' + q);
  await page.evaluate((t) => window.__open(t), typed);
  const fr = page.frameLocator('#mini');
  await expect(fr.locator('body[data-ready="1"]')).toBeAttached({ timeout: 10000 });
  return fr;
}
const frameObj = (page) => page.frames().find((f) => f.url().includes('/autofill/index.html'));

test('mini zh screenshot next to caret', async ({ page }) => {
  const fr = await setup(page, { lang: 'zh-CN' });
  await expect(fr.locator('.row').first()).toBeVisible();
  await expect(fr.locator('#foot')).toContainText('Enter/Tab 填入');
  const box = await page.locator('#mini').boundingBox();
  const user = await page.locator('#user').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(260); expect(box.width).toBeLessThanOrEqual(330);
  expect(box.y).toBeGreaterThan(user.y); expect(box.y).toBeLessThan(user.y + user.height + 10);
  expect(box.x).toBeGreaterThan(user.x + 20); // anchored at caret, not field start
  const rh = await fr.locator('.row').first().boundingBox();
  expect(rh.height).toBeGreaterThanOrEqual(28); expect(rh.height).toBeLessThanOrEqual(32);
  await expect(fr.locator('.hdr, header, #btn-close')).toHaveCount(0);
  await page.screenshot({ path: join(shotDir, 'autofill-mini-zh.png'), clip: { x: user.x - 40, y: user.y - 120, width: 520, height: 330 } });
});

test('mini en screenshot next to caret', async ({ page }) => {
  const fr = await setup(page, { lang: 'en' });
  await expect(fr.locator('#foot')).toContainText('Enter/Tab fill');
  const user = await page.locator('#user').boundingBox();
  await page.screenshot({ path: join(shotDir, 'autofill-mini-en.png'), clip: { x: user.x - 40, y: user.y - 120, width: 520, height: 330 } });
});

test('typing stays in target field and filters live', async ({ page }) => {
  const fr = await setup(page, { typed: 'ali', host: 'https://nowhere.test' });
  const before = await fr.locator('.row:not(.none)').count();
  await page.locator('#user').pressSequentially('ce-d');
  await expect(page.locator('#user')).toHaveValue('alice-d');
  await expect(page.locator('#user')).toBeFocused();
  await expect(fr.locator('.row .tt').first()).toHaveText('GitHub');
  expect(await fr.locator('.row:not(.none)').count()).toBeLessThanOrEqual(before);
});

test('↑↓ navigation + Enter fills highlighted', async ({ page }) => {
  const fr = await setup(page, { typed: 'alice', host: 'https://nowhere.test' });
  const n = await fr.locator('.row').count();
  expect(n).toBeGreaterThanOrEqual(2);
  await page.locator('#user').press('ArrowDown');
  await expect(fr.locator('body')).toHaveAttribute('data-idx', '1');
  await page.locator('#user').press('ArrowUp');
  await page.locator('#user').press('ArrowUp');
  await expect(fr.locator('body')).toHaveAttribute('data-idx', String(n - 1));
  const id = await fr.locator('.row').nth(n - 1).getAttribute('data-id');
  await page.locator('#user').press('Enter');
  expect(await frameObj(page).evaluate(() => window.__calls)).toContain('fill:' + id);
});

test('number key quick-pick + Tab fill', async ({ page }) => {
  let fr = await setup(page, { typed: 'alice', host: 'https://nowhere.test' });
  const id2 = await fr.locator('.row').nth(1).getAttribute('data-id');
  await page.locator('#user').press('2');
  await expect(page.locator('#user')).toHaveValue('alice'); // digit consumed by hook
  expect(await frameObj(page).evaluate(() => window.__calls)).toContain('fill:' + id2);
  fr = await setup(page, { typed: 'alice', host: 'https://nowhere.test' });
  const id0 = await fr.locator('.row').first().getAttribute('data-id');
  await page.locator('#user').press('Tab');
  expect(await frameObj(page).evaluate(() => window.__calls)).toContain('fill:' + id0);
});

test('Esc dismisses; outside click dismisses; inside click picks', async ({ page }) => {
  await setup(page);
  await page.locator('#user').press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
  await expect(page.locator('#mini')).toBeHidden();
  await setup(page);
  await page.mouse.click(30, 30);
  await expect(page.locator('#mini')).toBeHidden();
  const fr = await setup(page);
  const id = await fr.locator('.row').first().getAttribute('data-id');
  await fr.locator('.row').first().click();
  expect(await frameObj(page).evaluate(() => window.__calls)).toContain('fill:' + id);
});

test('single match shows one row, no auto-fill', async ({ page }) => {
  const fr = await setup(page, { typed: 'bob@other.com', host: 'https://other.example' });
  await expect(fr.locator('.row')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await frameObj(page).evaluate(() => window.__calls)).toEqual([]);
});

test('no match: save-login + open VaultAI rows', async ({ page }) => {
  const fr = await setup(page, { typed: 'zzzz-nothing', host: 'https://zz.test', lang: 'zh-CN' });
  await expect(fr.locator('.row.none')).toHaveCount(2);
  await expect(fr.locator('.row.none').nth(0)).toHaveText(/保存此登录/);
  await expect(fr.locator('.row.none').nth(1)).toHaveText(/打开 VaultAI/);
  // Enter on highlighted (save) → save-login; arrow down then Enter → open-app
  await page.locator('#user').press('ArrowDown');
  await page.locator('#user').press('Enter');
  expect(await frameObj(page).evaluate(() => window.__calls)).toContain('open-app');
});

test('flips above caret near screen bottom', async ({ page }) => {
  await setup(page, { cy: 470 });
  await expect(page.locator('body')).toHaveAttribute('data-flipped', 'true');
  const box = await page.locator('#mini').boundingBox();
  const user = await page.locator('#user').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(user.y + user.height);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
});

test('scrolls after 6 rows', async ({ page }) => {
  const fr = await setup(page, { typed: '', host: '' });
  const n = await fr.locator('.row').count();
  const box = await page.locator('#mini').boundingBox();
  expect(box.height).toBeLessThanOrEqual(8 + 6 * 30 + 18 + 10);
  test.info().annotations.push({ type: 'rows', description: String(n) });
});
