/**
 * One permission ladder for every connection (1.5.0):
 * off → read (view) → write (create/modify) → full (irreversible or sensitive).
 * The password vault uses off/read/full only.
 */
export type PermissionLevel = 'off' | 'read' | 'write' | 'full';

/** The AI client — decides which setup snippet VaultAI generates. */
export type AssistantKind = 'claude-desktop' | 'cursor' | 'claude-code' | 'terminal' | 'custom';

/** 'demo' only exists when VAULTAI_DEV=1. */
export type AppKind = 'github' | 'generic' | 'notion' | 'stripe' | 'gmail' | 'gcal' | 'demo';

/** Kinds a user can add from the Connections page. */
export const USER_APP_KINDS = ['github', 'generic', 'notion', 'stripe'] as const;
export type UserAppKind = (typeof USER_APP_KINDS)[number];

/** Current vault data schema. 1 = 1.3.x/1.4.0, 2 = 1.5.0, 3 = 1.6.0 (autofill), 4 = 1.8.0 (quick-create + DB storage), 5 = 1.9.0 (TOTP + save-login + multi-import + DB resilience) */
export const SCHEMA_VERSION = 5;

/** Special permission key for password-manager entries (not an ApplicationRecord) */
export const PASSWORDS_PERM_KEY = 'passwords';

export type UiLanguage = 'zh-CN' | 'en';

export interface EncryptedBlob {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  /** Password ciphertext — never stored plaintext */
  passwordEnc: EncryptedBlob;
  /** TOTP secret ciphertext (Base32 / otpauth) — never stored plaintext */
  totpSecretEnc?: EncryptedBlob;
  url?: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
  /** When the password value itself last changed (for "old password" health checks) */
  passwordUpdatedAt?: string;
}

/** Safe list view — no password / TOTP secret */
export type PasswordEntryMeta = Omit<PasswordEntry, 'passwordEnc' | 'totpSecretEnc'> & {
  /** True when a TOTP secret is stored for this item */
  hasTotp?: boolean;
};

export interface ApplicationRecord {
  id: string;
  kind: AppKind;
  name: string;
  secretEnc: EncryptedBlob;
  meta: {
    baseUrl?: string;
    headerName?: string;
    username?: string;
    notes?: string;
    email?: string;
    connected?: boolean;
    /** Generic HTTP preset id (linear, sentry, slack, custom) */
    preset?: string;
    /** How the secret is sent: 'bearer' adds "Bearer " to Authorization; 'raw' sends it as-is */
    authScheme?: 'bearer' | 'raw';
  };
  createdAt: string;
  updatedAt: string;
}

export interface AssistantRecord {
  id: string;
  name: string;
  kind: AssistantKind;
  tokenHash: string;
  tokenEnc?: EncryptedBlob;
  permissions: Record<string, PermissionLevel>;
  expiresAt: string | null;
  enabled: boolean;
  /** Last authenticated MCP/CLI request (persisted at most once a minute) */
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyLimit {
  toolKey: string;
  limit: number;
  usedDate: string;
  usedCount: number;
}

export interface ActivityEntry {
  id: string;
  at: string;
  assistantId: string | null;
  assistantName: string;
  appId: string | null;
  appName: string;
  action: string;
  ok: boolean;
  reason?: string;
  code?: string;
}

export interface VaultMeta {
  version: 1;
  createdAt: string;
  verifier: EncryptedBlob;
}

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecretEnc?: EncryptedBlob;
  tokensEnc?: EncryptedBlob;
  email?: string;
  connectedAt?: string;
}

export interface VaultSettings {
  port: number;
  host: string;
  defaultDailyLimit: number;
  /** Idle lock minutes; 0 = disabled */
  idleLockMinutes: number;
  /** Max MCP/API requests per minute per IP */
  rateLimitPerMinute: number;
  /** UI language */
  language: UiLanguage;
  /** Seconds after which a copied secret is wiped from the clipboard (0 = never) */
  clipboardClearSeconds?: number;
  /** Fetch website names/icons for password entries (contacts the site) */
  fetchSiteIcons?: boolean;
  /** Remembered password-generator options */
  generatorPrefs?: Record<string, unknown>;
  google?: GoogleOAuthSettings;
  /** User hid the first-run checklist */
  onboardingDismissed?: boolean;
  /** Data schema version (see SCHEMA_VERSION) */
  schemaVersion?: number;
  /** Notes written by upgrades, shown on Home until dismissed */
  migrations?: MigrationNote[];
  /** Human autofill (picker) — independent of AI/MCP password permissions */
  autofillEnabled?: boolean;
  /** Opt-in text trigger (default "pp"); empty string disables text trigger */
  autofillTextTrigger?: string;
  /** Electron accelerator, default CommandOrControl+Shift+P */
  autofillHotkey?: string;
  /** Require an extra click/Enter confirmation before pasting the password */
  autofillConfirm?: boolean;
  /** Global hotkey for tray quick-create (default CommandOrControl+Shift+N) */
  quickCreateHotkey?: string;
  /**
   * Global hotkey to save a new login from the focused field (default CommandOrControl+Shift+S).
   * Opens caret mini sheet; does not keylog — only reads focus after the hotkey.
   */
  saveLoginHotkey?: string;
  /**
   * Optional database storage for password entries (1.8.0).
   * When enabled, password CRUD uses the connected DB as the sole backend;
   * local vault file keeps master key + settings (passwords array cleared).
   */
  dbStorage?: DbStorageSettings;
}

export type DbEngine = 'sqlite' | 'postgres' | 'mysql';

/** Database storage connector settings. DB password encrypted with vault key. */
export interface DbStorageSettings {
  enabled?: boolean;
  engine?: DbEngine;
  /** Absolute path for SQLite file (engine=sqlite) */
  sqlitePath?: string;
  /** Full connection URI for postgres/mysql */
  connectionUri?: string;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  ssl?: boolean;
  /** Server DB password ciphertext */
  passwordEnc?: EncryptedBlob;
  /**
   * Dangerous: store password/username/notes as plaintext columns.
   * Default OFF — fields encrypted with vault AES-GCM (EncryptedBlob JSON).
   */
  allowPlaintextStorage?: boolean;
  /** Last successful schema ensure / connect */
  lastOkAt?: string;
  /** Scrubbed error (no secrets) */
  lastError?: string;
  /**
   * Connection health while enabled.
   * live = connected; offline = enabled but disconnected (read-only memory cache);
   * unset/off when disabled.
   */
  connectionState?: 'live' | 'offline' | 'off';
}

export interface MigrationNote {
  id: string;
  at: string;
  /** i18n key, e.g. 'mig.converted' */
  code: string;
  /** Values for the message */
  params: Record<string, string | number>;
  dismissed?: boolean;
}

export interface VaultPlaintext {
  applications: ApplicationRecord[];
  assistants: AssistantRecord[];
  dailyLimits: DailyLimit[];
  activity: ActivityEntry[];
  settings: VaultSettings;
  passwords: PasswordEntry[];
}

export interface Refusal {
  ok: false;
  code: string;
  message: string;
  fix?: string;
}

export interface Success<T = unknown> {
  ok: true;
  data: T;
}

export type ToolResult<T = unknown> = Success<T> | Refusal;

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
  scope?: string;
}

export const APP_VERSION = '1.9.0';
