/**
 * Vault data migration (schema 1 → 2, VaultAI 1.3.x/1.4.0 → 1.5.0).
 * Pure function over the decrypted plaintext; idempotent. Never drops a user secret:
 * removed connector kinds that held a user key are converted in place (same id, same
 * encrypted secret, same permission levels). Only built-in records without a user secret
 * (Web Fetch, Demo) are deleted. Every user-visible change produces a note.
 */
import { SCHEMA_VERSION, PASSWORDS_PERM_KEY } from '../types/index.js';
import type { MigrationNote } from '../types/index.js';
import { getPreset } from '../shared/presets.js';
import { presetBaseUrl } from '../connectors/preset-base.js';

export type NoteInput = Omit<MigrationNote, 'id' | 'at'>;

export interface MigrationResult {
  fromVersion: number;
  changed: boolean;
  notes: NoteInput[];
}

const CONVERT_TO_PRESET = ['linear', 'sentry', 'slack'];
const VALID_LEVELS = ['off', 'read', 'write', 'full'];
const VALID_ASSISTANT_KINDS = ['claude-desktop', 'cursor', 'claude-code', 'terminal', 'custom'];

/* eslint-disable @typescript-eslint/no-explicit-any */
export function migrateVault(plain: any, opts: { dev: boolean }): MigrationResult {
  const notes: NoteInput[] = [];
  plain.applications = Array.isArray(plain.applications) ? plain.applications : [];
  plain.assistants = Array.isArray(plain.assistants) ? plain.assistants : [];
  plain.dailyLimits = Array.isArray(plain.dailyLimits) ? plain.dailyLimits : [];
  plain.activity = Array.isArray(plain.activity) ? plain.activity : [];
  plain.passwords = Array.isArray(plain.passwords) ? plain.passwords : [];
  plain.settings = plain.settings && typeof plain.settings === 'object' ? plain.settings : {};
  const s = plain.settings;
  const fromVersion = Number(s.schemaVersion || 1);
  let changed = false;

  // Settings defaults (1.3.x vaults lack some of these)
  const defaults: Record<string, unknown> = {
    port: 3847, host: '127.0.0.1', defaultDailyLimit: 100, idleLockMinutes: 30, rateLimitPerMinute: 120,
    language: 'zh-CN', clipboardClearSeconds: 30, fetchSiteIcons: true,
    autofillEnabled: true, autofillTextTrigger: 'pp',
    autofillHotkey: 'CommandOrControl+Shift+P', autofillConfirm: false,
    quickCreateHotkey: 'CommandOrControl+Shift+N',
    dbStorage: { enabled: false, engine: 'sqlite', allowPlaintextStorage: false },
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (s[k] === undefined) { s[k] = v; changed = true; }
  }

  if (fromVersion < 2) {
    changed = true;
    const assistantsWith = (appId: string) =>
      plain.assistants.filter((a: any) => a.permissions && a.permissions[appId] && a.permissions[appId] !== 'off');

    // 1. Linear / Sentry / Slack → Generic HTTP preset (same id, same secretEnc, same levels)
    for (const app of plain.applications) {
      if (CONVERT_TO_PRESET.includes(app.kind)) {
        const preset = getPreset(app.kind);
        const old = app.kind;
        app.kind = 'generic';
        app.meta = {
          ...(app.meta || {}),
          preset: preset.id,
          baseUrl: presetBaseUrl(preset.id),
          headerName: preset.headerName,
          authScheme: preset.authScheme,
        };
        delete app.meta.template;
        app.updatedAt = new Date().toISOString();
        notes.push({ code: 'mig.converted', params: { name: app.name, preset: preset.name, from: old } });
      } else if (app.kind === 'generic') {
        app.meta = app.meta || {};
        delete app.meta.template;
        if (!app.meta.preset) app.meta.preset = 'custom';
        if (!app.meta.baseUrl) notes.push({ code: 'mig.noBase', params: { name: app.name } });
      }
    }

    // 2. Built-ins without a user secret that no longer exist (Web Fetch; Demo outside dev mode)
    for (const app of plain.applications.filter((a: any) => a.kind === 'web')) {
      const users = assistantsWith(app.id).length;
      if (users) notes.push({ code: 'mig.webRemoved', params: { count: users } });
    }
    if (!opts.dev) {
      for (const app of plain.applications.filter((a: any) => a.kind === 'demo')) {
        const users = assistantsWith(app.id).length;
        if (users) notes.push({ code: 'mig.demoRemoved', params: { count: users } });
      }
    }
    const gone = (a: any) => a.kind === 'web' || (!opts.dev && a.kind === 'demo');
    const removedIds = new Set(plain.applications.filter(gone).map((a: any) => a.id));
    plain.applications = plain.applications.filter((a: any) => !removedIds.has(a.id));

    // 3. Assistants: client kind + permission ladder
    for (const a of plain.assistants) {
      if (a.kind === 'chatgpt') {
        a.kind = 'custom';
        notes.push({ code: 'mig.chatgpt', params: { assistant: a.name } });
      } else if (!VALID_ASSISTANT_KINDS.includes(a.kind)) {
        a.kind = 'custom';
      }
      a.permissions = a.permissions || {};
      for (const [appId, level] of Object.entries<any>(a.permissions)) {
        if (level === 'manage') a.permissions[appId] = 'write'; // drafts + labels + archive = write
        else if (level === 'draft') {
          a.permissions[appId] = 'read'; // never escalate
          const app = plain.applications.find((x: any) => x.id === appId);
          notes.push({ code: 'mig.gmailDraft', params: { assistant: a.name, app: app?.name || 'Gmail' } });
        } else if (!VALID_LEVELS.includes(level)) a.permissions[appId] = 'off';
      }
    }

    // 4. Daily limits for tools that no longer exist
    const goneKey = (k: string) => /^(linear|sentry|slack|web):/.test(k) || (!opts.dev && /^demo:/.test(k));
    const goneKeys = plain.dailyLimits.filter((d: any) => goneKey(String(d.toolKey)));
    const custom = goneKeys.filter((d: any) => Number(d.limit) !== Number(s.defaultDailyLimit));
    if (custom.length) notes.push({ code: 'mig.limits', params: { keys: custom.map((d: any) => d.toolKey).join(', ') } });
    plain.dailyLimits = plain.dailyLimits.filter((d: any) => !goneKeys.includes(d));

    // 5. Password folders → tags
    let moved = 0;
    for (const p of plain.passwords) {
      if (p.folder) {
        const tags: string[] = Array.isArray(p.tags) ? p.tags : [];
        if (!tags.includes(p.folder)) tags.push(p.folder);
        p.tags = tags;
        moved++;
      }
      if ('folder' in p) delete p.folder;
    }
    if (moved) notes.push({ code: 'mig.folders', params: { count: moved } });

    // 6. Settings that never worked
    delete s.allowNonLoopback;
  }

  if (fromVersion < 3) {
    changed = true;
    if (s.autofillEnabled === undefined) s.autofillEnabled = true;
    if (s.autofillTextTrigger === undefined) s.autofillTextTrigger = 'pp';
    if (s.autofillHotkey === undefined) s.autofillHotkey = 'CommandOrControl+Shift+P';
    if (s.autofillConfirm === undefined) s.autofillConfirm = false;
    notes.push({ code: 'mig.autofill', params: {} });
  }

  if (fromVersion < 4) {
    changed = true;
    if (s.quickCreateHotkey === undefined) s.quickCreateHotkey = 'CommandOrControl+Shift+N';
    if (!s.dbStorage || typeof s.dbStorage !== 'object') {
      s.dbStorage = { enabled: false, engine: 'sqlite', allowPlaintextStorage: false };
    } else {
      if (s.dbStorage.allowPlaintextStorage === undefined) s.dbStorage.allowPlaintextStorage = false;
      if (s.dbStorage.enabled === undefined) s.dbStorage.enabled = false;
      if (!s.dbStorage.engine) s.dbStorage.engine = 'sqlite';
    }
    notes.push({ code: 'mig.dbStorage', params: {} });
  }

  if (fromVersion < 5) {
    changed = true;
    if (s.saveLoginHotkey === undefined) s.saveLoginHotkey = 'CommandOrControl+Shift+S';
    if (s.dbStorage && typeof s.dbStorage === 'object' && s.dbStorage.connectionState === undefined) {
      s.dbStorage.connectionState = s.dbStorage.enabled ? 'live' : 'off';
    }
    notes.push({ code: 'mig.v19', params: {} });
  }

  s.schemaVersion = SCHEMA_VERSION;

  // Always: drop permission keys that point at nothing; passwords key defaults to off
  const ids = new Set(plain.applications.map((a: any) => a.id));
  for (const a of plain.assistants) {
    a.permissions = a.permissions || {};
    for (const k of Object.keys(a.permissions)) {
      if (k !== PASSWORDS_PERM_KEY && !ids.has(k)) { delete a.permissions[k]; changed = true; }
    }
    if (a.permissions[PASSWORDS_PERM_KEY] === undefined) { a.permissions[PASSWORDS_PERM_KEY] = 'off'; changed = true; }
    if (a.permissions[PASSWORDS_PERM_KEY] === 'write') { a.permissions[PASSWORDS_PERM_KEY] = 'read'; changed = true; }
  }
  return { fromVersion, changed, notes };
}
