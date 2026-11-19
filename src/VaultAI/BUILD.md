# Build VaultAI 1.5

```bash
npm install
npm run build             # tsc → dist/ (server, cli, electron, shared, store) + copy UI assets to dist/ui
npm run test:unit         # generator, strength, migration, generic URL lock, i18n tables
npm run test:e2e          # full E2E (needs xvfb for Electron) → e2e/RESULTS.md + e2e/screenshots/
E2E_ONLY=ui npm run test:e2e   # one area: unit | ui | forms | migration | mcp | electron
npm start                 # http://127.0.0.1:3847
npm run electron          # desktop shell
npm run pack:src          # VaultAI-src.zip
npx electron-builder --win nsis --x64       # VaultAI-Setup-<ver>.exe
npx electron-builder --win portable --x64   # VaultAI-Setup-<ver>-Portable.exe
npm run pack:installer    # VaultAI-Setup-<ver>-win-x64.zip (enhanced Setup)
```

Environment:
- `VAULTAI_DATA`, `VAULTAI_PORT`: isolated data folder and port.
- `VAULTAI_DEV=1`: developer mode, with the Demo connector.
- `VAULTAI_ALLOW_NON_LOOPBACK=1`: allow a non-loopback `VAULTAI_HOST`. There is no UI switch for this.
- `VAULTAI_API_BASE_<KIND>`: API base override for GitHub, Notion, Stripe and the Linear, Sentry and Slack presets. Used by the E2E mock.

Layout:
- `src/shared/`: generator (CSPRNG with rejection sampling), strength estimator, word lists, and **`presets.ts`** (Generic HTTP presets, pure data shared by server and UI).
- `src/store/db.ts`: encrypted vault. `src/store/migrate.ts` is the pure, idempotent schema 1 → 2 migration; the `pre-1.5.0-backup/` copy is made in `db.ts`.
- `src/connectors/`: GitHub, Notion, Stripe, Generic HTTP (base-URL lock), Gmail/Calendar (Beta), passwords, Demo (dev only). `preset-base.ts` resolves base URLs and overrides.
- `src/server/`: `api.ts` (REST for the UI), `mcp.ts` (JSON-RPC), `tools.ts` (tool list and dispatch), `setup.ts` (per-client snippets), `assist.ts` (Test connection, site info).
- `ui/`: `index.html`, `js/app.js` (shell), `js/pages/{home,passwords,connections,assistants,activity}.js`, `js/core.js` (form engine), `js/generator-ui.js`, `js/i18n.js` (one key table, zh-CN and en; checked by `scripts/check-i18n.mjs`).
- `e2e/fixtures/vault-v131`, `vault-v140`: real vaults written by the 1.3.1 and 1.4.0 builds. Regenerate them with `e2e/fixtures/make-v140-fixture.mjs`.
