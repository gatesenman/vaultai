# TOTP authenticator — VaultAI 1.9.0

Per-item Google Authenticator–compatible TOTP (RFC 6238): **SHA-1**, **30s**, **6 digits** by default.

## Store

- Secret is encrypted with the vault master key (`totpSecretEnc` / DB column `totp_enc`).
- List/meta expose only `hasTotp` — never the secret.
- Paste either a bare Base32 secret or an `otpauth://totp/…` URI (issuer/account/digits/period/algorithm parsed; secret stored as Base32).

## UI

- Password editor: Authenticator field + live countdown when configured; ✕ clears on save.
- List: **Copy code** when `hasTotp`.
- Autofill mini picker: optional TOTP row when the prepared match has TOTP (filled after username/password when confirmation allows).

## API / MCP

- `GET /api/passwords/:id/totp` → `{ code, remaining, period }` (unlocked vault).
- MCP `get_totp` requires assistant **passwords = Full** (same gate as revealing passwords).

## Import

CSV columns `totp` / `otp` / `login_totp` / `OTPAuth` / etc. are imported and encrypted with the item.
