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
