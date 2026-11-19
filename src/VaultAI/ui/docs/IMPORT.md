# 导入密码到 VaultAI（1.9.0）

VaultAI 自动识别多种**明文**导出，并沿用同一套「跳过 / 更新 / 全部新建」策略。

| 来源 | 典型文件 | 说明 |
|------|----------|------|
| Chrome / Edge | `Chrome`/`Edge` 密码 CSV | 列 `name,url,username,password`；Edge 依文件名区分 |
| Firefox | 登录信息 CSV | 含 `httpRealm` / `formActionOrigin` 等 |
| Bitwarden | CSV | `login_uri` / `login_username` / `login_password` / `login_totp`；非 login 类型跳过 |
| 1Password | CSV | `Title` + `OTPAuth` 等 |
| KeePass | CSV / XML | CSV 含 `Group,Title,…`；KeePass 2 XML (`KeePassFile`/`Entry`/`String`) |
| Password Depot | CSV / XML | 经典 `;` 分隔 + Description 列；加密 `.pswe` **不支持** |
| 通用 CSV | — | 回退映射 title/username/password/url/notes/tags/totp |

## 安全提醒

导出文件是**明文**（含密码与 TOTP 密钥）。请：

1. 仅在本机受信任环境导出  
2. 导入成功后**立即删除**导出文件（含回收站）  
3. 不要把导出文件发到聊天、网盘或邮件  

VaultAI 导入预览会提示明文风险；导入完成后建议勾选/执行删除导出文件。

## 在 VaultAI 中导入

1. 解锁 → **密码** → **导入**  
2. 选择 CSV 或 XML；格式自动检测（预览显示来源标签）  
3. 重复策略：**跳过**（默认）/ **更新已有**（需确认）/ **全部新建**  
4. 开始导入 → 删除明文文件  

## 字段与 TOTP

常见列映射到标题、用户名、密码、网址、备注、标签。`totp` / `OTPAuth` / `login_totp` 等写入加密 TOTP。无密码的行不会入库。

## 不支持

- Password Depot / 浏览器加密库原生格式（`.pswe`、浏览器 Profile 等）  
- 需要专有 SDK 的数据库直接打开  
