import { defineConfig } from '@playwright/test';

// E2E_SPEC selects the spec (ui | ui2-forms); each runs against its own fresh server.
const spec = process.env.E2E_SPEC || 'ui';
export default defineConfig({
  testDir: '.',
  testMatch: new RegExp(`(^|/)${spec.replace(/[-.]/g, '\\$&')}\\.spec\\.mjs$`),
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: `results/${spec}.json` }]],
  use: {
    baseURL: process.env.E2E_BASE || 'http://127.0.0.1:3847',
    headless: true,
    viewport: { width: 1360, height: 860 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  outputDir: `results/pw-artifacts-${spec}`,
});
