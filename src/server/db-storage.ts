/**
 * Database storage for password entries (VaultAI 1.8.0).
 *
 * When enabled, the connected DB is the sole backend for password CRUD.
 * Local AES vault keeps master key + settings; passwords[] is cleared while DB mode is on.
 *
 * Security default: password + username + notes are AES-256-GCM EncryptedBlob JSON
 * (same primitives as the local vault). Title / url / tags stay plaintext for search.
 * Optional allowPlaintextStorage (default OFF) writes plaintext columns — dangerous.
 *
 * Engines: SQLite via sql.js (WASM, no native rebuild), PostgreSQL (pg), MySQL/MariaDB (mysql2).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { encrypt, decrypt } from '../crypto/vault.js';
import type { DbEngine, DbStorageSettings, EncryptedBlob, PasswordEntry, PasswordEntryMeta } from '../types/index.js';
import { scrubError } from './security.js';

const require = createRequire(import.meta.url);

export interface DbConnInput {
  engine: DbEngine;
  sqlitePath?: string;
  connectionUri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
}

type SqlJsDb = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => {
    bind: (p: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
  export: () => Uint8Array;
  close: () => void;
};

let sqlJsPromise: Promise<{ Database: new (data?: ArrayLike<number>) => SqlJsDb }> | null = null;

async function loadSqlJs() {
  if (!sqlJsPromise) {
    const sqlJsPath = dirname(require.resolve('sql.js'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require(join(sqlJsPath, 'sql-wasm.js')) as (cfg?: {
      locateFile?: (f: string) => string;
      wasmBinary?: Buffer;
    }) => Promise<{ Database: new (data?: ArrayLike<number>) => SqlJsDb }>;
    const wasmPath = join(sqlJsPath, 'sql-wasm.wasm');
    const wasmBinary = existsSync(wasmPath) ? readFileSync(wasmPath) : undefined;
    sqlJsPromise = initSqlJs(
      wasmBinary ? { wasmBinary } : { locateFile: (f) => join(sqlJsPath, f) },
    );
  }
  return sqlJsPromise;
}

function scrubConnError(e: unknown): string {
  let msg = scrubError(e);
  msg = msg.replace(/password[=:]\S+/gi, 'password=***');
  msg = msg.replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:***@');
  return msg.slice(0, 240);
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS vaultai_passwords (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  tags TEXT,
  favorite INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_updated_at TEXT,
  enc_mode TEXT NOT NULL DEFAULT 'vault-aes',
  username_enc TEXT,
  password_enc TEXT,
  notes_enc TEXT,
  username_pt TEXT,
  password_pt TEXT,
  notes_pt TEXT,
  totp_enc TEXT
);
`;

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS vaultai_passwords (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  tags TEXT,
  favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  password_updated_at TIMESTAMPTZ,
  enc_mode TEXT NOT NULL DEFAULT 'vault-aes',
  username_enc TEXT,
  password_enc TEXT,
  notes_enc TEXT,
  username_pt TEXT,
  password_pt TEXT,
  notes_pt TEXT,
  totp_enc TEXT
);
`;

const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS vaultai_passwords (
  id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  tags TEXT,
  favorite TINYINT DEFAULT 0,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  password_updated_at VARCHAR(40),
  enc_mode VARCHAR(16) NOT NULL DEFAULT 'vault-aes',
  username_enc LONGTEXT,
  password_enc LONGTEXT,
  notes_enc LONGTEXT,
  username_pt TEXT,
  password_pt TEXT,
  notes_pt TEXT,
  totp_enc TEXT
)
`;

export function normalizeConn(input: DbConnInput): DbConnInput {
  const engine = input.engine;
  if (!engine || !['sqlite', 'postgres', 'mysql'].includes(engine)) {
    throw new Error('engine must be sqlite, postgres, or mysql');
  }
  if (engine === 'sqlite') {
    const path = String(input.sqlitePath || '').trim();
    if (!path) throw new Error('sqlitePath required');
    return { engine, sqlitePath: path };
  }
  if (input.connectionUri?.trim()) {
    return { engine, connectionUri: input.connectionUri.trim(), ssl: Boolean(input.ssl) };
  }
  const host = String(input.host || '').trim() || '127.0.0.1';
  const database = String(input.database || '').trim();
  if (!database) throw new Error('database name required');
  const port = Number(input.port) || (engine === 'postgres' ? 5432 : 3306);
  return {
    engine,
    host,
    port,
    user: String(input.user || '').trim() || (engine === 'postgres' ? 'postgres' : 'root'),
    password: input.password ?? '',
    database,
    ssl: Boolean(input.ssl),
  };
}

function blobJson(b: EncryptedBlob | null | undefined): string | null {
  if (!b) return null;
  return JSON.stringify(b);
}

function parseBlob(s: unknown): EncryptedBlob | null {
  if (!s) return null;
  try {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    if (o && typeof o.ciphertext === 'string' && typeof o.iv === 'string' && typeof o.tag === 'string') {
      return o as EncryptedBlob;
    }
  } catch { /* */ }
  return null;
}

export function encodeEntryRow(
  pe: PasswordEntry,
  vaultKey: Buffer,
  plaintext: boolean,
): Record<string, unknown> {
  if (plaintext) {
    let password = '';
    try { password = decrypt(pe.passwordEnc, vaultKey).toString('utf8'); } catch { password = ''; }
    return {
      id: pe.id,
      title: pe.title,
      url: pe.url || null,
      tags: JSON.stringify(pe.tags || []),
      favorite: pe.favorite ? 1 : 0,
      created_at: pe.createdAt,
      updated_at: pe.updatedAt,
      password_updated_at: pe.passwordUpdatedAt || null,
      enc_mode: 'plaintext',
      username_enc: null,
      password_enc: null,
      notes_enc: null,
      username_pt: pe.username || '',
      password_pt: password,
      notes_pt: pe.notes || null,
      totp_enc: pe.totpSecretEnc ? blobJson(pe.totpSecretEnc) : null,
    };
  }
  const usernameEnc = pe.username ? encrypt(pe.username, vaultKey) : null;
  const notesEnc = pe.notes ? encrypt(pe.notes, vaultKey) : null;
  return {
    id: pe.id,
    title: pe.title,
    url: pe.url || null,
    tags: JSON.stringify(pe.tags || []),
    favorite: pe.favorite ? 1 : 0,
    created_at: pe.createdAt,
    updated_at: pe.updatedAt,
    password_updated_at: pe.passwordUpdatedAt || null,
    enc_mode: 'vault-aes',
    username_enc: blobJson(usernameEnc),
    password_enc: blobJson(pe.passwordEnc),
    notes_enc: blobJson(notesEnc),
    username_pt: null,
    password_pt: null,
    notes_pt: null,
    totp_enc: pe.totpSecretEnc ? blobJson(pe.totpSecretEnc) : null,
  };
}

export function decodeEntryRow(row: Record<string, unknown>, vaultKey: Buffer): PasswordEntry {
  const encMode = String(row.enc_mode || 'vault-aes');
  let username = '';
  let notes: string | undefined;
  let passwordEnc: EncryptedBlob;

  if (encMode === 'plaintext') {
    username = String(row.username_pt || '');
    notes = row.notes_pt != null ? String(row.notes_pt) : undefined;
    passwordEnc = encrypt(String(row.password_pt || ''), vaultKey);
  } else {
    const uBlob = parseBlob(row.username_enc);
    const nBlob = parseBlob(row.notes_enc);
    const pBlob = parseBlob(row.password_enc);
    if (!pBlob) throw new Error('Corrupt password_enc');
    passwordEnc = pBlob;
    if (uBlob) {
      try { username = decrypt(uBlob, vaultKey).toString('utf8'); } catch { username = ''; }
    }
    if (nBlob) {
      try { notes = decrypt(nBlob, vaultKey).toString('utf8'); } catch { notes = undefined; }
    }
  }

  let tags: string[] | undefined;
  try {
    const t = row.tags != null ? JSON.parse(String(row.tags)) : [];
    tags = Array.isArray(t) ? t.map(String) : undefined;
  } catch { tags = undefined; }

  const totpBlob = parseBlob(row.totp_enc);
  return {
    id: String(row.id),
    title: String(row.title || ''),
    username,
    passwordEnc,
    totpSecretEnc: totpBlob || undefined,
    url: row.url != null && String(row.url) ? String(row.url) : undefined,
    notes,
    tags,
    favorite: Boolean(row.favorite === true || row.favorite === 1 || row.favorite === '1'),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    passwordUpdatedAt: row.password_updated_at ? String(row.password_updated_at) : undefined,
  };
}

export async function testDbConnection(input: DbConnInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const backend = await openBackend(normalizeConn(input));
    await backend.ensureSchema();
    await backend.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: scrubConnError(e) };
  }
}

export interface PasswordDbBackend {
  ensureSchema(): Promise<void>;
  listAll(): Promise<Record<string, unknown>[]>;
  upsert(row: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(rows: Record<string, unknown>[]): Promise<void>;
  close(): Promise<void>;
  engine: DbEngine;
}

async function openSqlite(path: string): Promise<PasswordDbBackend> {
  const SQL = await loadSqlJs();
  mkdirSync(dirname(path), { recursive: true });
  const bytes = existsSync(path) ? readFileSync(path) : undefined;
  let db: SqlJsDb = bytes ? new SQL.Database(bytes) : new SQL.Database();
  const flush = () => {
    const out = db.export();
    writeFileSync(path, Buffer.from(out));
  };
  return {
    engine: 'sqlite',
    async ensureSchema() {
      for (const stmt of SQLITE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) db.run(stmt);
      try { db.run('ALTER TABLE vaultai_passwords ADD COLUMN totp_enc TEXT'); } catch { /* exists */ }
      flush();
    },
    async listAll() {
      const stmt = db.prepare('SELECT * FROM vaultai_passwords');
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    async upsert(row) {
      db.run(
        `INSERT OR REPLACE INTO vaultai_passwords
          (id, title, url, tags, favorite, created_at, updated_at, password_updated_at, enc_mode,
           username_enc, password_enc, notes_enc, username_pt, password_pt, notes_pt, totp_enc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.title, row.url, row.tags, row.favorite, row.created_at, row.updated_at,
          row.password_updated_at, row.enc_mode, row.username_enc, row.password_enc, row.notes_enc,
          row.username_pt, row.password_pt, row.notes_pt, row.totp_enc,
        ],
      );
      flush();
    },
    async remove(id) {
      db.run('DELETE FROM vaultai_passwords WHERE id = ?', [id]);
      flush();
    },
    async replaceAll(rows) {
      db.run('DELETE FROM vaultai_passwords');
      for (const row of rows) {
        db.run(
          `INSERT INTO vaultai_passwords
            (id, title, url, tags, favorite, created_at, updated_at, password_updated_at, enc_mode,
             username_enc, password_enc, notes_enc, username_pt, password_pt, notes_pt, totp_enc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id, row.title, row.url, row.tags, row.favorite, row.created_at, row.updated_at,
            row.password_updated_at, row.enc_mode, row.username_enc, row.password_enc, row.notes_enc,
            row.username_pt, row.password_pt, row.notes_pt, row.totp_enc,
          ],
        );
      }
      flush();
    },
    async close() {
      try { flush(); } catch { /* */ }
      try { db.close(); } catch { /* */ }
    },
  };
}

async function openPostgres(c: DbConnInput): Promise<PasswordDbBackend> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg') as { Client: new (cfg: Record<string, unknown>) => {
    connect: () => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    end: () => Promise<void>;
  } };
  const client = new Client(
    c.connectionUri
      ? { connectionString: c.connectionUri, ssl: c.ssl ? { rejectUnauthorized: false } : undefined }
      : {
          host: c.host, port: c.port, user: c.user, password: c.password, database: c.database,
          ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: 8000,
        },
  );
  await client.connect();
  return {
    engine: 'postgres',
    async ensureSchema() {
      await client.query(PG_SCHEMA);
      try { await client.query('ALTER TABLE vaultai_passwords ADD COLUMN IF NOT EXISTS totp_enc TEXT'); } catch { /* */ }
    },
    async listAll() {
      const r = await client.query('SELECT * FROM vaultai_passwords');
      return r.rows as Record<string, unknown>[];
    },
    async upsert(row) {
      await client.query(
        `INSERT INTO vaultai_passwords
          (id, title, url, tags, favorite, created_at, updated_at, password_updated_at, enc_mode,
           username_enc, password_enc, notes_enc, username_pt, password_pt, notes_pt, totp_enc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           title=EXCLUDED.title, url=EXCLUDED.url, tags=EXCLUDED.tags, favorite=EXCLUDED.favorite,
           created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
           password_updated_at=EXCLUDED.password_updated_at, enc_mode=EXCLUDED.enc_mode,
           username_enc=EXCLUDED.username_enc, password_enc=EXCLUDED.password_enc, notes_enc=EXCLUDED.notes_enc,
           username_pt=EXCLUDED.username_pt, password_pt=EXCLUDED.password_pt, notes_pt=EXCLUDED.notes_pt,
           totp_enc=EXCLUDED.totp_enc`,
        [
          row.id, row.title, row.url, row.tags, Boolean(row.favorite), row.created_at, row.updated_at,
          row.password_updated_at, row.enc_mode, row.username_enc, row.password_enc, row.notes_enc,
          row.username_pt, row.password_pt, row.notes_pt, row.totp_enc,
        ],
      );
    },
    async remove(id) { await client.query('DELETE FROM vaultai_passwords WHERE id = $1', [id]); },
    async replaceAll(rows) {
      await client.query('DELETE FROM vaultai_passwords');
      for (const row of rows) {
        await client.query(
          `INSERT INTO vaultai_passwords
            (id, title, url, tags, favorite, created_at, updated_at, password_updated_at, enc_mode,
             username_enc, password_enc, notes_enc, username_pt, password_pt, notes_pt, totp_enc)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            row.id, row.title, row.url, row.tags, Boolean(row.favorite), row.created_at, row.updated_at,
            row.password_updated_at, row.enc_mode, row.username_enc, row.password_enc, row.notes_enc,
            row.username_pt, row.password_pt, row.notes_pt, row.totp_enc,
          ],
        );
      }
    },
    async close() { await client.end(); },
  };
}

async function openMysql(c: DbConnInput): Promise<PasswordDbBackend> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql = require('mysql2/promise') as {
    createConnection: (cfg: string | Record<string, unknown>) => Promise<{
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
      end: () => Promise<void>;
    }>;
  };
  const conn = await mysql.createConnection(
    c.connectionUri
      ? c.connectionUri
      : {
          host: c.host, port: c.port, user: c.user, password: c.password, database: c.database,
          ssl: c.ssl ? {} : undefined,
          connectTimeout: 8000,
        },
  );
  return {
    engine: 'mysql',
    async ensureSchema() {
      await conn.query(MYSQL_SCHEMA);
      try { await conn.query('ALTER TABLE vaultai_passwords ADD COLUMN totp_enc LONGTEXT NULL'); } catch { /* exists */ }
    },
    async listAll() {
      const [rows] = await conn.query('SELECT * FROM vaultai_passwords') as [Record<string, unknown>[], unknown];
      return rows;
    },
    async upsert(row) {
      await conn.query(
        `INSERT INTO vaultai_passwords
          (id, title, url, tags, favorite, created_at, updated_at, password_updated_at, enc_mode,
           username_enc, password_enc, notes_enc, username_pt, password_pt, notes_pt, totp_enc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title=VALUES(title), url=VALUES(url), tags=VALUES(tags), favorite=VALUES(favorite),
           created_at=VALUES(created_at), updated_at=VALUES(updated_at),
           password_updated_at=VALUES(password_updated_at), enc_mode=VALUES(enc_mode),
           username_enc=VALUES(username_enc), password_enc=VALUES(password_enc), notes_enc=VALUES(notes_enc),
           username_pt=VALUES(username_pt), password_pt=VALUES(password_pt), notes_pt=VALUES(notes_pt),
           totp_enc=VALUES(totp_enc)`,
        [
          row.id, row.title, row.url, row.tags, row.favorite, row.created_at, row.updated_at,
          row.password_updated_at, row.enc_mode, row.username_enc, row.password_enc, row.notes_enc,
          row.username_pt, row.password_pt, row.notes_pt, row.totp_enc,
        ],
      );
    },
    async remove(id) { await conn.query('DELETE FROM vaultai_passwords WHERE id = ?', [id]); },
    async replaceAll(rows) {
      await conn.query('DELETE FROM vaultai_passwords');
      for (const row of rows) {
        await conn.query(
          `INSERT INTO vaultai_passwords
            (id, title, url, tags, favorite, created_at, updated_at, password_updated_at, enc_mode,
             username_enc, password_enc, notes_enc, username_pt, password_pt, notes_pt, totp_enc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id, row.title, row.url, row.tags, row.favorite, row.created_at, row.updated_at,
            row.password_updated_at, row.enc_mode, row.username_enc, row.password_enc, row.notes_enc,
            row.username_pt, row.password_pt, row.notes_pt, row.totp_enc,
          ],
        );
      }
    },
    async close() { await conn.end(); },
  };
}

export async function openBackend(input: DbConnInput): Promise<PasswordDbBackend> {
  const c = normalizeConn(input);
  if (c.engine === 'sqlite') return openSqlite(c.sqlitePath!);
  if (c.engine === 'postgres') return openPostgres(c);
  return openMysql(c);
}

/** Load all password entries from DB, decrypting into PasswordEntry shape. */
export async function loadPasswordsFromDb(
  backend: PasswordDbBackend,
  vaultKey: Buffer,
): Promise<PasswordEntry[]> {
  await backend.ensureSchema();
  const rows = await backend.listAll();
  const out: PasswordEntry[] = [];
  for (const row of rows) {
    try { out.push(decodeEntryRow(row, vaultKey)); }
    catch { /* skip corrupt */ }
  }
  return out;
}

export async function upsertPasswordToDb(
  backend: PasswordDbBackend,
  pe: PasswordEntry,
  vaultKey: Buffer,
  plaintext: boolean,
): Promise<void> {
  await backend.upsert(encodeEntryRow(pe, vaultKey, plaintext));
}

export async function removePasswordFromDb(backend: PasswordDbBackend, id: string): Promise<void> {
  await backend.remove(id);
}

export async function migrateLocalPasswordsToDb(
  backend: PasswordDbBackend,
  entries: PasswordEntry[],
  vaultKey: Buffer,
  plaintext: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  await backend.ensureSchema();
  const rows = entries.map((pe) => encodeEntryRow(pe, vaultKey, plaintext));
  // Merge: upsert each (keep existing DB rows that aren't in local)
  let done = 0;
  const total = rows.length;
  for (const row of rows) {
    await backend.upsert(row);
    done += 1;
    onProgress?.(done, total);
  }
  return rows.length;
}

export function publicDbStorage(s: DbStorageSettings | undefined, hasPassword: boolean): Record<string, unknown> {
  const d = s || {};
  return {
    enabled: Boolean(d.enabled),
    engine: d.engine || 'sqlite',
    sqlitePath: d.sqlitePath || '',
    connectionUri: d.connectionUri || '',
    host: d.host || '',
    port: d.port || '',
    user: d.user || '',
    database: d.database || '',
    ssl: Boolean(d.ssl),
    hasPassword,
    allowPlaintextStorage: Boolean(d.allowPlaintextStorage),
    lastOkAt: d.lastOkAt || null,
    lastError: d.lastError || null,
    connectionState: d.connectionState || (d.enabled ? 'offline' : 'off'),
  };
}

export function connFromSettings(
  settings: DbStorageSettings | undefined,
  decryptPassword: () => string | undefined,
  override?: Partial<DbConnInput> & { password?: string },
): DbConnInput {
  const d = settings || {};
  const engine = (override?.engine || d.engine || 'sqlite') as DbEngine;
  let password = override?.password;
  if (password === undefined) {
    try { password = decryptPassword(); } catch { password = ''; }
  }
  return {
    engine,
    sqlitePath: override?.sqlitePath ?? d.sqlitePath,
    connectionUri: override?.connectionUri ?? d.connectionUri,
    host: override?.host ?? d.host,
    port: override?.port ?? d.port,
    user: override?.user ?? d.user,
    password: password ?? '',
    database: override?.database ?? d.database,
    ssl: override?.ssl ?? d.ssl,
  };
}

export function toMeta(pe: PasswordEntry): PasswordEntryMeta {
  const { passwordEnc: _, totpSecretEnc, ...rest } = pe;
  return { ...rest, hasTotp: Boolean(totpSecretEnc) };
}
