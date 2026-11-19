
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
