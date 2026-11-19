# VaultAI
### What’s new in 1.9.0

- **Save login**: `Ctrl+Shift+S` / autofill empty-state (not an always-on keylogger)
- **Multi-source import**: Chrome / Edge / Firefox / Bitwarden / 1Password / KeePass / Password Depot
- **TOTP**: per-item authenticator (encrypted; detail + optional autofill)
- **DB resilience**: mid-session read-only cache + unlock-fail block & reconnect (no silent dual SoT)

 Tools v1.8

**A password manager built for AI** · **给 AI 用的密码管家**

Store your API keys and passwords in a local AES-256-GCM vault. AI assistants (Claude Desktop, Cursor, Claude Code, any MCP client) can use them through MCP without ever seeing them, within the access level, daily limit and expiry you set. Every request is logged. Desktop UI in 中文 (default) and English.

## Windows install

| File | Use |
|------|-----|
| **`VaultAI-Setup-1.9.0.exe`** | **NSIS installer (recommended)**: wizard, Start Menu and Desktop shortcuts, uninstall from Apps & features. Silent install: `/S` |
| `VaultAI-Setup-1.9.0-win-x64.zip` | Alternative installer: extract and run `VaultAI-Setup.bat`. Installs to `%LOCALAPPDATA%\VaultAI` |
| `VaultAI-Setup-1.9.0-Portable.exe` | Portable: double-click, nothing is installed |
| `VaultAI-src.zip` | Source code, see `BUILD.md` |

Upgrading from 1.3.x or 1.4.0: install over the old version. Your vault opens with the same master password. The original files are copied to `%APPDATA%\VaultAI\pre-1.5.0-backup\` first, and Home lists everything that changed. See `安装说明.txt`.

## What's new in 1.9.0

- **Background quick-create hotkey**: default `Ctrl+Shift+N` opens a floating mini sheet near the caret (distinct from autofill `Ctrl+Shift+P` and in-app `Ctrl+N`). Locked vault does not expose secrets.
- **Database storage (not backup)**: Settings → 数据库 / Database. Connect SQLite / PostgreSQL / MySQL, Test connection, enable **将密码存到数据库**. Password CRUD goes to VaultAI tables (`vaultai_passwords`). Default encrypts password / username / notes with the vault AES-256-GCM key. Optional plaintext toggle is OFF with a warning. See [docs/DB-STORAGE.md](docs/DB-STORAGE.md).

## What's new in 1.7.0

- **Quick create**: Passwords → Quick create (or Ctrl+N) for a minimal sheet; More opens the full editor.
- **Import from Password Depot**: plaintext CSV / XML (Tools → Export). See [docs/IMPORT.md](docs/IMPORT.md). Encrypted `.pswe` is not supported. Delete the export after importing.

## Getting started (Home guide, 4 steps)

1. **Create the vault.** Set a master password. It cannot be recovered.
2. **Add a first credential.** Either a connection (GitHub, Notion, Stripe, Generic HTTP with Linear/Sentry/Slack presets, Google Beta) or a password item.
3. **Connect an AI assistant.** Pick the client. VaultAI generates the configuration to paste: Claude Desktop JSON, Cursor JSON, a `claude mcp add` command for Claude Code, or terminal environment variables.
4. **Verify the connection.** Restart the AI app. VaultAI shows "Connected" when the first request with that token arrives.

## Six places

| Sidebar | What it is for |
|---|---|
| **Home** | Guide, what each AI can access right now (with expiry and last seen), today's worked/refused requests, password security score, upgrade notes. **Revoke all AI access** button. |
| **Passwords** | Items (search, favourites, tags) · **Security check** (weak, reused, old) · **Generate password** dialog |
| **Connections** | Your connections (Test, Edit, Remove) and tiles to add GitHub, Notion, Stripe, Generic HTTP or Google (Beta) |
| **AI assistants** | Assistants (Setup, Renew 7 days, Turn on/off, New token, Delete) and the **access matrix** |
| **Activity** | Search and Worked/Refused filter · **Daily limits** |
| **Settings** | General (language, site icons) · Security (auto-lock, clipboard, master password, autofill, quick-create hotkey) · **Database** (SQLite / PostgreSQL / MySQL live password storage) · Advanced (rate limit, version, MCP address, data folder) |

**Access levels are the same for every connection: Off · Read · Write · Full.** Read means look. Write means create or change. Full covers irreversible or sensitive actions such as sending mail or revealing a password value. The passwords column offers Off · Read · Full, because AI can never create or edit items.

**Revoke all AI access** (title bar and Home) turns every assistant off at once and logs it. Access settings are kept, so you can turn assistants back on one by one.

## What changed in 1.5.0–1.6.x, and why

1.5.0 is a product-convergence release: fewer pages, one vocabulary, honest features. The full review is in `docs/PRODUCT-REVIEW.md`.

**Added**
- Home dashboard with the 4-step guide, current AI access, today's activity, the security score and upgrade notes.
- **Revoke all AI access** (kill switch).
- Per-client setup snippets with **Verify connection**. Assistants show **last seen**. **Renew** extends expiry by 7 days.
- **Edit connection**: rename, rotate the secret without losing access levels, set a base URL.
- Empty states with one clear next action. Language switch on the lock screen.

**Merged**
- The sidebar went from 10 items to 6:
  - Generator → *Generate password* dialog plus inline in the item form.
  - Security dashboard → *Passwords › Security check*.
  - Permissions and Connect AI → *AI assistants*.
  - Daily limits → *Activity*.
  - Applications → *Connections*, with forms in dialogs.
- **Linear, Sentry and Slack → Generic HTTP presets.** The dedicated code offered only 3 fixed actions. A preset plus GraphQL covers more. Existing connections are converted in place with the same id, secret and access levels.
- **Folders → tags.** They were two overlapping ways to organise items.
- **Permission levels unified** to Off/Read/Write/Full. Gmail *Draft* becomes **Read** (only ever downgraded, with a note). *Manage* becomes Write. Calendar event creation now needs Write.

**Progressive disclosure**
- The generator shows type, length and the 4 character sets. Ambiguous characters, exclusions, minimums and repeat-avoidance are under **More options**. Passphrase shows only the word count.
- Settings are grouped into General / Security / Advanced. The rate limit moved to Advanced.

**Removed**
- **Web fetch tool**: not a credential, and it acted like a local proxy for the AI (SSRF and exfiltration risk). AI clients can browse on their own.
- **Demo connector**: only appears with `VAULTAI_DEV=1`.
- **"Allow non-local access" switch**: it never worked, and it was dangerous. Experts can still set `VAULTAI_ALLOW_NON_LOOPBACK=1`.
- **ChatGPT client type**: ChatGPT cannot reach a local MCP server. Existing ones become *Other*.
- **Token in the URL (`?token=`) and in request bodies**: tokens leak into logs and history. Only `Authorization: Bearer` or `X-VaultAI-Token` headers are accepted.
- **REST `/mcp/tools` and `/mcp/call`**: duplicates of JSON-RPC.
- **Fictional generic "templates"**, `/api/templates/generic`, `/api/connect`, `/api/server/ping-restart`, `/api/passwords/generate`, `/api/passwords-export`, and dead code.
- **CLI** `tool linear/sentry/slack/web/demo` and `--template`. Use `vaultai tool generic <connectionId>`.
- The "Inspired by GBrain Tools" line in About.

**Fixed (security)**
- Generic HTTP requests are locked to the connection's **base URL**, which is now required. Before, an AI could send the key to any host.
- The Google OAuth callback escaped nothing (reflected XSS on the local origin). It is escaped now.
- `VAULTAI_API_BASE_<KIND>` now applies to real tool calls too, not only to "Test connection".

**Fixed (protocol and desktop)**
- MCP notifications get 202 with no body. `GET /mcp` returns 405. The protocol version is echoed (2024-11-05, 2025-03-26, 2025-06-18).
- The stdio bridge no longer replies to notifications.
- The tray uses the app icon, has bilingual menus, and shows a hint the first time the window hides to the tray.

**Upgrade safety**
- 1.3.x and 1.4.0 vaults open directly. Before the first write, the encrypted files are copied untouched to `pre-1.5.0-backup/`.
- No user secret is ever dropped. Every change becomes a note on Home that you can dismiss.
- A 1.5.0 vault cannot be opened by 1.4.0. To go back, restore `pre-1.5.0-backup/`.


## Quick start (from source)

```powershell
npm install
npm run build
npm start          # http://127.0.0.1:3847
npm run electron   # desktop window
```

## MCP

- Endpoint: `http://127.0.0.1:<port>/mcp` with the header `Authorization: Bearer <access token>`. *AI assistants › Setup* shows the exact snippet for each client, using the port the app actually listens on.
- Claude Desktop uses the bundled stdio bridge, `bin/vaultai-mcp-stdio.js`.
- `generate_password` is always available and never touches the vault.

## Security

- AES-256-GCM vault, master-password change, encrypted backup, idle auto-lock, clipboard auto-clear.
- Loopback-only bind, Origin and Host guard (DNS rebinding), rate limit.
- Secrets are never returned by the API and are scrubbed from errors, activity and test output.
- Generic HTTP is locked to the base URL. Reading passwords needs **Full**, and every reveal is logged.

## Environment variables

| Variable | Meaning |
|---|---|
| `VAULTAI_DATA` / `VAULTAI_PORT` | Data folder and port. Use these for an isolated test instance. |
| `VAULTAI_DEV=1` | Developer mode: adds the Demo connector (echo/ping) |
| `VAULTAI_ALLOW_NON_LOOPBACK=1` | Allow binding to a non-loopback `VAULTAI_HOST`. Not recommended. |
| `VAULTAI_API_BASE_<GITHUB/NOTION/STRIPE/LINEAR/SENTRY/SLACK>` | Self-hosted or test API base |

## Testing

- `npm run test:unit`: generator, strength, migration, URL lock and i18n tables.
- `npm run test:e2e`: all areas below. Writes `e2e/RESULTS.md` and screenshots to `e2e/screenshots/`.
  - Unit tests.
  - Playwright UI (zh/en): new IA, guide, dashboard, kill switch, settings groups, terminology.
  - Forms.
  - **Migration of real 1.3.1 and 1.4.0 vaults.**
  - MCP (HTTP and stdio), CLI, security, Electron smoke.

## License

MIT



## Human autofill (1.6.x)

While typing in any app account field, press `Ctrl+Shift+P` (or type trigger `pp`) to open a small IME-style box right at the text caret that matches vault entries by username/site and fills them. Keep typing to filter; ↑↓, Enter/Tab, 1–6, Esc. The box never takes focus (1.6.x). See `docs/AUTOFILL.md`. Independent of AI/MCP password permissions (Off/Read/Full).

## Test status (1.9.0)

Automated E2E on Linux: **199 passed / 0 failed** (Unit 22, Unit-Autofill 10, Unit-MiniPicker 15, Unit-Import 15, Unit-DbStorage 6, Unit-Totp 8, UI 12, UI-Forms 13, Autofill 18, Migration 20, UI-Migration 3, MCP 30, CLI 14, Security 8, Electron 5). Windows isolated Portable smoke for 1.9.0: **pending** until delivery PC `SD-20250722DZPD` (`cb7fd33a-…`) is online (Grok Bot desktop app). See `E2E测试报告.md` / `e2e/RESULTS.md`.
