import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  decrypt,
  decryptWithPassword,
  deriveKey,
  encrypt,
  encryptWithPassword,
  generateId,
  generateToken,
  hashToken,
  VERIFIER_PLAIN,
} from '../crypto/vault.js';
import type {
  ActivityEntry,
  ApplicationRecord,
  AssistantRecord,
  DailyLimit,
  EncryptedBlob,
  PasswordEntry,
  PasswordEntryMeta,
  MigrationNote,
  PermissionLevel,
  VaultMeta,
  VaultPlaintext,
} from '../types/index.js';
import { PASSWORDS_PERM_KEY, SCHEMA_VERSION } from '../types/index.js';
import { migrateVault } from './migrate.js';
import { isDevMode } from '../server/devmode.js';
import {
  openBackend,
  loadPasswordsFromDb,
  upsertPasswordToDb,
  removePasswordFromDb,
  migrateLocalPasswordsToDb,
  connFromSettings,
  type PasswordDbBackend,
  type DbConnInput,
} from '../server/db-storage.js';

/** Folder (inside the data dir) holding the untouched pre-upgrade vault files. */
export const PRE_UPGRADE_BACKUP_DIR = 'pre-1.5.0-backup';

export function defaultDataDir(): string {
  const env = process.env.VAULTAI_DATA;
  if (env) return env;
  return join(homedir(), '.vaultai');
}

export function vaultPaths(dataDir?: string) {
  const dir = dataDir || defaultDataDir();
  return {
    dir,
    meta: join(dir, 'vault.meta.json'),
    data: join(dir, 'vault.data.enc'),
  };
}

const DEFAULT_PLAIN: VaultPlaintext = {
  applications: [],
  assistants: [],
  dailyLimits: [],
  activity: [],
  passwords: [],
  settings: {
    port: 3847,
    host: '127.0.0.1',
    defaultDailyLimit: 100,
    idleLockMinutes: 30,
    rateLimitPerMinute: 120,
    language: 'zh-CN',
    clipboardClearSeconds: 30,
    fetchSiteIcons: true,
    autofillEnabled: true,
    autofillTextTrigger: 'pp',
    autofillHotkey: 'CommandOrControl+Shift+P',
    autofillConfirm: false,
    quickCreateHotkey: 'CommandOrControl+Shift+N',
    saveLoginHotkey: 'CommandOrControl+Shift+S',
    dbStorage: { enabled: false, engine: 'sqlite', allowPlaintextStorage: false, connectionState: 'off' },
    schemaVersion: SCHEMA_VERSION,
    migrations: [],
  },
};

export class VaultStore {
  private dataDir: string;
  private key: Buffer | null = null;
  private plain: VaultPlaintext | null = null;
  private meta: VaultMeta | null = null;
  private listenPort = 3847;
  private listenHost = '127.0.0.1';
  /** When set, password CRUD uses DB as sole backend; plain.passwords is the working cache. */
  private dbBackend: PasswordDbBackend | null = null;
  private dbActive = false;
  /**
   * Mid-session offline: DB enabled, connection lost, memory cache kept read-only.
   * Writes throw until reconnect succeeds. Distinct from unlock-time sync failure (no cache).
   */
  private dbOffline = false;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || defaultDataDir();
  }

  setListenAddress(host: string, port: number): void {
    this.listenHost = host;
    this.listenPort = port;
    if (this.plain) {
      this.plain.settings.host = host;
      this.plain.settings.port = port;
      // do not persist solely for listen bind
    }
  }

  /** The address this process actually listens on (not the persisted default). */
  getListenPort(): number {
    return this.listenPort;
  }
  /** Host to put into client-facing URLs (a wildcard bind is reached via loopback). */
  getClientHost(): string {
    return this.listenHost === '0.0.0.0' || this.listenHost === '::' ? '127.0.0.1' : this.listenHost;
  }


  get unlocked(): boolean {
    return this.key !== null && this.plain !== null;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  exists(): boolean {
    const p = vaultPaths(this.dataDir);
    return existsSync(p.meta) && existsSync(p.data);
  }

  create(masterPassword: string): void {
    if (this.exists()) throw new Error('Vault already exists');
    mkdirSync(this.dataDir, { recursive: true });
    const verifier = encryptWithPassword(VERIFIER_PLAIN, masterPassword);
    this.meta = {
      version: 1,
      createdAt: new Date().toISOString(),
      verifier,
    };
    this.key = deriveKey(masterPassword, Buffer.from(verifier.salt, 'hex'));
    this.plain = structuredClone(DEFAULT_PLAIN);
    this.ensureBuiltins();
    this.persist();
  }

  unlock(masterPassword: string): void {
    const p = vaultPaths(this.dataDir);
    if (!existsSync(p.meta) || !existsSync(p.data)) {
      throw new Error('Vault not found. Create one first.');
    }
    this.meta = JSON.parse(readFileSync(p.meta, 'utf8')) as VaultMeta;
    try {
      const check = decryptWithPassword(this.meta.verifier, masterPassword).toString('utf8');
      if (check !== VERIFIER_PLAIN) throw new Error('bad verifier');
    } catch {
      throw new Error('Wrong master password');
    }
    this.key = deriveKey(masterPassword, Buffer.from(this.meta.verifier.salt, 'hex'));
    const encFile = JSON.parse(readFileSync(p.data, 'utf8')) as EncryptedBlob;
    const raw = decrypt(encFile, this.key).toString('utf8');
    const plain = JSON.parse(raw) as VaultPlaintext;
    const before = Number((plain.settings as { schemaVersion?: number } | undefined)?.schemaVersion || 1);
    if (before < SCHEMA_VERSION) this.backupBeforeUpgrade();
    const result = migrateVault(plain, { dev: isDevMode() });
    this.plain = plain;
    const notes = result.notes.slice();
    if (before < SCHEMA_VERSION) notes.unshift({ code: 'mig.backup', params: { dir: join(this.dataDir, PRE_UPGRADE_BACKUP_DIR) } });
    if (notes.length) {
      const at = new Date().toISOString();
      const list = (plain.settings.migrations = plain.settings.migrations || []);
      for (const n of notes) list.push({ ...n, id: generateId('mig'), at });
    }
    const builtinsChanged = this.ensureBuiltins();
    if (result.changed || builtinsChanged) this.persist();
  }

  /** Copy the encrypted files, untouched, before the first 1.5.0 write. */
  private backupBeforeUpgrade(): void {
    const p = vaultPaths(this.dataDir);
    const dir = join(this.dataDir, PRE_UPGRADE_BACKUP_DIR);
    if (existsSync(join(dir, 'vault.data.enc'))) return; // keep the oldest copy
    mkdirSync(dir, { recursive: true });
    copyFileSync(p.meta, join(dir, 'vault.meta.json'));
    copyFileSync(p.data, join(dir, 'vault.data.enc'));
  }

  lock(): void {
    void this.closeDbStorage();
    this.dbOffline = false;
    this.key = null;
    this.plain = null;
  }

  /** Gmail + Calendar always exist (Beta, need the user's OAuth client); Demo only in developer mode. */
  private ensureBuiltins(): boolean {
    if (!this.plain) return false;
    let changed = false;
    const plain = this.plain;
    const kinds = new Set(plain.applications.map((a) => a.kind));
    const now = new Date().toISOString();
    const add = (id: string, kind: ApplicationRecord['kind'], name: string, notes: string) => {
      if (kinds.has(kind)) return;
      plain.applications.push({
        id,
        kind,
        name,
        secretEnc: encrypt('none', this.requireKey()),
        meta: { notes, connected: false },
        createdAt: now,
        updatedAt: now,
      });
      for (const a of plain.assistants) a.permissions[id] = a.permissions[id] || 'off';
      kinds.add(kind);
      changed = true;
    };
    add('app_gmail_builtin', 'gmail', 'Gmail', 'Google OAuth (Beta)');
    add('app_gcal_builtin', 'gcal', 'Google Calendar', 'Google OAuth (Beta)');
    if (isDevMode()) add('app_demo_builtin', 'demo', 'Demo Echo', 'Developer mode only');
    else if (kinds.has('demo')) {
      const ids = new Set(plain.applications.filter((a) => a.kind === 'demo').map((a) => a.id));
      plain.applications = plain.applications.filter((a) => !ids.has(a.id));
      for (const a of plain.assistants) for (const id of ids) delete a.permissions[id];
      plain.dailyLimits = plain.dailyLimits.filter((d) => !d.toolKey.startsWith('demo:'));
      changed = true;
    }
    const connected = Boolean(plain.settings.google?.tokensEnc);
    const email = plain.settings.google?.email;
    for (const app of plain.applications) {
      if (app.kind === 'gmail' || app.kind === 'gcal') {
        app.meta.connected = connected;
        if (email) app.meta.email = email;
      }
    }
    return changed;
  }

  decryptBlob(blob: EncryptedBlob): string {
    return decrypt(blob, this.requireKey()).toString('utf8');
  }

  markGoogleAppsConnected(connected: boolean, email?: string): void {
    const plain = this.requirePlain();
    for (const app of plain.applications) {
      if (app.kind === 'gmail' || app.kind === 'gcal') {
        app.meta.connected = connected;
        if (email !== undefined) app.meta.email = email || undefined;
        if (!connected) delete app.meta.email;
        app.updatedAt = new Date().toISOString();
      }
    }
    this.persist();
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('Vault locked');
    return this.key;
  }

  private requirePlain(): VaultPlaintext {
    if (!this.plain) throw new Error('Vault locked');
    return this.plain;
  }


  /** Encrypt a string with the unlocked vault key (for assistant tokens, etc.) */
  encryptForVault(plaintext: string): EncryptedBlob {
    return encrypt(plaintext, this.requireKey());
  }

  persist(): void {
    const key = this.requireKey();
    const plain = this.requirePlain();
    const p = vaultPaths(this.dataDir);
    mkdirSync(p.dir, { recursive: true });
    if (!this.meta) throw new Error('No vault meta');
    writeFileSync(p.meta, JSON.stringify(this.meta, null, 2), 'utf8');
    // DB mode: passwords live in DB — do not dual-write ciphertext into local vault file
    const savedPw = plain.passwords;
    if (this.dbActive) plain.passwords = [];
    try {
      const blob = encrypt(JSON.stringify(plain), key);
      const tmp = p.data + '.tmp';
      writeFileSync(tmp, JSON.stringify(blob), 'utf8');
      renameSync(tmp, p.data);
    } finally {
      if (this.dbActive) plain.passwords = savedPw;
    }
  }

  isDbStorageActive(): boolean {
    return this.dbActive && this.dbBackend !== null;
  }

  private plaintextDb(): boolean {
    return Boolean(this.requirePlain().settings.dbStorage?.allowPlaintextStorage);
  }

  private async closeDbStorage(): Promise<void> {
    if (this.dbBackend) {
      try { await this.dbBackend.close(); } catch { /* */ }
    }
    this.dbBackend = null;
    this.dbActive = false;
    // dbOffline left to caller (disable clears; mid-session drop sets it)
  }

  isDbOffline(): boolean {
    return this.dbOffline;
  }

  /** Reject mutating password ops when DB SoT is offline with a read-only cache. */
  private assertDbWritable(): void {
    if (this.dbOffline) {
      throw new Error('Database storage is offline (read-only cache). Reconnect before editing passwords.');
    }
  }

  private markDbLive(): void {
    this.dbOffline = false;
    const s = this.plain?.settings.dbStorage;
    if (s) {
      s.connectionState = 'live';
      s.lastOkAt = new Date().toISOString();
      s.lastError = undefined;
    }
  }

  private markDbOffline(msg: string): void {
    this.dbOffline = true;
    this.dbActive = false;
    if (this.dbBackend) {
      try { void this.dbBackend.close(); } catch { /* */ }
    }
    this.dbBackend = null;
    const s = this.plain?.settings.dbStorage;
    if (s) {
      s.connectionState = 'offline';
      s.lastError = msg.slice(0, 240);
    }
  }

  /**
   * Connect to configured DB storage after unlock.
   * When enabled: DB is sole password backend; loads rows into memory cache.
   * When disabled: closes any open backend; local passwords[] remains SoT.
   */
  /**
   * Connect to configured DB storage after unlock (or reconnect).
   * - disabled: local passwords[] is SoT
   * - enabled + ok: DB is sole SoT; memory cache loaded from DB
   * - enabled + fail at unlock (hadCache=false): passwords cleared, connectionState offline, UI must reconnect
   * - enabled + fail mid-session (hadCache=true): keep memory cache, mark read-only offline
   */
  async syncDbStorage(opts: { hadCache?: boolean } = {}): Promise<{ ok: boolean; count?: number; error?: string; offline?: boolean }> {
    const s = this.requirePlain().settings.dbStorage;
    if (!s?.enabled) {
      await this.closeDbStorage();
      this.dbOffline = false;
      if (s) s.connectionState = 'off';
      return { ok: true, count: this.requirePlain().passwords.length };
    }
    const hadCache = opts.hadCache === true || (this.dbOffline && (this.requirePlain().passwords?.length || 0) > 0);
    try {
      const conn = connFromSettings(s, () => {
        if (!s.passwordEnc) return '';
        return decrypt(s.passwordEnc, this.requireKey()).toString('utf8');
      });
      await this.closeDbStorage();
      this.dbBackend = await openBackend(conn);
      await this.dbBackend.ensureSchema();
      const loaded = await loadPasswordsFromDb(this.dbBackend, this.requireKey());
      this.requirePlain().passwords = loaded;
      this.dbActive = true;
      this.markDbLive();
      this.persist();
      return { ok: true, count: loaded.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (hadCache) {
        // Mid-session: keep cache, read-only
        this.markDbOffline(msg);
        try { this.persist(); } catch { /* */ }
        return { ok: false, error: msg.slice(0, 240), offline: true, count: this.requirePlain().passwords.length };
      }
      // Unlock-time failure: no dual SoT — empty list + block until reconnect
      await this.closeDbStorage();
      this.dbOffline = true;
      this.requirePlain().passwords = [];
      s.connectionState = 'offline';
      s.lastError = msg.slice(0, 240);
      try { this.persist(); } catch { /* */ }
      return { ok: false, error: msg.slice(0, 240), offline: true, count: 0 };
    }
  }

  /** Explicit reconnect after offline / unlock failure. Reloads from DB on success. */
  async reconnectDbStorage(): Promise<{ ok: boolean; count?: number; error?: string }> {
    const s = this.requirePlain().settings.dbStorage;
    if (!s?.enabled) return { ok: false, error: 'Database storage is not enabled' };
    // Prefer preserving mid-session cache if reconnect fails again
    const hadCache = (this.requirePlain().passwords?.length || 0) > 0;
    return this.syncDbStorage({ hadCache });
  }

  /**
   * Enable DB storage: optionally migrate local passwords into DB, then make DB the SoT.
   */
  async enableDbStorage(
    conn: DbConnInput,
    opts: {
      migrateLocal?: boolean;
      allowPlaintext?: boolean;
      onProgress?: (p: { done: number; total: number; phase: string }) => void;
    } = {},
  ): Promise<{ ok: true; migrated: number } | { ok: false; error: string }> {
    try {
      const plain = this.requirePlain();
      const local = plain.passwords.slice();
      await this.closeDbStorage();
      this.dbOffline = false;
      opts.onProgress?.({ done: 0, total: local.length, phase: 'connecting' });
      this.dbBackend = await openBackend(conn);
      await this.dbBackend.ensureSchema();
      let migrated = 0;
      if (opts.migrateLocal !== false && local.length) {
        opts.onProgress?.({ done: 0, total: local.length, phase: 'migrating' });
        migrated = await migrateLocalPasswordsToDb(
          this.dbBackend, local, this.requireKey(), Boolean(opts.allowPlaintext),
          (done, total) => opts.onProgress?.({ done, total, phase: 'migrating' }),
        );
      }
      opts.onProgress?.({ done: migrated, total: local.length, phase: 'loading' });
      const loaded = await loadPasswordsFromDb(this.dbBackend, this.requireKey());
      plain.passwords = loaded;
      this.dbActive = true;
      const ds = plain.settings.dbStorage || (plain.settings.dbStorage = {});
      ds.enabled = true;
      ds.engine = conn.engine;
      ds.sqlitePath = conn.sqlitePath;
      ds.connectionUri = conn.connectionUri;
      ds.host = conn.host;
      ds.port = conn.port;
      ds.user = conn.user;
      ds.database = conn.database;
      ds.ssl = conn.ssl;
      ds.allowPlaintextStorage = Boolean(opts.allowPlaintext);
      if (conn.password) ds.passwordEnc = encrypt(conn.password, this.requireKey());
      this.markDbLive();
      this.persist();
      opts.onProgress?.({ done: loaded.length, total: loaded.length, phase: 'done' });
      return { ok: true, migrated };
    } catch (e) {
      await this.closeDbStorage();
      this.dbOffline = false;
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 240) : 'enable failed' };
    }
  }

  async disableDbStorage(opts: { pullToLocal?: boolean } = {}): Promise<void> {
    const plain = this.requirePlain();
    if (opts.pullToLocal !== false && this.dbActive) {
      // keep current cache in local vault as SoT after disable
      // passwords already in plain.passwords
    } else if (!opts.pullToLocal) {
      // leave passwords as-is in memory; they will persist locally
    }
    await this.closeDbStorage();
    this.dbOffline = false;
    if (plain.settings.dbStorage) {
      plain.settings.dbStorage.enabled = false;
      plain.settings.dbStorage.lastError = undefined;
      plain.settings.dbStorage.connectionState = 'off';
    }
    this.persist();
  }

  getSettings() {
    return this.requirePlain().settings;
  }

  updateSettings(partial: Partial<VaultPlaintext['settings']>): void {
    Object.assign(this.requirePlain().settings, partial);
    this.persist();
  }

  listApplications(): Omit<ApplicationRecord, 'secretEnc'>[] {
    return this.requirePlain().applications.map(({ secretEnc: _, ...rest }) => rest);
  }

  getApplication(id: string): ApplicationRecord | undefined {
    return this.requirePlain().applications.find((a) => a.id === id);
  }

  getSecret(appId: string): string {
    const app = this.getApplication(appId);
    if (!app) throw new Error('Application not found');
    return decrypt(app.secretEnc, this.requireKey()).toString('utf8');
  }

  addApplication(
    kind: ApplicationRecord['kind'],
    name: string,
    secret: string,
    meta: ApplicationRecord['meta'] = {}
  ): Omit<ApplicationRecord, 'secretEnc'> {
    const now = new Date().toISOString();
    const rec: ApplicationRecord = {
      id: generateId('app'),
      kind,
      name,
      secretEnc: encrypt(secret, this.requireKey()),
      meta,
      createdAt: now,
      updatedAt: now,
    };
    this.requirePlain().applications.push(rec);
    this.persist();
    const { secretEnc: _, ...safe } = rec;
    return safe;
  }

  removeApplication(id: string): void {
    const plain = this.requirePlain();
    const app = plain.applications.find((a) => a.id === id);
    if (!app) throw new Error('Application not found');
    if (['demo', 'gmail', 'gcal'].includes(app.kind)) {
      throw new Error('Cannot remove a built-in connection');
    }
    plain.applications = plain.applications.filter((a) => a.id !== id);
    for (const asst of plain.assistants) {
      delete asst.permissions[id];
    }
    this.persist();
  }

  /** Rename, rotate the secret, or fix base URL/header — permissions stay as they are. */
  updateApplication(
    id: string,
    patch: { name?: string; secret?: string; baseUrl?: string; headerName?: string }
  ): Omit<ApplicationRecord, 'secretEnc'> {
    const app = this.getApplication(id);
    if (!app) throw new Error('Application not found');
    if (['demo', 'gmail', 'gcal'].includes(app.kind)) throw new Error('Built-in connections cannot be edited');
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (!n) throw new Error('name required');
      app.name = n;
    }
    if (patch.secret) app.secretEnc = encrypt(String(patch.secret), this.requireKey());
    if (app.kind === 'generic') {
      if (patch.baseUrl !== undefined) app.meta.baseUrl = String(patch.baseUrl).trim().replace(/\/+$/, '') || undefined;
      if (patch.headerName !== undefined) app.meta.headerName = String(patch.headerName).trim() || undefined;
    }
    app.updatedAt = new Date().toISOString();
    this.persist();
    const { secretEnc: _, ...safe } = app;
    return safe;
  }

  listAssistants(): AssistantRecord[] {
    return this.requirePlain().assistants.map((a) => ({ ...a }));
  }

  getAssistant(id: string): AssistantRecord | undefined {
    return this.requirePlain().assistants.find((a) => a.id === id);
  }

  findAssistantByTokenHash(tokenHash: string): AssistantRecord | undefined {
    return this.requirePlain().assistants.find((a) => a.tokenHash === tokenHash);
  }

  addAssistant(
    name: string,
    kind: AssistantRecord['kind'],
    tokenHash: string,
    tokenEnc: EncryptedBlob,
    expiresAt: string | null
  ): AssistantRecord {
    const now = new Date().toISOString();
    const perms: Record<string, PermissionLevel> = {};
    for (const app of this.requirePlain().applications) {
      perms[app.id] = 'off';
    }
    perms[PASSWORDS_PERM_KEY] = 'off';
    const rec: AssistantRecord = {
      id: generateId('asst'),
      name,
      kind,
      tokenHash,
      tokenEnc,
      permissions: perms,
      expiresAt,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.requirePlain().assistants.push(rec);
    this.persist();
    return { ...rec };
  }

  /** Record that an AI assistant just authenticated. Persisted at most once a minute. */
  touchAssistant(id: string): void {
    const asst = this.getAssistant(id);
    if (!asst) return;
    const prev = asst.lastSeenAt ? Date.parse(asst.lastSeenAt) : 0;
    asst.lastSeenAt = new Date().toISOString();
    if (Date.now() - prev > 60_000) this.persist();
  }

  /** Kill switch: turn every AI assistant off at once. Returns how many were on. */
  revokeAllAssistants(): number {
    const plain = this.requirePlain();
    const now = new Date().toISOString();
    let n = 0;
    for (const a of plain.assistants) {
      if (a.enabled) { a.enabled = false; a.updatedAt = now; n++; }
    }
    this.persist();
    return n;
  }

  /** Extend access by `days`, counted from now or from the current end date, whichever is later. */
  renewAssistant(id: string, days: number): AssistantRecord {
    const asst = this.getAssistant(id);
    if (!asst) throw new Error('Assistant not found');
    const from = Math.max(Date.now(), asst.expiresAt ? Date.parse(asst.expiresAt) : 0);
    asst.expiresAt = new Date(from + days * 86400000).toISOString();
    asst.updatedAt = new Date().toISOString();
    this.persist();
    return { ...asst };
  }

  migrationNotes(): MigrationNote[] {
    return (this.requirePlain().settings.migrations || []).filter((n) => !n.dismissed).map((n) => ({ ...n }));
  }

  dismissMigrationNote(id: string): void {
    for (const n of this.requirePlain().settings.migrations || []) {
      if (id === 'all' || n.id === id) n.dismissed = true;
    }
    this.persist();
  }

  updateAssistant(id: string, patch: Partial<Pick<AssistantRecord, 'name' | 'expiresAt' | 'enabled' | 'permissions'>>): AssistantRecord {
    const asst = this.getAssistant(id);
    if (!asst) throw new Error('Assistant not found');
    if (patch.name !== undefined) asst.name = patch.name;
    if (patch.expiresAt !== undefined) asst.expiresAt = patch.expiresAt;
    if (patch.enabled !== undefined) asst.enabled = patch.enabled;
    if (patch.permissions) {
      Object.assign(asst.permissions, patch.permissions);
    }
    asst.updatedAt = new Date().toISOString();
    this.persist();
    return { ...asst };
  }

  setPermission(assistantId: string, appId: string, level: PermissionLevel): void {
    const asst = this.getAssistant(assistantId);
    if (!asst) throw new Error('Assistant not found');
    if (appId !== PASSWORDS_PERM_KEY && !this.getApplication(appId)) throw new Error('Application not found');
    if (appId === PASSWORDS_PERM_KEY && !['off', 'read', 'full'].includes(level)) {
      throw new Error('Passwords permission must be off|read|full');
    }
    asst.permissions[appId] = level;
    asst.updatedAt = new Date().toISOString();
    this.persist();
  }

  removeAssistant(id: string): void {
    const plain = this.requirePlain();
    plain.assistants = plain.assistants.filter((a) => a.id !== id);
    this.persist();
  }

  revealToken(assistantId: string): string | null {
    const asst = this.getAssistant(assistantId);
    if (!asst?.tokenEnc) return null;
    return decrypt(asst.tokenEnc, this.requireKey()).toString('utf8');
  }

  // --- daily limits ---
  utcDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  getDailyLimit(toolKey: string): DailyLimit {
    const plain = this.requirePlain();
    let row = plain.dailyLimits.find((d) => d.toolKey === toolKey);
    const today = this.utcDate();
    if (!row) {
      row = {
        toolKey,
        limit: plain.settings.defaultDailyLimit,
        usedDate: today,
        usedCount: 0,
      };
      plain.dailyLimits.push(row);
      this.persist();
    }
    if (row.usedDate !== today) {
      row.usedDate = today;
      row.usedCount = 0;
      this.persist();
    }
    return { ...row };
  }

  setDailyLimit(toolKey: string, limit: number): DailyLimit {
    const plain = this.requirePlain();
    let row = plain.dailyLimits.find((d) => d.toolKey === toolKey);
    const today = this.utcDate();
    if (!row) {
      row = { toolKey, limit, usedDate: today, usedCount: 0 };
      plain.dailyLimits.push(row);
    } else {
      row.limit = limit;
      if (row.usedDate !== today) {
        row.usedDate = today;
        row.usedCount = 0;
      }
    }
    this.persist();
    return { ...row };
  }

  listDailyLimits(): DailyLimit[] {
    const plain = this.requirePlain();
    const today = this.utcDate();
    for (const row of plain.dailyLimits) {
      if (row.usedDate !== today) {
        row.usedDate = today;
        row.usedCount = 0;
      }
    }
    return plain.dailyLimits.map((d) => ({ ...d }));
  }

  /** Returns false if over limit (does not increment). */
  checkAndIncrementLimit(toolKey: string): { ok: true } | { ok: false; used: number; limit: number } {
    const row = this.getDailyLimit(toolKey);
    // also check wildcard app-level key if specific exists
    if (row.usedCount >= row.limit) {
      return { ok: false, used: row.usedCount, limit: row.limit };
    }
    const plain = this.requirePlain();
    const live = plain.dailyLimits.find((d) => d.toolKey === toolKey)!;
    live.usedCount += 1;
    this.persist();
    return { ok: true };
  }

  // --- activity ---
  addActivity(entry: Omit<ActivityEntry, 'id' | 'at'> & { at?: string }): ActivityEntry {
    const full: ActivityEntry = {
      id: generateId('act'),
      at: entry.at || new Date().toISOString(),
      assistantId: entry.assistantId,
      assistantName: entry.assistantName,
      appId: entry.appId,
      appName: entry.appName,
      action: entry.action,
      ok: entry.ok,
      reason: entry.reason,
      code: entry.code,
    };
    const plain = this.requirePlain();
    plain.activity.unshift(full);
    if (plain.activity.length > 2000) plain.activity.length = 2000;
    this.persist();
    return full;
  }

  listActivity(filter?: {
    ok?: boolean;
    appId?: string;
    assistantId?: string;
    limit?: number;
  }): ActivityEntry[] {
    let rows = this.requirePlain().activity;
    if (filter?.ok !== undefined) rows = rows.filter((r) => r.ok === filter.ok);
    if (filter?.appId) rows = rows.filter((r) => r.appId === filter.appId);
    if (filter?.assistantId) rows = rows.filter((r) => r.assistantId === filter.assistantId);
    const lim = filter?.limit ?? 200;
    return rows.slice(0, lim).map((r) => ({ ...r }));
  }

  changeMasterPassword(oldPassword: string, newPassword: string): void {
    if (!this.unlocked || !this.meta || !this.key || !this.plain) throw new Error('Vault locked');
    if (newPassword.length < 8) throw new Error('New password min 8 chars');
    try {
      const check = decryptWithPassword(this.meta.verifier, oldPassword).toString('utf8');
      if (check !== VERIFIER_PLAIN) throw new Error('bad');
    } catch {
      throw new Error('Current master password is wrong');
    }
    const oldKey = this.key;
    // Derive the NEW key first, then re-encrypt every inner blob old→new.
    // (Bug fixed in 1.3.1: previously blobs were re-encrypted with the old key.)
    const verifier = encryptWithPassword(VERIFIER_PLAIN, newPassword);
    const newKey = deriveKey(newPassword, Buffer.from(verifier.salt, 'hex'));
    const reenc = (blob: EncryptedBlob): EncryptedBlob => {
      const raw = decrypt(blob, oldKey);
      return encrypt(raw, newKey);
    };
    for (const app of this.plain.applications) {
      app.secretEnc = reenc(app.secretEnc);
    }
    for (const asst of this.plain.assistants) {
      if (asst.tokenEnc) asst.tokenEnc = reenc(asst.tokenEnc);
    }
    for (const pe of this.plain.passwords || []) {
      pe.passwordEnc = reenc(pe.passwordEnc);
      if (pe.totpSecretEnc) pe.totpSecretEnc = reenc(pe.totpSecretEnc);
    }
    const g = this.plain.settings.google;
    if (g?.clientSecretEnc) g.clientSecretEnc = reenc(g.clientSecretEnc);
    if (g?.tokensEnc) g.tokensEnc = reenc(g.tokensEnc);
    const db = this.plain.settings.dbStorage;
    if (db?.passwordEnc) db.passwordEnc = reenc(db.passwordEnc);

    this.meta.verifier = verifier;
    this.key = newKey;
    this.persist();
  }

  /** Export encrypted vault files as a single JSON backup (still encrypted — needs master password to unlock after import) */
  exportBackup(): { meta: VaultMeta; data: EncryptedBlob; exportedAt: string } {
    if (!this.exists()) throw new Error('No vault');
    // Prefer on-disk ciphertext so backup is password-gated even if unlocked
    const p = vaultPaths(this.dataDir);
    const meta = JSON.parse(readFileSync(p.meta, 'utf8')) as VaultMeta;
    const data = JSON.parse(readFileSync(p.data, 'utf8')) as EncryptedBlob;
    return { meta, data, exportedAt: new Date().toISOString() };
  }

  importBackup(backup: { meta: VaultMeta; data: EncryptedBlob }, masterPassword: string): void {
    // Verify password against backup verifier
    try {
      const check = decryptWithPassword(backup.meta.verifier, masterPassword).toString('utf8');
      if (check !== VERIFIER_PLAIN) throw new Error('bad');
    } catch {
      throw new Error('Backup password wrong or backup corrupt');
    }
    mkdirSync(this.dataDir, { recursive: true });
    const p = vaultPaths(this.dataDir);
    writeFileSync(p.meta, JSON.stringify(backup.meta, null, 2), 'utf8');
    writeFileSync(p.data, JSON.stringify(backup.data), 'utf8');
    this.lock();
    this.unlock(masterPassword);
  }


  // --- password manager entries ---

  private toPasswordMeta(pe: PasswordEntry): PasswordEntryMeta {
    const { passwordEnc: _pw, totpSecretEnc, ...rest } = pe;
    return { ...rest, hasTotp: Boolean(totpSecretEnc) };
  }

  listPasswords(filter?: { q?: string; tag?: string; favorite?: boolean }): PasswordEntryMeta[] {
    let rows = this.requirePlain().passwords || [];
    if (filter?.favorite !== undefined) rows = rows.filter((p) => Boolean(p.favorite) === filter.favorite);
    if (filter?.tag) rows = rows.filter((p) => (p.tags || []).includes(filter.tag!));
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.username.toLowerCase().includes(q) ||
          (p.url || '').toLowerCase().includes(q) ||
          (p.notes || '').toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    return rows.map((pe) => this.toPasswordMeta(pe));
  }

  getPasswordMeta(id: string): PasswordEntryMeta | undefined {
    const pe = this.requirePlain().passwords.find((p) => p.id === id);
    if (!pe) return undefined;
    return this.toPasswordMeta(pe);
  }

  revealPassword(id: string): string {
    const pe = this.requirePlain().passwords.find((p) => p.id === id);
    if (!pe) throw new Error('Password entry not found');
    return decrypt(pe.passwordEnc, this.requireKey()).toString('utf8');
  }

  /** Decrypt TOTP secret (Base32 canonical). Throws if missing. */
  revealTotpSecret(id: string): string {
    const pe = this.requirePlain().passwords.find((p) => p.id === id);
    if (!pe) throw new Error('Password entry not found');
    if (!pe.totpSecretEnc) throw new Error('No TOTP secret on this item');
    return decrypt(pe.totpSecretEnc, this.requireKey()).toString('utf8');
  }

  hasTotp(id: string): boolean {
    const pe = this.requirePlain().passwords.find((p) => p.id === id);
    return Boolean(pe?.totpSecretEnc);
  }

  async addPassword(input: {
    title: string;
    username?: string;
    password: string;
    url?: string;
    notes?: string;
    tags?: string[];
    favorite?: boolean;
    passwordUpdatedAt?: string;
    /** Raw TOTP secret or otpauth:// — canonicalized + encrypted */
    totp?: string | null;
  }): Promise<PasswordEntryMeta> {
    this.assertDbWritable();
    const title = String(input.title || '').trim();
    if (!title) throw new Error('title required');
    if (!input.password) throw new Error('password required');
    const now = new Date().toISOString();
    const rec: PasswordEntry = {
      id: generateId('pwd'),
      title,
      username: String(input.username || ''),
      passwordEnc: encrypt(input.password, this.requireKey()),
      url: input.url ? String(input.url) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
      tags: input.tags?.map(String).filter(Boolean),
      favorite: Boolean(input.favorite),
      createdAt: now,
      updatedAt: now,
      passwordUpdatedAt: input.passwordUpdatedAt || now,
    };
    if (input.totp) {
      const { canonicalizeTotpSecret } = await import('../shared/totp.js');
      const secret = canonicalizeTotpSecret(String(input.totp));
      rec.totpSecretEnc = encrypt(secret, this.requireKey());
    }
    this.requirePlain().passwords.push(rec);
    if (this.dbActive && this.dbBackend) {
      try {
        await upsertPasswordToDb(this.dbBackend, rec, this.requireKey(), this.plaintextDb());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.markDbOffline(msg);
        throw new Error(`Database write failed (now offline/read-only): ${msg.slice(0, 180)}`);
      }
    }
    this.persist();
    return this.toPasswordMeta(rec);
  }

  async updatePassword(
    id: string,
    patch: {
      title?: string;
      username?: string;
      password?: string;
      url?: string | null;
      notes?: string | null;
      tags?: string[];
      favorite?: boolean;
      /** Set TOTP secret (otpauth/Base32); empty string or null clears */
      totp?: string | null;
    }
  ): Promise<PasswordEntryMeta> {
    this.assertDbWritable();
    const pe = this.requirePlain().passwords.find((p) => p.id === id);
    if (!pe) throw new Error('Password entry not found');
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new Error('title required');
      pe.title = title;
    }
    if (patch.username !== undefined) pe.username = String(patch.username);
    if (patch.password !== undefined && patch.password !== '') {
      pe.passwordEnc = encrypt(patch.password, this.requireKey());
      pe.passwordUpdatedAt = new Date().toISOString();
    }
    if (patch.url !== undefined) pe.url = patch.url ? String(patch.url) : undefined;
    if (patch.notes !== undefined) pe.notes = patch.notes ? String(patch.notes) : undefined;
    if (patch.tags !== undefined) pe.tags = patch.tags.map(String).filter(Boolean);
    if (patch.favorite !== undefined) pe.favorite = Boolean(patch.favorite);
    if (patch.totp !== undefined) {
      if (patch.totp === null || String(patch.totp).trim() === '') {
        delete pe.totpSecretEnc;
      } else {
        const { canonicalizeTotpSecret } = await import('../shared/totp.js');
        const secret = canonicalizeTotpSecret(String(patch.totp));
        pe.totpSecretEnc = encrypt(secret, this.requireKey());
      }
    }
    pe.updatedAt = new Date().toISOString();
    if (this.dbActive && this.dbBackend) {
      try {
        await upsertPasswordToDb(this.dbBackend, pe, this.requireKey(), this.plaintextDb());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.markDbOffline(msg);
        throw new Error(`Database write failed (now offline/read-only): ${msg.slice(0, 180)}`);
      }
    }
    this.persist();
    return this.toPasswordMeta(pe);
  }

  /** Ids of entries (other than `exceptId`) whose stored password equals `value`. Never returns values. */
  findPasswordReuse(value: string, exceptId?: string): PasswordEntryMeta[] {
    if (!value) return [];
    const key = this.requireKey();
    const out: PasswordEntryMeta[] = [];
    for (const pe of this.requirePlain().passwords) {
      if (pe.id === exceptId) continue;
      let v = '';
      try { v = decrypt(pe.passwordEnc, key).toString('utf8'); } catch { continue; }
      if (v === value) out.push(this.toPasswordMeta(pe));
    }
    return out;
  }

  /** Decrypt-all pass for the security dashboard: returns grouping info, never values. */
  passwordValuesForAudit(): Array<{ meta: PasswordEntryMeta; value: string }> {
    const key = this.requireKey();
    return this.requirePlain().passwords.map((pe) => {
      const meta = this.toPasswordMeta(pe);
      let value = '';
      try { value = decrypt(pe.passwordEnc, key).toString('utf8'); } catch { /* unreadable */ }
      return { meta, value };
    });
  }

  /**
   * Import password rows. Modes:
   * - skip: leave existing URL+username matches alone
   * - update: overwrite matching URL+username (password/title/notes/tags)
   * - all: always create new items
   * Never logs plaintext passwords.
   */
  async importPasswords(
    rows: Array<{
      title: string;
      username?: string;
      password: string;
      url?: string;
      notes?: string;
      tags?: string[];
      totp?: string;
    }>,
    mode: 'skip' | 'update' | 'all' = 'skip'
  ): Promise<{ imported: number; updated: number; skipped: number; failed: number; errors: string[] }> {
    const hostOf = (u?: string) => {
      if (!u) return '';
      try {
        return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        return u.toLowerCase();
      }
    };
    const keyOf = (url: string | undefined, username: string) =>
      `${hostOf(url)}\0${(username || '').trim().toLowerCase()}`;

    const existing = new Map<string, string>(); // key -> id
    for (const pe of this.requirePlain().passwords) {
      existing.set(keyOf(pe.url, pe.username), pe.id);
    }

    let imported = 0, updated = 0, skipped = 0, failed = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r || !String(r.password || '')) {
          failed++;
          errors.push(`row ${i + 1}: password required`);
          continue;
        }
        const title = String(r.title || '').trim() || 'Imported item';
        const username = String(r.username || '');
        const url = r.url ? String(r.url) : undefined;
        const k = keyOf(url, username);
        const matchId = k !== '\0' && hostOf(url) ? existing.get(k) : undefined;
        if (matchId && mode === 'skip') {
          skipped++;
          continue;
        }
        const totp = r.totp ? String(r.totp) : undefined;
        if (matchId && mode === 'update') {
          await this.updatePassword(matchId, {
            title,
            username,
            password: String(r.password),
            url: url ?? null,
            notes: r.notes != null ? String(r.notes) : undefined,
            tags: r.tags,
            totp: totp ?? undefined,
          });
          updated++;
          continue;
        }
        const meta = await this.addPassword({
          title,
          username,
          password: String(r.password),
          url,
          notes: r.notes != null ? String(r.notes) : undefined,
          tags: r.tags,
          totp,
        });
        existing.set(keyOf(meta.url, meta.username), meta.id);
        imported++;
      } catch (e) {
        failed++;
        errors.push(`row ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    return { imported, updated, skipped, failed, errors: errors.slice(0, 20) };
  }

  async removePassword(id: string): Promise<void> {
    this.assertDbWritable();
    const plain = this.requirePlain();
    const before = plain.passwords.length;
    plain.passwords = plain.passwords.filter((p) => p.id !== id);
    if (plain.passwords.length === before) throw new Error('Password entry not found');
    if (this.dbActive && this.dbBackend) {
      try {
        await removePasswordFromDb(this.dbBackend, id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.markDbOffline(msg);
        throw new Error(`Database delete failed (now offline/read-only): ${msg.slice(0, 180)}`);
      }
    }
    this.persist();
  }

  rotateAssistantToken(id: string): string {
    const asst = this.getAssistant(id);
    if (!asst) throw new Error('Assistant not found');
    const token = generateToken();
    asst.tokenHash = hashToken(token);
    asst.tokenEnc = this.encryptForVault(token);
    asst.updatedAt = new Date().toISOString();
    this.persist();
    return token;
  }
}


