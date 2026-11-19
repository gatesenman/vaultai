# Database storage (DB-STORAGE) — VaultAI 1.9.0

**This is direct live storage for password entries, not a backup.**

When you enable **将密码存到数据库 / Store passwords in database**, create / update / delete / list of password items go to VaultAI-owned tables in the connected database. The local AES vault remains the unlock / master-key / settings home. There is no “backup now / restore snapshot / scheduled backup” flow for this feature.

## Engines

| Engine | Driver | Notes |
|--------|--------|-------|
| **SQLite** | `sql.js` (WASM) | File path; no native rebuild for electron-builder |
| **PostgreSQL** | `pg` | Host/port/user/password/database or connection URI; optional SSL |
| **MySQL / MariaDB** | `mysql2` | Same connection UX as PostgreSQL |

Settings → **数据库 / Database**: choose engine, fill connection, **Test connection**, then enable storage. Schema `vaultai_passwords` is created automatically if missing.

## Source of truth (clear mode)

- **DB storage ON**: the connected DB is the **sole** password backend. Passwords page and background quick-create (`CommandOrControl+Shift+N`) share the same store path. On disk, the local vault’s `passwords[]` is cleared while mode is active (master key + settings stay local).
- **DB storage OFF**: local vault `passwords[]` is the SoT again. Disabling pulls the in-memory cache back into the local vault file.

Do not run with two divergent sources of truth.

## Encryption model (professional default)

Default `enc_mode = vault-aes`:

- **password**, **username**, **notes** → AES-256-GCM `EncryptedBlob` JSON (`iv` + `tag` + `ciphertext` hex), encrypted with the **vault master key** (same primitives as the local vault).
- **title**, **url**, **tags**, favorite, timestamps → plaintext columns (needed for search / list UI).

Optional **Store plaintext in DB** (`allowPlaintextStorage`) is **default OFF**. Enabling requires an explicit confirmation; columns `username_pt` / `password_pt` / `notes_pt` are used and `enc_mode = plaintext`. Treat this as dangerous.

The DB server login password (for Postgres/MySQL) is stored encrypted inside the local vault settings (`dbStorage.passwordEnc`), never in plaintext settings.

## Table

`vaultai_passwords` — columns include `id`, `title`, `url`, `tags`, `favorite`, timestamps, `enc_mode`, `username_enc`, `password_enc`, `notes_enc`, and the optional plaintext columns above.

## API (local loopback)

- `GET /api/db-storage` — public settings + active flag
- `POST /api/db-storage/test` — connect + ensure schema
- `PUT /api/db-storage` — enable / disable / update connection (`migrateLocal` default true when enabling)

Password CRUD remains `/api/passwords*`; when DB mode is active those handlers write through to the DB.

## Activity

Actions `db:test:ok`, `db:test:fail`, `db:enable`, `db:enable:fail`, `db:disable` are logged without secrets.


## Offline / reconnect (1.9.0)

Professional default — **no silent dual source of truth**:

| Situation | Behavior |
|-----------|----------|
| Mid-session DB drop (had live cache) | Passwords stay available **read-only** from memory; writes refuse until reconnect. Banner + **Reconnect**. |
| Unlock while DB enabled but unreachable | Password list is **empty/blocked** (local `passwords[]` is not used as a second SoT). Fix connection → **Reconnect** (or unlock again). |
| Migrate / enable / sync | Progress and errors surface in UI; failures do not leave two writers. |

`GET /api/settings` exposes `dbStorageOffline`. `POST /api/db-storage/reconnect` reloads from DB on success.

Schema adds nullable `totp_enc` (AES blob JSON) alongside existing encrypted fields; older DBs get `ALTER TABLE … ADD COLUMN` on connect.
