// VaultAI 1.5 — migration UI on a real 1.4.0 vault (already unlocked + migrated by migration.e2e.mjs).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');
const fx = JSON.parse(readFileSync(join(HERE, 'fixtures', 'vault-v140.json'), 'utf8'));
test.describe.configure({ mode: 'serial' });
let page, context;
const shot = async (name, loc) => { await page.waitForTimeout(350); await (loc || page).screenshot({ path: join(SHOTS, name) }); };
const nav = async (tab) => { await page.click(`.nav-btn[data-tab="${tab}"]`); await expect(page.locator(`#tab-${tab}`)).toBeVisible(); };

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
});
test.afterAll(async () => { await context?.close(); });

test('home shows what changed in 1.6.0 (zh): backup, conversions, removed items, ChatGPT, Gmail Draft, limits', async () => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vaultai_lang', 'zh-CN'));
  await page.request.put('/api/settings', { data: { language: 'zh-CN' } });
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  const card = page.locator('#mig-notices');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-notice]')).toHaveCount(14);
  await expect(card.locator('[data-notice="mig.backup"]')).toContainText('pre-1.5.0-backup');
  await expect(card.locator('[data-notice="mig.autofill"]')).toBeVisible();
  await expect(card.locator('[data-notice="mig.dbStorage"]')).toBeVisible();
  await expect(card.locator('[data-notice="mig.v19"]')).toBeVisible();
  await expect(card.locator('[data-notice="mig.converted"]').first()).toContainText('Team Linear');
  await expect(card.locator('[data-notice="mig.noBase"]')).toContainText('Legacy API');
  await expect(card.locator('[data-notice="mig.chatgpt"]')).toContainText('Old ChatGPT');
  await expect(card.locator('[data-notice="mig.gmailDraft"]')).toContainText('Old ChatGPT');
  await expect(card).not.toContainText(/good|FIXTURE|\{/); // no secrets, no raw placeholders
  await shot('84-migration-notices-zh.png');
});

test('connections after migration: presets labelled, legacy generic flagged → fixed by adding a base URL', async () => {
  await nav('connections');
  const row = (id) => page.locator(`[data-app-row="${id}"]`);
  await expect(row(fx.ids.linear)).toContainText('通用 HTTP · Linear');
  await expect(row(fx.ids.sentry)).toContainText('通用 HTTP · Sentry');
  await expect(row(fx.ids.slack)).toContainText('通用 HTTP · Slack');
  await expect(row(fx.ids.genericNoBase).locator('[data-needs-base]')).toHaveText('缺少基础地址 — 请编辑');
  await shot('85-migration-connections-zh.png');
  await row(fx.ids.genericNoBase).locator('[data-edit-app]').click();
  await expect(page.locator('#conn-base')).toHaveValue('');
  await page.fill('#conn-base', 'https://legacy.example.com/api');
  await page.click('#btn-conn-save');
  await expect(page.locator('#toast')).toContainText('已保存');
  await page.keyboard.press('Escape');
  await expect(row(fx.ids.genericNoBase).locator('[data-needs-base]')).toHaveCount(0);
});

test('English notices + a dismissed notice stays dismissed after reload', async () => {
  await page.request.put('/api/settings', { data: { language: 'en' } });
  await page.evaluate(() => localStorage.setItem('vaultai_lang', 'en'));
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  const card = page.locator('#mig-notices');
  await expect(card.locator('[data-notice="mig.converted"]').first()).toContainText('Generic HTTP');
  await expect(card.locator('[data-notice="mig.webRemoved"]')).toBeVisible();
  await shot('84-migration-notices-en.png');
  const n = await card.locator('[data-notice]').count();
  await card.locator('[data-notice="mig.chatgpt"] [data-dismiss]').click();
  await expect(card.locator('[data-notice]')).toHaveCount(n - 1);
  await page.reload();
  await expect(page.locator('#mig-notices [data-notice]')).toHaveCount(n - 1);
  await expect(page.locator('#mig-notices [data-notice="mig.chatgpt"]')).toHaveCount(0);
});
