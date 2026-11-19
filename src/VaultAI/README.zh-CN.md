# VaultAI
### 1.9.0 新增

- **保存登录**：`Ctrl+Shift+S` / 自动填充空状态（非常驻键盘记录）
- **多来源导入**：Chrome / Edge / Firefox / Bitwarden / 1Password / KeePass / Password Depot
- **TOTP**：条目级验证器（加密存储，详情与可选自动填充）
- **数据库韧性**：中途离线只读缓存 + 解锁失败阻断与重连（无静默双源）

 Tools v1.8

**给 AI 用的密码管家** · A password manager built for AI

把 API 密钥和密码保存在本机的 AES-256-GCM 加密保险库中。Claude Desktop、Cursor、Claude Code 或任何 MCP 客户端都可以通过 MCP 使用这些凭据，但永远看不到它们本身。AI 的使用受你设定的访问权限、每日限额和有效期约束，每次请求都会写入活动。界面支持中文（默认）和 English。

## Windows 安装

| 文件 | 用途 |
|------|------|
| **`VaultAI-Setup-1.9.0.exe`** | **安装版（推荐）**：按向导安装，带开始菜单和桌面快捷方式，可在「应用和功能」中卸载。静默安装：`/S` |
| `VaultAI-Setup-1.9.0-win-x64.zip` | 备选安装包：解压后运行 `VaultAI-Setup.bat`，安装到 `%LOCALAPPDATA%\VaultAI` |
| `VaultAI-Setup-1.9.0-Portable.exe` | 便携版：双击即用，不安装 |
| `VaultAI-src.zip` | 源码，见 `BUILD.md` |

**从 1.3.x / 1.4.0 升级**：直接覆盖安装，用原来的主密码解锁即可。升级前会先把原始文件复制到 `%APPDATA%\VaultAI\pre-1.5.0-backup\`，首页会列出所有变化。


## 1.9.0 新功能

- **热键快速新建**：默认 `Ctrl+Shift+N`（可改），即使主窗口隐藏也可从托盘弹出迷你浮层新建密码；保险库锁定时不可用。
- **数据库直存（不是备份）**：设置 →「数据库」连接 SQLite / PostgreSQL / MySQL，启用「将密码存到数据库」后，密码的增删改查直接写入 VaultAI 表。默认用主密钥 AES-256-GCM 加密 password/username/notes 再入库；明文选项默认关闭并有中英警告。详见 [docs/DB-STORAGE.md](docs/DB-STORAGE.md)。
- **快速新建**：密码页「快速新建」或 Ctrl+N，最少字段即可保存；「更多」打开完整编辑。
- **导入 Password Depot**：支持明文 CSV / XML（工具 → 导出）。详见 [docs/IMPORT.md](docs/IMPORT.md)。不支持加密的 `.pswe`。导入后请删除明文导出文件。

## 1.7.0（历史）

- 快速新建（页内）、Password Depot 导入。

## 快速开始（首页引导，4 步）

1. **创建保险库**：设置主密码。主密码无法找回，请务必记下来。
2. **添加第一个凭据**：添加一个连接（GitHub、Notion、Stripe、带 Linear/Sentry/Slack 预设的通用 HTTP，或 Google Beta），或保存一个密码。
3. **连接 AI 助手**：选择客户端，复制生成的配置。Claude Desktop 和 Cursor 是 JSON，Claude Code 是 `claude mcp add` 命令，命令行是环境变量。
4. **验证连接**：重启 AI 应用。VaultAI 收到带该令牌的第一次请求后会显示「已连接」。

## 六个页面

| 侧边栏 | 用途 |
|---|---|
| **首页** | 引导；每个 AI 当前能访问什么（含有效期、最近连接）；今天的成功/被拒绝请求；密码安全评分；升级说明；**停用所有 AI** 按钮 |
| **密码** | 条目（搜索、收藏、标签）·「安全检查」（弱密码、重复使用、长期未改）·「生成密码」弹窗 |
| **连接** | 我的连接（测试、编辑、删除），以及添加 GitHub / Notion / Stripe / 通用 HTTP / Google（Beta）的磁贴 |
| **AI 助手** | AI 助手列表（配置、续期 7 天、启用/停用、更换令牌、删除）+ 访问权限矩阵 |
| **活动** | 搜索 + 全部 / 成功 / 已拒绝 · 每日限额 |
| **设置** | 常规（语言、网站图标）· 安全（自动锁定、剪贴板、主密码）· **数据库**（SQLite/PostgreSQL/MySQL 直存）· 高级（速率限制、版本、MCP 地址、数据目录） |

**所有连接的访问权限都是同一套：关闭 · 只读 · 写入 · 完全。** 只读是查看；写入是创建或修改；完全用于不可撤回或敏感的操作，例如发送邮件、查看密码明文。密码库只有「关闭 · 只读 · 完全」三档，因为 AI 不能新建或修改条目。

**停用所有 AI**（标题栏和首页都有）会立即停用全部 AI 助手，并写入活动。访问权限设置会保留，之后可以逐个重新启用。

## 1.5.0–1.6.x 改了什么、删了什么、为什么

1.5.0 是一次功能收敛：页面更少、用词统一、功能诚实。完整评审见 `docs/PRODUCT-REVIEW.md`。

**新增**
- 首页：4 步引导、AI 当前访问、今日活动、安全评分、升级说明。
- 一键「停用所有 AI」。
- 按客户端生成配置，可「验证连接」。AI 助手显示「最近连接」，可「续期 7 天」。
- **编辑连接**：改名；替换密钥时访问权限不变；补充基础地址。
- 空状态都给出一个明确的下一步。锁屏页也能切换语言。

**合并**
- 侧边栏从 10 项减为 6 项：
  - 生成器 → 「生成密码」弹窗，条目表单里也内嵌。
  - 安全仪表盘 → 「密码 › 安全检查」。
  - 权限、连接 AI → 「AI 助手」。
  - 每日限额 → 「活动」。
  - 应用连接 → 「连接」，表单改为弹窗。
- **Linear / Sentry / Slack → 通用 HTTP 预设。** 原来的专用代码只有 3 个固定操作，预设加 GraphQL 覆盖得更多。已有连接会原地转换，ID、密钥和权限都不变。
- **文件夹 → 标签。** 两者都是给条目分类，功能重叠。
- **权限统一为 关闭/只读/写入/完全。** Gmail「草稿」降为**只读**（只降不升，并写说明）；「管理」变为写入；日历创建事件改为需要写入。

**渐进披露**
- 生成器默认只显示类型、长度和 4 种字符。易混字符、排除字符、最少数量、避免重复放在「更多选项」里。口令短语默认只显示词数。
- 设置分为 常规 / 安全 / 高级 三组，速率限制移入「高级」。

**移除**
- **网页抓取工具**：它不是凭据，等于给 AI 一个本机代理，有 SSRF 和数据外泄风险。AI 客户端本身就能上网。
- **Demo 连接器**：只在 `VAULTAI_DEV=1` 时出现。
- **「允许非本机访问」开关**：从未生效，而且危险。专家仍可设置环境变量 `VAULTAI_ALLOW_NON_LOOPBACK=1`。
- **ChatGPT 客户端类型**：ChatGPT 连不上本机 MCP，原有的会变为「其他」。
- **把令牌放在 URL（`?token=`）或请求体里**：令牌会进入日志和浏览历史。现在只接受 `Authorization: Bearer` 或 `X-VaultAI-Token` 请求头。
- **REST 版 `/mcp/tools`、`/mcp/call`**：和 JSON-RPC 重复。
- **虚构的通用「模板」**、`/api/templates/generic`、`/api/connect`、`/api/server/ping-restart`、`/api/passwords/generate`、`/api/passwords-export` 以及死代码。
- **CLI** 的 `tool linear/sentry/slack/web/demo` 和 `--template`。请改用 `vaultai tool generic <连接ID>`。
- 「关于」里的「灵感来自 GBrain Tools」。

**修复（安全）**
- 通用 HTTP 请求被限制在连接的**基础地址**之下，基础地址改为必填。之前 AI 可以把密钥发到任意主机。
- Google OAuth 回调页原样输出 `error` 参数（本机来源上的反射型 XSS），现已转义。
- `VAULTAI_API_BASE_*` 现在对真实工具调用也生效，而不只是「测试连接」。

**修复（协议与桌面端）**
- MCP 通知返回 202 且没有响应体；`GET /mcp` 返回 405；协议版本按客户端请求回显（支持 2024-11-05、2025-03-26、2025-06-18）。
- stdio 桥不再对通知回包。
- 托盘使用程序图标，菜单中英双语；窗口第一次隐藏到托盘时会提示。

**升级安全**
- 1.3.x 和 1.4.0 的保险库可以直接打开。第一次写入前，原始加密文件会原样复制到 `pre-1.5.0-backup/`。
- 不会丢弃任何用户密钥。每项变化都会在首页写一条说明，可逐条关闭。
- 1.5.0 的保险库不能再用 1.4.0 打开。如需回退，请使用 `pre-1.5.0-backup/`。

## 从源码运行

```powershell
npm install
npm run build
npm start          # http://127.0.0.1:3847
npm run electron   # 桌面窗口
```

## 环境变量

| 变量 | 含义 |
|---|---|
| `VAULTAI_DATA` / `VAULTAI_PORT` | 数据目录与端口（可用于隔离的测试实例） |
| `VAULTAI_DEV=1` | 开发模式：显示 Demo 连接器（echo/ping） |
| `VAULTAI_ALLOW_NON_LOOPBACK=1` | 允许绑定非本机的 `VAULTAI_HOST`（不推荐） |
| `VAULTAI_API_BASE_<GITHUB/NOTION/STRIPE/LINEAR/SENTRY/SLACK>` | 自建实例或测试用的 API 地址 |

## 测试

- `npm run test:unit`：生成器、强度、迁移、地址限制、i18n 词表。
- `npm run test:e2e`：覆盖以下全部区域，结果写入 `e2e/RESULTS.md`，截图写入 `e2e/screenshots/`。
  - 单元测试。
  - Playwright 界面（中英）。
  - 表单。
  - **真实 1.3.1 / 1.4.0 保险库迁移。**
  - MCP（HTTP + stdio）、CLI、安全、Electron。

## 许可证

MIT



## 1.6.x 人用自动填充

在任意应用账号框输入时，按 `Ctrl+Shift+P`（或输入触发词 `pp`）在文字光标旁弹出输入法式小浮框，按用户名/网站匹配保险库条目并填入；继续打字即过滤，↑↓、Enter/Tab、1–6、Esc，浮框不抢焦点（1.6.x）。详见 `docs/AUTOFILL.md`。与 AI/MCP 密码权限（关/只读/完全）相互独立。

## 测试情况（1.9.0）

Linux 自动化 E2E：**199 通过 / 0 失败**（单元 22、自动填充单元 10、浮框单元 15、导入单元 15、数据库存储单元 6、TOTP 单元 8、界面 12、表单 13、自动填充 18、迁移 20、迁移界面 3、MCP 30、CLI 14、安全 8、Electron 5）。Windows 隔离 Portable 冒烟（1.9.0）：**待测**，需交付机 `SD-20250722DZPD`（`cb7fd33a-…`）在线（打开 Grok Bot 桌面端）。详见 `E2E测试报告.md` / `e2e/RESULTS.md`。
