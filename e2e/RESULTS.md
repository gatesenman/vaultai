# VaultAI Tools v1.9.0 — E2E 测试报告 / E2E Results

运行时间 Run: 2026/11/2 02:17:34 (Asia/Shanghai, UTC+8) · Node v22.23.4 · Linux box (headless Chromium + xvfb)

| 区域 Area | 通过 Pass | 失败 Fail | 跳过 Skip |
|---|---|---|---|
| Unit | 22 | 0 | 0 |
| Unit-Autofill | 10 | 0 | 0 |
| Unit-MiniPicker | 15 | 0 | 0 |
| Unit-Import | 15 | 0 | 0 |
| Unit-DbStorage | 6 | 0 | 0 |
| Unit-Totp | 8 | 0 | 0 |
| UI | 12 | 0 | 0 |
| UI-Forms | 13 | 0 | 0 |
| Autofill | 18 | 0 | 0 |
| Migration | 20 | 0 | 0 |
| UI-Migration | 3 | 0 | 0 |
| MCP | 30 | 0 | 0 |
| CLI | 14 | 0 | 0 |
| Security | 8 | 0 | 0 |
| Electron | 5 | 0 | 0 |
| **合计 Total** | **199** | **0** | 0 |

## Unit

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | randomInt: always in range, all values reachable (n=7, 70k draws) | ✅ PASS | 130ms |
| 2 | modulo-bias sanity: chi-square over 94-char pool (200k chars) below p=0.001 critical value | ✅ PASS | 334ms |
| 3 | length: exact for 8, 20, 64, 128; clamped below 8 / above 128 | ✅ PASS | 42ms |
| 4 | class guarantees: every selected class appears (2000 × length 8, all four classes) | ✅ PASS | 60ms |
| 5 | class toggles: only selected classes used | ✅ PASS | 38ms |
| 6 | exclusions: ambiguous (Il1O0o/) and custom characters never appear | ✅ PASS | 107ms |
| 7 | minimum digits / symbols honoured | ✅ PASS | 29ms |
| 8 | avoidRepeats: no identical neighbours (1000 × 40, small pool) | ✅ PASS | 7761ms |
| 9 | error codes: NO_CLASSES, EMPTY_CLASS, TOO_SHORT | ✅ PASS | 1ms |
| 10 | entropy: reported bits = length × log2(pool) (±0.5) | ✅ PASS | 0ms |
| 11 | passphrase: word count, separator, capitalisation, number, EFF words only | ✅ PASS | 36ms |
| 12 | PIN: digits only, length 4–12, avoidRepeats | ✅ PASS | 23ms |
| 13 | normalizePrefs keeps password length, PIN length and mode independent | ✅ PASS | 0ms |
| 14 | strength estimator: common/patterns weak, generated strong, master policy | ✅ PASS | 2ms |
| 15 | migrate 1.3-shaped vault: secrets kept in place, kinds converted, nothing escalated, notes for every change | ✅ PASS | 1ms |
| 16 | migrate schema 2 → 5 adds autofill + DB storage + save-login defaults without rewriting passwords | ✅ PASS | 0ms |
| 17 | migrate is idempotent: second run changes nothing and adds no notes | ✅ PASS | 0ms |
| 18 | migrate in developer mode keeps the Demo connector | ✅ PASS | 0ms |
| 19 | generic URL lock: paths stay under the base URL; other hosts, traversal and bad bases refused | ✅ PASS | 1ms |
| 20 | generic levels: GET = Read, writes = Write, Linear GraphQL query = Read but mutation = Write | ✅ PASS | 0ms |
| 21 | i18n: every referenced key exists in en + zh, tables have identical keys, no unused keys | ✅ PASS | 40ms |
| 22 | migrate schema 4 → 5 adds saveLoginHotkey + connectionState | ✅ PASS | 0ms |

## Unit-Autofill

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | autofill defaults + normalizeQuery | ✅ PASS | 0ms |
| 2 | trigger boundary: start / space / letter | ✅ PASS | 1ms |
| 3 | exact username wins over favorite-only | ✅ PASS | 0ms |
| 4 | username prefix ranks alice* above unrelated favorite | ✅ PASS | 6ms |
| 5 | host from URL matches github entries first | ✅ PASS | 0ms |
| 6 | host extracted from window title | ✅ PASS | 0ms |
| 7 | favorite boost with empty query | ✅ PASS | 0ms |
| 8 | no false match on random typed string | ✅ PASS | 0ms |
| 9 | tag match | ✅ PASS | 0ms |
| 10 | subdomain related host | ✅ PASS | 0ms |

## Unit-MiniPicker

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | size: width 260–320, rows 28–32, max 6 rows | ✅ PASS | 0ms |
| 2 | below caret line by default | ✅ PASS | 0ms |
| 3 | flips above near work-area bottom (taskbar) | ✅ PASS | 0ms |
| 4 | clamps to right edge of work area | ✅ PASS | 0ms |
| 5 | clamps on secondary monitor (not primary edge) | ✅ PASS | 0ms |
| 6 | negative-coordinate monitor + top taskbar clamp | ✅ PASS | 0ms |
| 7 | tiny work area: neither above nor below fits → pinned inside | ✅ PASS | 0ms |
| 8 | DPI: physical px → DIP per monitor (100% and 150%) | ✅ PASS | 0ms |
| 9 | anchor fallbacks: caret → element → mouse | ✅ PASS | 0ms |
| 10 | keyboard: ↑↓ wrap, Enter/Tab fill, Esc dismiss | ✅ PASS | 0ms |
| 11 | number keys 1–6 quick-pick; out of range ignored; 7 ignored | ✅ PASS | 0ms |
| 12 | single match does not auto-fill; no match → open-app | ✅ PASS | 0ms |
| 13 | outside-click detection | ✅ PASS | 1ms |
| 14 | window flags: non-activating, on top, no taskbar, no chrome | ✅ PASS | 0ms |
| 15 | letter avatar stable | ✅ PASS | 0ms |

## Unit-Import

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | rejects encrypted .pswe by extension (no rows) | ✅ PASS | 0ms |
| 2 | Password Depot CSV (; + header): maps Description→title, Comments→notes, Tags+Category | ✅ PASS | 1ms |
| 3 | generic comma CSV (name/folder headers) | ✅ PASS | 0ms |
| 4 | Password Depot XML ITEM blocks | ✅ PASS | 2ms |
| 5 | delimiter auto-detect prefers ; when denser | ✅ PASS | 0ms |
| 6 | importMatchKey normalizes host + username | ✅ PASS | 0ms |
| 7 | CSV without header assumes PD default columns when ; | ✅ PASS | 0ms |
| 8 | Chrome CSV auto-detect | ✅ PASS | 0ms |
| 9 | Edge CSV via filename | ✅ PASS | 0ms |
| 10 | Firefox CSV (httpRealm / formActionOrigin) | ✅ PASS | 0ms |
| 11 | Bitwarden CSV + TOTP + skip note type | ✅ PASS | 0ms |
| 12 | 1Password CSV + OTPAuth | ✅ PASS | 0ms |
| 13 | KeePass CSV + TOTP column | ✅ PASS | 0ms |
| 14 | KeePass XML Entry/String | ✅ PASS | 1ms |
| 15 | formatLabel covers new dialects | ✅ PASS | 0ms |

## Unit-DbStorage

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | sqlite: ensureSchema creates vaultai_passwords | ✅ PASS | 31ms |
| 2 | encrypted upsert + list + decode round-trip | ✅ PASS | 4ms |
| 3 | removePasswordFromDb deletes row | ✅ PASS | 2ms |
| 4 | plaintext mode writes pt columns when requested | ✅ PASS | 3ms |
| 5 | testDbConnection succeeds for sqlite path | ✅ PASS | 1ms |
| 6 | publicDbStorage redacts secrets | ✅ PASS | 0ms |

## Unit-Totp

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | RFC 6238 SHA1 8-digit vectors | ✅ PASS | 0ms |
| 2 | 6-digit default + remaining countdown | ✅ PASS | 0ms |
| 3 | parse otpauth:// URI extracts secret + params | ✅ PASS | 0ms |
| 4 | bare Base32 secret + spaces normalize | ✅ PASS | 0ms |
| 5 | canonicalizeTotpSecret strips otpauth to Base32 | ✅ PASS | 0ms |
| 6 | verifyTotp accepts current window | ✅ PASS | 0ms |
| 7 | buildOtpAuthUri round-trips | ✅ PASS | 1ms |
| 8 | rejects empty / invalid Base32 | ✅ PASS | 0ms |

## UI

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | lock screen: create vault (default zh-CN, language switch on the lock screen) → home with 6-item sidebar | ✅ PASS | 3545ms |
| 2 | lock, wrong password rejected, unlock with Enter | ✅ PASS | 851ms |
| 3 | onboarding: save a credential → connect an AI app (setup snippet, one-time token) → verify via a real MCP request | ✅ PASS | 3056ms |
| 4 | passwords: search, reveal/hide, copy, edit, favourites, inline generator with “More options”, delete inside the editor | ✅ PASS | 2278ms |
| 5 | connections: empty state → GitHub tile; Generic HTTP needs a base URL; unconnected Google is not listed | ✅ PASS | 1001ms |
| 6 | AI assistants: renew, new token (old token refused), access matrix with localized levels applied immediately | ✅ PASS | 4192ms |
| 7 | home dashboard + kill switch: what AI can access now, today, health; revoke all → refused → turn back on | ✅ PASS | 853ms |
| 8 | activity: search + outcome filter (no refresh button); daily limits suggestions follow connections | ✅ PASS | 1174ms |
| 9 | settings groups: General · Security · Advanced; idle lock, master change, backup export/import with one confirmation | ✅ PASS | 4193ms |
| 10 | terminology: no retired terms anywhere in the en UI; switch to 中文 applies immediately + persists; zh screenshots; no retired zh terms | ✅ PASS | 6992ms |
| 11 | 1.7.0 quick create: Ctrl+N sheet, save, stay on list with flash; More opens full editor | ✅ PASS | 2399ms |
| 12 | 1.7.0 import: Password Depot CSV preview → skip duplicates → summary; reject .pswe | ✅ PASS | 1802ms |

## UI-Forms

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | master password (create): meter, crack time, checklist, caps lock, match, no-recovery ack, summary + focus (en + zh) | ✅ PASS | 1952ms |
| 2 | password form: required markers, inline errors, summary, focus first invalid, Esc/Enter, unsaved guard (zh + en) | ✅ PASS | 1835ms |
| 3 | password assistance: site name + icon, letter fallback, title autofill, suggestions, duplicate + reuse warnings, open URL | ✅ PASS | 4609ms |
| 4 | generator dialog: “More options” collapsed by default; modes, length, class guarantees, exclusions, minimums, repeats, errors, entropy | ✅ PASS | 8599ms |
| 5 | generator: copy + clipboard, history (10, in memory, clearable), preferences remembered across reload | ✅ PASS | 2203ms |
| 6 | connections: tiles open a dialog; helper text + vendor links, prefix validation, risk warnings, Test connection (mock) ok/fail, presets, secret never shown | ✅ PASS | 2720ms |
| 7 | edit connection: rename, rotate secret, change base URL — access levels kept | ✅ PASS | 267ms |
| 8 | google (Beta) dialog: client-ID pattern, GOCSPX- prefix, redirect URI copy button | ✅ PASS | 461ms |
| 9 | clipboard auto-clear: Settings › Security (2s clears, 0 never), range validation; rate limit lives under Advanced | ✅ PASS | 7050ms |
| 10 | assistant dialog, limits and change-master forms validate inline; setup shows the real MCP port; server enforces master policy | ✅ PASS | 1564ms |
| 11 | unsaved-changes guard on navigation: cancel stays, discard leaves and resets | ✅ PASS | 494ms |
| 12 | security check (Passwords › Security check): weak, reused, old >180 days, one-click fix, no secrets in response | ✅ PASS | 901ms |
| 13 | no text overflow in en; then zh-CN pass with Chinese messages + screenshots; no overflow in zh | ✅ PASS | 10154ms |

## Autofill

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | locked vault refuses autofill search/prepare | ✅ PASS | 16ms |
| 2 | create vault + password entries; settings expose autofill defaults | ✅ PASS | 117ms |
| 3 | search ranks username prefix + host + favorite | ✅ PASS | 4ms |
| 4 | prepare returns secret once; activity logs title only | ✅ PASS | 6ms |
| 5 | settings: disable autofill → search 403; re-enable; change trigger | ✅ PASS | 6ms |
| 6 | lock vault → status enabled false; unlock restores | ✅ PASS | 60ms |
| 7 | pure match engine: ranking + trigger boundary (dist) | ✅ PASS | 1ms |
| 8 | mini picker UI: mini zh screenshot next to caret | ✅ PASS | 0ms |
| 9 | mini picker UI: mini en screenshot next to caret | ✅ PASS | 0ms |
| 10 | mini picker UI: typing stays in target field and filters live | ✅ PASS | 0ms |
| 11 | mini picker UI: ↑↓ navigation + Enter fills highlighted | ✅ PASS | 0ms |
| 12 | mini picker UI: number key quick-pick + Tab fill | ✅ PASS | 0ms |
| 13 | mini picker UI: Esc dismisses; outside click dismisses; inside click picks | ✅ PASS | 0ms |
| 14 | mini picker UI: single match shows one row, no auto-fill | ✅ PASS | 0ms |
| 15 | mini picker UI: no match: save-login + open VaultAI rows | ✅ PASS | 0ms |
| 16 | mini picker UI: flips above caret near screen bottom | ✅ PASS | 0ms |
| 17 | mini picker UI: scrolls after 6 rows | ✅ PASS | 0ms |
| 18 | mini picker spec run + screenshots autofill-mini-{zh,en}.png | ✅ PASS | 0ms |

## Migration

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | 1.3.1: wrong master refused, nothing written (no backup yet) | ✅ PASS | 46ms |
| 2 | 1.3.1: unlock migrates; pre-1.5.0-backup is byte-identical to the 1.3.1 files | ✅ PASS | 63ms |
| 3 | 1.3.1: Linear/Sentry/Slack converted in place to Generic HTTP presets (same id, base URL set); legacy generic flagged | ✅ PASS | 0ms |
| 4 | 1.3.1: no secret lost — each stored credential reaches the upstream byte-for-byte | ✅ PASS | 33ms |
| 5 | 1.3.1: Linear GraphQL mutation needs Write (Cursor has Read) — refused | ✅ PASS | 4ms |
| 6 | 1.3.1: assistants — ChatGPT → Other client, Gmail Draft → Read (never escalated), Manage → Write; tokens still valid | ✅ PASS | 5ms |
| 7 | 1.3.1: passwords intact (values decrypt), folders folded into tags, limits for removed tools dropped with a note | ✅ PASS | 6ms |
| 8 | 1.3.1: migration notices on the home overview (backup, conversions, needs-base, removed, ChatGPT, Gmail Draft, limits) | ✅ PASS | 3ms |
| 9 | 1.3.1: idempotent — lock + unlock again adds no notices, keeps the oldest backup | ✅ PASS | 66ms |
| 10 | 1.3.1: dismissing a notice persists | ✅ PASS | 19ms |
| 11 | 1.4.0: wrong master refused, nothing written (no backup yet) | ✅ PASS | 44ms |
| 12 | 1.4.0: unlock migrates; pre-1.5.0-backup is byte-identical to the 1.4.0 files | ✅ PASS | 70ms |
| 13 | 1.4.0: Linear/Sentry/Slack converted in place to Generic HTTP presets (same id, base URL set); legacy generic flagged | ✅ PASS | 1ms |
| 14 | 1.4.0: no secret lost — each stored credential reaches the upstream byte-for-byte | ✅ PASS | 32ms |
| 15 | 1.4.0: Linear GraphQL mutation needs Write (Cursor has Read) — refused | ✅ PASS | 3ms |
| 16 | 1.4.0: assistants — ChatGPT → Other client, Gmail Draft → Read (never escalated), Manage → Write; tokens still valid | ✅ PASS | 5ms |
| 17 | 1.4.0: passwords intact (values decrypt), folders folded into tags, limits for removed tools dropped with a note | ✅ PASS | 6ms |
| 18 | 1.4.0: migration notices on the home overview (backup, conversions, needs-base, removed, ChatGPT, Gmail Draft, limits) | ✅ PASS | 4ms |
| 19 | 1.4.0: idempotent — lock + unlock again adds no notices, keeps the oldest backup | ✅ PASS | 60ms |
| 20 | 1.4.0: dismissing a notice persists | ✅ PASS | 10ms |

## UI-Migration

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | home shows what changed in 1.6.0 (zh): backup, conversions, removed items, ChatGPT, Gmail Draft, limits | ✅ PASS | 846ms |
| 2 | connections after migration: presets labelled, legacy generic flagged → fixed by adding a base URL | ✅ PASS | 715ms |
| 3 | English notices + a dismissed notice stays dismissed after reload | ✅ PASS | 716ms |

## MCP

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | setup: create vault, generic app (fake upstream), GitHub PAT, password entry, assistant | ✅ PASS | 91ms |
| 2 | initialize returns protocol + serverInfo v1.9.0; supported protocolVersion echoed, unknown → 2024-11-05 | ✅ PASS | 6ms |
| 3 | ping | ✅ PASS | 2ms |
| 4 | tools/list with every permission Off shows only generate_password (no vault access) | ✅ PASS | 3ms |
| 5 | generate_password (no permission): default 20 chars with every class; passphrase; PIN | ✅ PASS | 10ms |
| 6 | generate_password: bad options → structured refusal; activity logs mode but never the value | ✅ PASS | 5ms |
| 7 | unknown method → -32601 | ✅ PASS | 1ms |
| 8 | no token → 401 / -32001 | ✅ PASS | 2ms |
| 9 | bogus token → 401 | ✅ PASS | 1ms |
| 10 | token via X-VaultAI-Token header accepted; ?token= in the URL and token in the body are refused (401) | ✅ PASS | 5ms |
| 11 | notifications get 202 with no body; GET /mcp (SSE) → 405 | ✅ PASS | 2ms |
| 12 | first authenticated request records lastSeenAt (used by “Verify connection”) | ✅ PASS | 2ms |
| 13 | setup endpoint: per-client snippets with Authorization header, never ?token= | ✅ PASS | 1ms |
| 14 | demo: Read → demo_echo works; tools/list shows demo tools | ✅ PASS | 5ms |
| 15 | refusal is structured JSON {ok:false,code,message,fix} (tool on Off app) | ✅ PASS | 2ms |
| 16 | generic Read: GET path under the base URL reaches upstream with Bearer key injected; POST refused (needs write) | ✅ PASS | 17ms |
| 17 | generic URL lock: absolute URLs to other hosts and paths escaping the base path → URL_NOT_ALLOWED, nothing sent | ✅ PASS | 15ms |
| 18 | generic connection without a base URL is refused (NO_BASE_URL) | ✅ PASS | 1ms |
| 19 | passwords Off: no passwords_* tools; call refused | ✅ PASS | 3ms |
| 20 | passwords Read: list/get metadata only, never the value; get_password refused | ✅ PASS | 9ms |
| 21 | passwords Full: get_password returns value and the reveal is logged | ✅ PASS | 6ms |
| 22 | daily limit: demo:echo limit 2 → 3rd call DAILY_LIMIT | ✅ PASS | 13ms |
| 23 | kill switch: disabled assistant refused on tools/list (-32003) and tools/call | ✅ PASS | 9ms |
| 24 | expiry: assistant with past expiresAt refused (ASSISTANT_EXPIRED) | ✅ PASS | 7ms |
| 25 | rotate token: old token 401, new token works | ✅ PASS | 4ms |
| 26 | removed REST mirror: /mcp/tools and /mcp/call are gone (404) | ✅ PASS | 4ms |
| 27 | kill switch API: revoke-all turns every assistant off (permissions kept), logged; re-enable restores | ✅ PASS | 8ms |
| 28 | stdio bridge: initialize, notification (no reply), tools/list, tools/call demo_echo + generate_password over stdin/stdout | ✅ PASS | 105ms |
| 29 | stdio bridge with the daemon down: error reply carries the original id; notifications still get no reply | ✅ PASS | 44ms |
| 30 | without VAULTAI_DEV: no Demo connector, no demo_* tools, no demo limit suggestions | ✅ PASS | 252ms |

## CLI

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | vaultai gen works offline (no daemon): default 20 chars, every class | ✅ PASS | 37ms |
| 2 | vaultai gen --length/--no-symbols/--exclude-ambiguous/--min-digits/--count -f json | ✅ PASS | 38ms |
| 3 | vaultai gen passphrase --words 5 --sep . / gen pin --length 6 | ✅ PASS | 71ms |
| 4 | vaultai gen with no classes → exit 1 + JSON NO_CLASSES | ✅ PASS | 35ms |
| 5 | vaultai status | ✅ PASS | 59ms |
| 6 | vaultai doctor exits 0 when healthy | ✅ PASS | 61ms |
| 7 | vaultai tool ls lists allowed tools | ✅ PASS | 56ms |
| 8 | vaultai tool help passwords / gmail | ✅ PASS | 54ms |
| 9 | vaultai tool demo … is not a CLI group any more (developer-only connector) → usage, exit 1 | ✅ PASS | 53ms |
| 10 | vaultai tool generic <appId> --path /cli → upstream | ✅ PASS | 61ms |
| 11 | vaultai tool passwords list (Full) | ✅ PASS | 54ms |
| 12 | refusal: tool github create_issue → exit 1, PERMISSION_DENIED JSON | ✅ PASS | 54ms |
| 13 | rotated (old) token rejected by CLI | ✅ PASS | 55ms |
| 14 | vaultai activity ls --ok false / --app / --ai filters | ✅ PASS | 164ms |

## Security

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | cross-site Origin rejected (403 BAD_ORIGIN) — no CORS read of secrets | ✅ PASS | 1ms |
| 2 | Origin: null rejected; same-origin allowed | ✅ PASS | 1ms |
| 3 | DNS-rebinding Host header rejected (403 BAD_HOST) | ✅ PASS | 3ms |
| 4 | Google OAuth callback escapes the error parameter (no reflected XSS on the local origin) | ✅ PASS | 1ms |
| 5 | application secrets never returned by /api/applications | ✅ PASS | 2ms |
| 6 | locked vault: MCP refuses VAULT_LOCKED; import refused 423; wrong password rejected | ✅ PASS | 102ms |
| 7 | VAULTAI_HOST=0.0.0.0 without opt-in → refused, falls back to 127.0.0.1 | ✅ PASS | 166ms |
| 8 | no plaintext secrets in 31 data/log files (ui.master, ui.master2, ui.pat, ui.apiKey, ui.entry, mcp.master, mcp.pat, mcp.apiKey, mcp.entry, forms.master, forms.reused, forms.ghGood, forms.stripeLive, vault-v131.master, vault-v131.github, vault-v131.linear, vault-v131.sentry, vault-v131.slack, vault-v131.generic, vault-v131.site, vault-v140.master, vault-v140.github, vault-v140.linear, vault-v140.sentry, vault-v140.slack, vault-v140.generic, vault-v140.site) | ✅ PASS | 1ms |

## Electron

| # | 用例 Case | 结果 | 耗时 |
|---|---|---|---|
| 1 | app starts under xvfb; embedded server healthy on VAULTAI_PORT with isolated VAULTAI_DATA | ✅ PASS | 947ms |
| 2 | BrowserWindow loaded the UI (CDP target at http://127.0.0.1:3850/), preload ran without errors | ✅ PASS | 304ms |
| 3 | single-instance lock: 2nd launch exits quickly, 1st keeps serving | ✅ PASS | 424ms |
| 4 | port already in use: clear error + exit 1 (no silent hang) | ✅ PASS | 343ms |
| 5 | mini picker window: focusable=false, alwaysOnTop, showInactive keeps target focus | ✅ PASS | 1381ms |

## 1.5.0 改了什么、删了什么、为什么 / What changed, what was removed, and why

依据 `docs/PRODUCT-REVIEW.md`（权威评审）。Per `docs/PRODUCT-REVIEW.md` (the authoritative review).

| 决定 Decision | 项目 Item | 理由 Why |
|---|---|---|
| 新增 Added | 首页（4 步引导、AI 当前访问、今日、安全评分、升级说明）/ Home | 1.4.0 创建保险库后不知道下一步；看不到 AI 能访问什么（P2、P3） |
| 新增 Added | 停用所有 AI / Revoke all AI access（标题栏 + 首页 + `POST /api/assistants/revoke-all`） | 出事时只能逐个关闭（P4） |
| 新增 Added | 按客户端生成配置 + 验证连接、最近连接、续期、编辑连接（轮换密钥保留权限）、空状态 | 「续期」此前没有入口；配置要手写（P10） |
| 合并 Merged | 10 个侧边栏项 → 6 个：首页·密码·连接·AI 助手·活动·设置 | 同一件事分散在 3–4 个页面（P1） |
| 合并 Merged | Linear / Sentry / Slack → 通用 HTTP 预设（原地转换，ID/密钥/权限不变） | 专用代码只有 3 个固定操作 |
| 合并 Merged | 文件夹 → 标签；权限统一为 关闭/只读/写入/完全（草稿→只读，管理→写入） | 重叠概念；用户无法形成稳定心智（P5） |
| 渐进披露 Advanced | 生成器「更多选项」；设置分 常规/安全/高级 | 降低认知负担 |
| 移除 Removed | 网页抓取、Demo（仅开发模式）、ChatGPT 客户端、「允许非本机访问」开关、`?token=`/请求体令牌、REST `/mcp/tools`/`/mcp/call`、虚构模板、`/api/connect`、`/api/server/ping-restart`、`/api/passwords/generate`、`/api/passwords-export`、CLI `tool linear/sentry/slack/web/demo`、`--template`、英文短语替换层、「灵感来自 GBrain」 | SSRF 风险 / 误导 / 从未生效（P6）/ 令牌泄漏 / 重复 / 死代码（P7、P11、P15、P16） |
| 修复 Fixed | 通用 HTTP 锁定 Base URL（P8）；OAuth 回调 XSS（P9）；MCP 202/405/版本回显、stdio 通知（P13）；托盘图标与双语菜单（P12）；权限无 toast、导入只确认一次（P14） | 安全漏洞与协议合规 |

### 与评审文档的有意偏差 / Deliberate deviations from PRODUCT-REVIEW

1. 访问矩阵保持「AI 助手 × 连接」表格并允许横向滚动，没有改成每个 AI 一张卡片。理由：连接数量少时一眼就能比较；矩阵行可从首页/配置弹窗直接定位并高亮。The matrix stays an assistants × connections table with horizontal scroll, rather than per-assistant cards.
2. 引导第 4 步「验证连接」打开最近创建的 AI 助手的配置弹窗并开始等待，而不是在首页内联等待。Step 4 opens the setup dialog of the most recently added assistant.
3. 配置弹窗除 Claude Desktop / Cursor / Claude Code / 命令行 外，额外提供「其他（HTTP）」页签，给「其他」客户端（包括由 ChatGPT 迁移来的）使用。An extra "Other (HTTP)" tab is shown for custom clients.

## 发现并修复的问题 / Bugs found and fixed (1.4.0 → 1.5.0)

| # | 级别 | 问题 / Issue | 修复 / Fix |
|---|---|---|---|
| 1 | 🔴 Critical | 通用 HTTP 工具接受任意完整 `url`，密钥可被带到任意主机（P8） / Generic HTTP sent the key to any host | Base URL 必填，请求被限制在其路径之下；`URL_NOT_ALLOWED` 且不发出请求；单元 + E2E 覆盖路径穿越与跨主机 |
| 2 | 🔴 Critical | Google OAuth 回调页原样输出 `error`（P9） / Reflected XSS in OAuth callback | 全部转义；E2E 用 `<script>` 载荷回归 |
| 3 | 🟠 High | 服务端仍接受 `?token=` 以及 JSON 请求体中的令牌 / Token accepted in query and body | 只接受 `Authorization: Bearer` / `X-VaultAI-Token` 请求头；E2E 断言 401 |
| 4 | 🟠 High | 「允许非本机访问」开关从未生效（P6） / Non-loopback switch was a no-op | 删除开关与设置项（迁移时清理），仅保留环境变量 |
| 5 | 🟡 Medium | `VAULTAI_API_BASE_*` 只对「测试连接」生效，GitHub/Notion/Stripe 的真实工具调用仍连官方地址（自建 GitHub Enterprise 无法使用） / Base override ignored by tool calls | 统一 `vendorBase()`，测试连接与工具调用共用 |
| 6 | 🟡 Medium | 新建条目弹窗 40ms 后强制把焦点移回网址框，快速输入时文字会落进网址框 / Item dialog stole focus | 只在用户尚未聚焦其他输入框时设置焦点（E2E 中复现为偶发失败） |
| 7 | 🟡 Medium | 迁移后没有 Base URL 的旧通用连接显示「已连接」，实际每次调用都会被拒绝 / Legacy generic without base showed "Connected" | 显示「缺少基础地址 — 请编辑」，编辑补充后恢复 |
| 8 | 🟢 Low | 首页访问卡片缺少有效期 / Home access card lacked expiry | 显示有效期与最近连接 |
| 9 | 🟢 Low | 通用 HTTP 预设中的「自定义」按钮显示为「其他」（误用了客户端标签） / "Custom" preset labelled "Other" | 独立文案 `c_presetCustom` |
| 10 | 🟢 Low | 生成历史的说明文字与标题同为粗体 / History hint rendered bold | 样式修正 |

测试本身的调整：生成器「更多选项」展开改为点击后断言 `open`（避免点击与渲染竞态）；`scripts/test-flow.ts` 依赖已删除的接口（`/api/passwords/generate`、请求体令牌、`draft` 等级、Linear/Demo），与 E2E 重复，已删除。

## 截图 / Screenshots (`e2e/screenshots/`)

- 引导 Onboarding：`77-onboarding-zh/en`
- 首页 Dashboard：`78-dashboard-zh/en`
- 新侧边栏 Sidebar：`79-sidebar-zh/en`
- 设置分组 Settings groups：`80-settings-general-zh/en`、`80-settings-security-zh/en`、`80-settings-advanced-zh/en`
- 配置弹窗 Setup：`81-setup-zh/en`
- 生成器 之前 / 之后 Generator before/after：之前 `before-1.4.0/72-gen-password-zh/en`、`before-1.4.0/73-gen-passphrase-zh/en`；之后（默认折叠）`82-gen-collapsed-zh/en`，（展开）`72-gen-password-zh/en`、`73-gen-passphrase-zh/en`
- 迁移说明 Migration notices：`84-migration-notices-zh/en`、`85-migration-connections-zh`
- 其他：`01-lock-create-zh`、`02-lock-unlock-zh`、`20-passwords-en`、`21-passwords-zh`、`30-connections-en`、`31-connections-zh`、`40-assistants-en`、`41-assistants-zh`、`50-activity-en`、`51-activity-zh`、`70-pwform-errors-zh/en`、`74-master-meter-zh/en`、`75-connector-test-zh/en`、`76-health-zh/en`

## 未覆盖 / Not tested

- 真实厂商 API（GitHub/Notion/Stripe 以及 Linear/Sentry/Slack 预设）：只对本地模拟上游验证。迁移测试通过哈希证明每个迁移后的密钥原样到达上游；真实令牌未使用。
- Google OAuth 实际授权（需要真实 Google 账号）；Gmail/日历工具仅验证权限与列表，未真实调用。
- 真实 AI 客户端（Claude Desktop / Cursor / Claude Code）读取生成的配置：用同一协议的 HTTP 与 stdio 请求模拟「验证连接」，未启动这些应用。
- Windows 真机上没有操作图形界面（不干扰用户桌面，也不截取桌面），界面在 Linux Chromium + Electron 中验证；托盘提示仅在 Electron 冒烟测试中启动验证，未在 Windows 托盘区目视确认。
- 在已安装 1.4.0 的 Windows 上直接覆盖安装 1.5.0（NSIS 原地升级）未实测：该 PC 测试前未安装 VaultAI。数据迁移本身已在 Windows 真机上用 1.4.0 和 1.3.1 保险库副本验证（见 Part B），与安装方式无关。An in-place NSIS upgrade over an installed 1.4.0 was not exercised; the vault migration itself was verified on the Windows PC using copies of 1.4.0 and 1.3.1 vaults.
- 屏幕阅读器未实测；大写锁定提示用合成键盘事件验证。

## 隔离与安全 / Isolation

所有测试使用 `mktemp` 临时数据目录（`VAULTAI_DATA`）和测试端口（3847、3848、3849、3850、3851、3853–3854、3872–3874 模拟上游、3899），结束后删除；迁移测试使用复制出来的夹具，不改动仓库中的夹具；未触碰任何真实保险库。最后对全部数据目录与日志做明文密钥扫描（包括夹具中的密钥）。

## 历史 / Earlier: bugs fixed in 1.3.1 → 1.4.0

| # | 严重度 | 问题 Bug | 修复 Fix |
|---|---|---|---|
| 18 | 🟠 High | 非默认端口运行时（如测试端口 3851），“连接”页 MCP 地址与 Google 重定向 URI 仍显示 3847（读取的是保存的默认端口），Google 设置步骤里也写死了 3847 / With a non-default port the Connect page MCP URL and Google redirect URI still said 3847 | 以实际监听地址为准：`getListenPort()` / `getClientHost()`；UI 用例“google client form”+“连接页 MCP 地址”回归 |
| 19 | 🟡 Med | MCP `tools/list` 丢弃所有工具的 `inputSchema`（客户端看不到参数）/ MCP tools/list dropped every tool's inputSchema | 透传工具 schema；`generate_password` 带完整 schema，MCP 用例校验 |
| 20 | 🟡 Med | 生成器偏好以 PIN 模式保存时，密码长度被按 PIN 上限截断为 12 / Saving generator prefs in PIN mode clamped password length to 12 | 新增 `normalizePrefs`，密码长度、PIN 长度、模式分别保存；单元 + UI 用例覆盖 |
| 21 | 🟡 Med | 口令短语用 `-` 分隔时可能包含 EFF 带连字符的词（drop-down、felt-tip、t-shirt、yo-yo），词数有歧义 / Hyphenated EFF words made '-'-separated passphrases ambiguous | 生成仅用纯字母的 7,772 个词（熵按实际词数计算）；单元用例 2000 次验证 |
| 22 | 🟢 Low | 密码列表回车搜索与输入防抖同时触发两次加载，已显示的密码被重新渲染（显示/隐藏状态错乱）/ Double list load (Enter + debounce) flipped revealed rows | 加载序号丢弃过期结果；回车时取消防抖 |
| 23 | 🟢 Low | 新建条目对话框需等待异步请求才打开，期间按 Esc / 输入会丢失 / New-item dialog opened only after an async fetch | 立即打开，建议列表后台填充 |
| 24 | 🟢 Low | 更换网址时字母头像沿用上一个站点自动填入的标题首字母 / Letter avatar used the previous site's auto title | 自动标题状态下按新主机名生成头像 |
| 25 | 🟢 Low | CLI `gen` 出错时 JSON 输出到 stderr，与其它拒绝（stdout）不一致 / CLI gen error JSON went to stderr | 统一输出到 stdout，退出码 1（不强制 exit，管道输出不截断）|
| 26 | 🟢 Low | 切换语言后标题栏状态“已解锁/Unlocked”不更新 / Status pill kept the old language | `applyI18n` 刷新状态 |
| 27 | 🟢 Low | 主密码“建议口令”仅 5 词（约 65 位，“强”）/ Suggested master passphrase only 5 words | 改为 6 词（约 78 位 + 数字）|
| 28 | 🟢 Low | 强度已“很强”时仍显示“包含常见单词”提示，干扰 / Pattern warnings shown even at “Very strong” | 仅在强度低于“强”时显示 |
| 29 | 🟢 Low | （开发中）`/api/passwords/health` 被 `/api/passwords/:id` 路由吞掉 / health route shadowed by :id | 改为 `/api/password-health` |
| 30 | 🟢 Low | （开发中）口令短语强度模型低估字典短语 / passphrase model missed dictionary phrases | EFF/常见词按 ~14 位/词计，取多模型最小值；`correct-horse-battery-staple` 不再被评为“很强” |

测试脚本自身问题（非产品缺陷）：提交按钮在表单无效时为 `aria-disabled`（仍可点击以显示错误汇总），Playwright 视为禁用 → 用例使用 `force` 点击或回车；“使用此密码”会显示明文，用例改为验证切换双向；旧 test-flow 主密码 `testpass1` 现被主密码策略拒绝（设计如此），改为强口令；Google Client ID 测试数据改为真实长度。

## 历史 / Earlier: bugs fixed in 1.3.0 → 1.3.1

| # | 严重度 | 问题 Bug | 修复 Fix |
|---|---|---|---|
| 1 | 🔴 Critical | 修改主密码后所有内层密文（应用密钥、密码条目、Token）用旧密钥重加密，改密后无法解密 / Master-password change re-encrypted inner blobs with the *old* key → all secrets unreadable afterwards | `db.changeMasterPassword` 先派生新密钥再重加密；test-flow + UI 用例 9 回归覆盖 |
| 2 | 🔴 Critical | `cors({origin:true})` 允许任意网站跨域读取本地 API（包括密码明文 reveal）/ Any website could read the local API incl. password reveal | 移除 CORS；新增 Origin 守卫（仅允许 `http://127.0.0.1:<port>` 等本机来源，`Origin: null` 拒绝） |
| 3 | 🟠 High | DNS rebinding：非本机 Host 头可访问 API / Non-loopback Host header accepted | Host 必须为 127.0.0.1 / localhost / [::1]，否则 403 `BAD_HOST` |
| 4 | 🟠 High | 保险库锁定时仍可导入备份覆盖 / Backup import allowed while vault locked (overwrite) | 锁定时返回 423 `VAULT_LOCKED` |
| 5 | 🟠 High | JSON-RPC `tools/list` 忽略禁用开关与过期 / tools/list ignored kill switch + expiry | 先校验助手状态，返回 403 / -32003 |
| 6 | 🟡 Med | Electron preload 为 ESM，Electron 33 加载失败 / ESM preload failed to load | 改为 `preload.cjs` |
| 7 | 🟡 Med | Electron 端口被占用时静默无窗口 / Port in use → app silently showed nothing | 中英文错误弹窗 + 退出码 1 |
| 8 | 🟡 Med | Electron 数据目录不可覆盖，无法隔离测试 / Data dir not overridable | 支持 `VAULTAI_DATA` |
| 9 | 🟡 Med | CLI 无法调用 passwords 工具 / CLI `tool passwords …` unsupported | 加入 passwords 分组 |
| 10 | 🟡 Med | 120/分钟 限流作用于本地 UI，正常操作可能被限 / AI rate limit also throttled the local UI | MCP/工具调用用配置值；UI 控制面 ≥1200/分钟 |
| 11 | 🟡 Med | 中文模式下大部分界面仍为英文 / zh-CN mode left most chrome in English | i18n 增加短语级翻译层 + 动态内容观察器，切回英文可还原 |
| 12 | 🟢 Low | 缺少 `/health`（返回了 HTML）/ `/health` returned SPA HTML | 增加 `/health` 别名 |
| 13 | 🟢 Low | MCP serverInfo 版本写死 1.0.0 / MCP reported version 1.0.0 | 使用 `APP_VERSION` |
| 14 | 🟢 Low | 密码列表无法单行显示/隐藏密码 / No per-row reveal/hide in list | 增加显示/隐藏按钮，20 秒自动隐藏 |
| 15 | 🟢 Low | “收藏”复选框被拉伸 / Favorite checkbox stretched | CSS 修复 |
| 16 | 🔴 Critical | **NSIS 安装包在 Windows 上全新安装即崩溃**（`VaultAI-Setup-1.3.0.exe /S` → 0xC0000005，System.dll+0x1581，什么都没装上）。根因：electron-builder 25 的 `multiUser.nsh` 读取 `SHGetKnownFolderPath` 结果时越界 / Fresh per-user NSIS install crashed (electron-builder 25 multiUser.nsh over-read) | 升级 electron-builder 25.1.8 → 26.17.0（改为有界 `lstrcpynW`）；1.3.1 安装包在真机静默安装通过 |
| 17 | 🟢 Low | 应用图标 `build/icon.ico` 仅含 16×16，electron-builder 26 拒绝打包 / icon.ico only 16×16 | 重新生成 16–256px 多尺寸 ICO |

测试脚本自身问题（非产品缺陷）：生成器/剪贴板竞态改用 `expect.poll`；截图等待 0.15s 淡入动画；`demo:echo` 限额 0 = 完全禁止（产品语义正确，测试改为恢复为 1000）。

## Part B — Windows 真机测试 / Windows PC (SD-20250722DZPD, 2026-10-19 16:06–16:20 Asia/Shanghai, UTC+8)

隔离方式：已安装版 `VAULTAI_DATA=%USERPROFILE%\GrokBot-Apps\VaultAI-test150\data-installed`、`VAULTAI_PORT=3898`、`--user-data-dir=…\ud-installed`；迁移测试用 1.4.0 / 1.3.1 测试保险库的**副本**（`data-mig140` 端口 3896、`data-mig131` 端口 3895）；便携版 `data-portable`、端口 3897。测试前已把现有 `%APPDATA%\VaultAI`（55 个文件）完整备份到 `%USERPROFILE%\GrokBot-Apps\VaultAI-backup\Roaming-VaultAI-150-20261019-160658`（含 SHA-256 清单），测试后逐文件比对 **55/55 完全一致**。测试前未安装 VaultAI（无卸载项、安装目录、快捷方式或进程），因此测试后静默卸载。用户真实保险库从未被打开或修改；全程未截取桌面截图。PC 上的 Node 为 v24.14.0（仅用于运行测试脚本；CLI / stdio 均用安装包自带的 Electron 运行时）。

| # | 用例 Case | 结果 |
|---|---|---|
| 1 | 4MB 分块传输 + merge.ps1 合并（整文件复制 88MB 安装包时链路中断，按要求改用 4MB 分块：Setup 21 块、Portable 20 块；win-x64.zip 整文件一次成功）；三个文件 SHA-256 与构建机完全一致 | ✅ PASS |
| 2 | `VaultAI-Setup-1.5.0.exe /S` 静默安装，退出码 0（29 秒） | ✅ PASS |
| 3 | `%LOCALAPPDATA%\Programs\VaultAI\VaultAI.exe` 和 `resources\app.asar` 存在 | ✅ PASS |
| 4 | 卸载注册表 HKCU：显示名 “VaultAI 1.5.0”、版本 1.5.0，带 QuietUninstallString | ✅ PASS |
| 5 | 开始菜单快捷方式 `VaultAI Tools.lnk` 指向 VaultAI.exe | ✅ PASS |
| 6 | 已安装应用在测试端口 3898 启动（1 秒内）；`/health` 200、v1.5.0、dataDir = 隔离测试目录 | ✅ PASS |
| 7 | 已安装版 · GET /health 200 + v1.5.0 | ✅ PASS |
| 8 | 已安装版 · GET /shared/generator.js 200 (packaged dist/shared) | ✅ PASS |
| 9 | 已安装版 · UI index served (lang zh-CN default, forms.css + app.js) | ✅ PASS |
| 10 | 已安装版 · API create vault (isolated dir) | ✅ PASS |
| 11 | 已安装版 · /api/status reports actual test port 3898, loopback host 127.0.0.1 | ✅ PASS |
| 12 | 已安装版 · home overview: onboarding vault=true, no migration notices on a fresh vault | ✅ PASS |
| 13 | 已安装版 · create assistant (token vai_) | ✅ PASS |
| 14 | 已安装版 · new assistant defaults to Off everywhere | ✅ PASS |
| 15 | 已安装版 · setup snippet: /mcp + Bearer header, never ?token= | ✅ PASS |
| 16 | 已安装版 · MCP initialize serverInfo 1.5.0, protocol 2025-06-18 echoed | ✅ PASS |
| 17 | 已安装版 · notification → 202 empty | ✅ PASS |
| 18 | 已安装版 · GET /mcp (SSE) → 405 | ✅ PASS |
| 19 | 已安装版 · MCP tools/list (all Off) = only generate_password; no demo tools in production | ✅ PASS |
| 20 | 已安装版 · MCP generate_password default: 20 chars, all classes (129.5 bits) | ✅ PASS |
| 21 | 已安装版 · MCP generate_password passphrase 6 words | ✅ PASS |
| 22 | 已安装版 · MCP generate_password PIN 8 | ✅ PASS |
| 23 | 已安装版 · MCP generate_password no classes → NO_CLASSES | ✅ PASS |
| 24 | 已安装版 · activity logs generator call but never the value | ✅ PASS |
| 25 | 已安装版 · vault tool refused while Off (structured PERMISSION_DENIED) | ✅ PASS |
| 26 | 已安装版 · MCP no token → 401 | ✅ PASS |
| 27 | 已安装版 · ?token= in URL refused → 401 | ✅ PASS |
| 28 | 已安装版 · cross-site Origin → 403 | ✅ PASS |
| 29 | 已安装版 · add generic HTTP connection with base URL | ✅ PASS |
| 30 | 已安装版 · generic without base URL refused (BAD_URL) | ✅ PASS |
| 31 | 已安装版 · generic: other host → URL_NOT_ALLOWED | ✅ PASS |
| 32 | 已安装版 · generic: path escaping base → URL_NOT_ALLOWED | ✅ PASS |
| 33 | 已安装版 · generic Read: POST → PERMISSION_DENIED | ✅ PASS |
| 34 | 已安装版 · kill switch: revoke-all → -32003 (403) | ✅ PASS |
| 35 | 已安装版 · re-enable restores access (permissions kept) | ✅ PASS |
| 36 | 已安装版 · stdio bridge (bundled runtime, app.asar\bin\vaultai-mcp-stdio.js): 3 replies (none for the notification), initialize v1.5.0, generate_password 24 | ✅ PASS |
| 37 | 已安装版 · CLI gen offline (bundled runtime): 20 chars | ✅ PASS |
| 38 | 已安装版 · CLI gen passphrase 5 words | ✅ PASS |
| 39 | 已安装版 · CLI gen pin 6 | ✅ PASS |
| 40 | 已安装版 · CLI gen --length 40 --no-symbols --exclude-ambiguous --count 3 -f json | ✅ PASS |
| 41 | 已安装版 · CLI gen no classes → exit 1 + JSON NO_CLASSES | ✅ PASS |
| 42 | 已安装版 · CLI status against test instance | ✅ PASS |
| 43 | 已安装版 · CLI tool ls (generate_password + generic tool) | ✅ PASS |
| 44 | 已安装版 · CLI denied call (Passwords Off) → exit 1 + PERMISSION_DENIED | ✅ PASS |
| 45 | 已安装版 · CLI has no demo tool in production → non-zero | ✅ PASS |
| 46 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· wrong master refused, no backup written (401) | ✅ PASS |
| 47 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· unlock with the old master password | ✅ PASS |
| 48 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· pre-1.5.0-backup byte-identical to the original files (vault.data.enc, vault.meta.json) | ✅ PASS |
| 49 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· every stored connection survived (GitHub, Linear/Sentry/Slack → 通用 HTTP 预设, generic, generic-no-base) | ✅ PASS |
| 50 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· saved passwords present (3) | ✅ PASS |
| 51 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· saved site password decrypts to the exact old value | ✅ PASS |
| 52 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· home notices: mig.backup, mig.converted×3, mig.noBase, mig.webRemoved, mig.demoRemoved, mig.chatgpt, mig.gmailDraft, mig.limits, mig.folders | ✅ PASS |
| 53 | 迁移 v1.4.0（真实 1.4.0 保险库副本，端口 3896，隔离目录）· old assistant token still works (MCP initialize 1.5.0) | ✅ PASS |
| 54 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· wrong master refused, no backup written (401) | ✅ PASS |
| 55 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· unlock with the old master password | ✅ PASS |
| 56 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· pre-1.5.0-backup byte-identical to the original files (vault.data.enc, vault.meta.json) | ✅ PASS |
| 57 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· every stored connection survived (GitHub, Linear/Sentry/Slack → 通用 HTTP 预设, generic, generic-no-base) | ✅ PASS |
| 58 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· saved passwords present (3) | ✅ PASS |
| 59 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· saved site password decrypts to the exact old value | ✅ PASS |
| 60 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· home notices: mig.backup, mig.converted×3, mig.noBase, mig.webRemoved, mig.demoRemoved, mig.chatgpt, mig.gmailDraft, mig.limits, mig.folders | ✅ PASS |
| 61 | 迁移 v1.3.1（真实 1.3.1 保险库副本，端口 3895，隔离目录）· old assistant token still works (MCP initialize 1.5.0) | ✅ PASS |
| 62 | 便携版 `VaultAI-Setup-1.5.0-Portable.exe` 启动（7 秒）；/health 200 v1.5.0；dataDir = 隔离目录 | ✅ PASS |
| 63 | 便携版：`/shared/generator.js` 200；UI `lang="zh-CN"` | ✅ PASS |
| 64 | 便携版：创建保险库；MCP initialize 1.5.0（Bearer 头） | ✅ PASS |
| 65 | 便携版：MCP `generate_password` 口令短语 5 词，约 70.3 bits | ✅ PASS |
| 66 | 便携版：`/mcp?token=…` 被拒绝 401 | ✅ PASS |
| 67 | 所有测试实例关闭后无残留 VaultAI 进程，端口 3895–3898 均已释放 | ✅ PASS |
| 68 | 静默卸载 `Uninstall VaultAI.exe /currentuser /S`：退出码 0，安装目录、注册表、开始菜单快捷方式均已移除（测试前未安装，故卸载） | ✅ PASS |
| 69 | 真实 `%APPDATA%\VaultAI` 测试前后逐文件 SHA-256 一致（55/55） | ✅ PASS |

Windows 合计：**69 通过 / 0 失败**（1.5.0）。

备注：PC 上 Node v24 在测试脚本里调用 `process.exit()` 且仍有 fetch keep-alive 连接时，会触发已知的 libuv 断言（`UV_HANDLE_CLOSING`，退出码 -1073740791）。这是测试工具自身的问题，与 VaultAI 无关（该次运行的 8/8 用例均已通过）。改为 `process.exitCode` 后重跑，退出码 0。
