import type { Express, Response } from 'express';
import type { VaultStore } from '../store/db.js';
import { generateToken, hashToken } from '../crypto/vault.js';
import { scrubError } from './security.js';
import { mountAutofillApi, parseAutofillSettings } from './autofill.js';
import { APP_VERSION } from '../types/index.js';
import type { AssistantKind, PermissionLevel } from '../types/index.js';
import { invokeTool, listToolsForAssistant } from './tools.js';
import { LEVELS, isLevel, levelsForPasswords } from '../connectors/permissions.js';
import { USER_APP_KINDS } from '../types/index.js';
import { resolvedPresets, presetBaseUrl } from '../connectors/preset-base.js';
import { getPreset } from '../shared/presets.js';
import { buildSetup } from './setup.js';
import { isDevMode } from './devmode.js';
import { PASSWORDS_PERM_KEY } from '../types/index.js';
import { generate, normalizePrefs, GeneratorError, type GenOptions } from '../shared/generator.js';
import { estimateStrength, masterPasswordProblems } from '../shared/strength.js';
import { testConnector, siteInfo } from './assist.js';
import { parseImportFile, importMatchKey, formatLabel } from '../shared/import-passwords.js';
import { generateTotp } from '../shared/totp.js';
import {
  testDbConnection, publicDbStorage, connFromSettings,
} from './db-storage.js';
import { DEFAULT_QC_HOTKEY, DEFAULT_SAVE_HOTKEY } from '../shared/autofill-match.js';
import {
  buildAuthUrl,
  clearGoogleTokens,
  exchangeCode,
  getGoogleSettings,
  hasGoogleClient,
  isGoogleConnected,
  saveGoogleClient,
} from '../connectors/google-oauth.js';

const ASSISTANT_KINDS: AssistantKind[] = ['claude-desktop', 'cursor', 'claude-code', 'terminal', 'custom'];
const DURATIONS: Record<string, number> = { '1d': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '1y': 365 * 864e5 };

function escapeHtml(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Bearer or X-VaultAI-Token header only — never the query string or the body. */
function tokenFrom(req: { headers: Record<string, unknown> }): string {
  const auth = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  if (req.headers['x-vaultai-token']) return String(req.headers['x-vaultai-token']).trim();
  return '';
}

/** Password audit shared by the Security check and the Home dashboard. Values never leave the server. */
function passwordHealth(store: VaultStore) {
  const rows = store.passwordValuesForAudit();
  const now = Date.now();
  const brief = (m: { id: string; title: string; username: string; url?: string }) => ({ id: m.id, title: m.title, username: m.username, url: m.url });
  const weak = rows.map((r) => ({ r, s: estimateStrength(r.value) })).filter((x) => x.s.score <= 1)
    .map((x) => ({ ...brief(x.r.meta), score: x.s.score, bits: x.s.bits, reasons: x.s.warnings }));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) if (r.value) groups.set(r.value, [...(groups.get(r.value) || []), r]);
  const reused = [...groups.values()].filter((g) => g.length > 1).map((g, i) => ({ group: i + 1, entries: g.map((r) => brief(r.meta)) }));
  const ageDays = (r: (typeof rows)[number]) => Math.floor((now - new Date(r.meta.passwordUpdatedAt || r.meta.createdAt).getTime()) / 864e5);
  const old = rows.filter((r) => ageDays(r) > 180).map((r) => ({ ...brief(r.meta), days: ageDays(r) }));
  const bad = new Set([...weak.map((w) => w.id), ...reused.flatMap((g) => g.entries.map((e) => e.id)), ...old.map((o) => o.id)]);
  const score = rows.length ? Math.round(((rows.length - bad.size) / rows.length) * 100) : 100;
  return { total: rows.length, score, issues: bad.size, weak, reused, reusedCount: reused.reduce((a, g) => a + g.entries.length, 0), old };
}

/** Tool keys for the daily-limit form, derived from what is actually connected. */
function limitSuggestions(store: VaultStore): string[] {
  const keys = new Set<string>(['generator:password', 'passwords:list', 'passwords:get', 'passwords:get_password']);
  const actions: Record<string, string[]> = {
    github: ['list_repos', 'search_repos', 'list_issues', 'get_issue', 'list_prs', 'create_issue'],
    notion: ['search', 'get_page', 'get_blocks', 'create_page', 'append_blocks'],
    stripe: ['list_customers', 'list_charges', 'list_payment_intents', 'create_customer'],
    gmail: ['search', 'get', 'list_labels', 'create_draft', 'modify', 'archive', 'send'],
    gcal: ['list_calendars', 'list_events', 'get_event', 'create_event'],
    generic: ['http_request'],
  };
  if (isDevMode()) actions.demo = ['echo', 'ping'];
  for (const a of store.listApplications()) {
    if ((a.kind === 'gmail' || a.kind === 'gcal') && !a.meta.connected) continue;
    for (const act of actions[a.kind] || []) keys.add(`${a.kind}:${act}`);
  }
  return [...keys].sort();
}

function requireUnlocked(store: VaultStore, res: Response): boolean {
  if (!store.unlocked) {
    res.status(423).json({ ok: false, code: 'VAULT_LOCKED', message: 'Vault locked' });
    return false;
  }
  return true;
}

export function mountApi(app: Express, store: VaultStore): void {
  app.get(['/api/health', '/health'], (_req, res) => {
    res.json({
      ok: true,
      service: 'VaultAI',
      version: APP_VERSION,
      unlocked: store.unlocked,
      exists: store.exists(),
      dataDir: store.getDataDir(),
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get('/api/status', (_req, res) => {
    const settings = { port: store.getListenPort(), host: store.getClientHost() };
    res.json({
      ok: true,
      unlocked: store.unlocked,
      exists: store.exists(),
      mcpUrl: `http://${settings.host}:${settings.port}/mcp`,
      host: settings.host,
      port: settings.port,
    });
  });

  app.post('/api/vault/create', async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      const problems = masterPasswordProblems(password);
      if (problems.length) {
        return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', problems, message: 'Master password too weak: ' + problems.join(', ') });
      }
      if (store.exists()) {
        return res.status(409).json({ ok: false, code: 'EXISTS', message: 'Vault already exists' });
      }
      store.create(password);
      await store.syncDbStorage();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e instanceof Error ? e.message : 'create failed' });
    }
  });

  app.post('/api/vault/unlock', async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      store.unlock(password);
      const db = await store.syncDbStorage();
      res.json({ ok: true, dbStorage: db });
    } catch (e) {
      res.status(401).json({ ok: false, code: 'BAD_PASSWORD', message: e instanceof Error ? e.message : 'unlock failed' });
    }
  });

  app.post('/api/vault/lock', (_req, res) => {
    store.lock();
    res.json({ ok: true });
  });

  // Applications
  app.get('/api/applications', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    res.json({ ok: true, applications: store.listApplications() });
  });

  app.post('/api/applications', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const kind = String(req.body?.kind || '') as (typeof USER_APP_KINDS)[number];
      const name = String(req.body?.name || '').trim();
      const secret = String(req.body?.secret || '');
      if (!(USER_APP_KINDS as readonly string[]).includes(kind)) {
        return res.status(400).json({ ok: false, code: 'BAD_KIND', message: 'kind must be ' + USER_APP_KINDS.join('|') });
      }
      if ((kind === 'notion' || kind === 'stripe') && store.listApplications().some((a) => a.kind === kind)) {
        return res.status(409).json({ ok: false, code: 'EXISTS', message: `${kind} already connected — edit or remove it first` });
      }
      if (!name || !secret) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'name and secret required' });
      const meta: Record<string, string | undefined> = { notes: req.body?.notes ? String(req.body.notes) : undefined };
      if (kind === 'generic') {
        const preset = getPreset(req.body?.preset ? String(req.body.preset) : 'custom');
        const baseUrl = String(req.body?.baseUrl || (preset.id === 'custom' ? '' : presetBaseUrl(preset.id))).trim().replace(/\/+$/, '');
        if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
          return res.status(400).json({ ok: false, code: 'BAD_URL', message: 'baseUrl must start with https:// — AI requests are limited to this address' });
        }
        meta.preset = preset.id;
        meta.baseUrl = baseUrl;
        meta.headerName = String(req.body?.headerName || preset.headerName).trim() || 'Authorization';
        meta.authScheme = preset.id === 'custom' ? (meta.headerName.toLowerCase() === 'authorization' ? 'bearer' : 'raw') : preset.authScheme;
      }
      const created = store.addApplication(kind, name, secret, meta as never);
      for (const asst of store.listAssistants()) store.setPermission(asst.id, created.id, 'off');
      res.json({ ok: true, application: created });
    } catch (e) {
      res.status(500).json({ ok: false, message: scrubError(e) });
    }
  });

  app.patch('/api/applications/:id', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const b = req.body || {};
      if (b.baseUrl !== undefined && b.baseUrl !== '' && !/^https?:\/\/[^/\s]+/i.test(String(b.baseUrl))) {
        return res.status(400).json({ ok: false, code: 'BAD_URL', message: 'baseUrl must start with https://' });
      }
      const updated = store.updateApplication(req.params.id, {
        name: b.name !== undefined ? String(b.name) : undefined,
        secret: b.secret ? String(b.secret) : undefined,
        baseUrl: b.baseUrl !== undefined ? String(b.baseUrl) : undefined,
        headerName: b.headerName !== undefined ? String(b.headerName) : undefined,
      });
      res.json({ ok: true, application: updated });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.get('/api/presets', (_req, res) => {
    res.json({ ok: true, presets: resolvedPresets() });
  });

  app.delete('/api/applications/:id', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      store.removeApplication(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: e instanceof Error ? e.message : 'remove failed' });
    }
  });

  // Assistants
  app.get('/api/assistants', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const list = store.listAssistants().map((a) => ({
      ...a,
      tokenHash: undefined,
      tokenEnc: undefined,
      hasToken: true,
    }));
    res.json({ ok: true, assistants: list });
  });

  app.post('/api/assistants', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const name = String(req.body?.name || '');
      const kind = String(req.body?.kind || 'custom') as AssistantKind;
      if (!name) return res.status(400).json({ ok: false, message: 'name required' });
      if (!ASSISTANT_KINDS.includes(kind)) return res.status(400).json({ ok: false, code: 'BAD_KIND', message: 'kind must be ' + ASSISTANT_KINDS.join('|') });

      let expiresAt: string | null = null;
      const dur = req.body?.duration; // 1d|7d|30d|1y|null
      if (dur && dur !== 'none') {
        const add = DURATIONS[String(dur)];
        if (!add) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'duration must be 1d|7d|30d|1y|none' });
        expiresAt = new Date(Date.now() + add).toISOString();
      }

      const token = generateToken();
      const tokenEnc = store.encryptForVault(token);
      const asst = store.addAssistant(name, kind, hashToken(token), tokenEnc, expiresAt);
      res.json({
        ok: true,
        assistant: {
          id: asst.id,
          name: asst.name,
          kind: asst.kind,
          expiresAt: asst.expiresAt,
          enabled: asst.enabled,
          permissions: asst.permissions,
        },
        token, // stored encrypted; viewable later in the assistant's setup
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e instanceof Error ? e.message : 'add failed' });
    }
  });

  app.patch('/api/assistants/:id', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const patch: Record<string, unknown> = {};
      if (req.body?.name !== undefined) patch.name = String(req.body.name);
      if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
      if (req.body?.expiresAt !== undefined) patch.expiresAt = req.body.expiresAt;
      if (req.body?.duration !== undefined) {
        const dur = req.body.duration;
        if (!dur || dur === 'none') patch.expiresAt = null;
        else {
          const add = DURATIONS[String(dur)];
          if (add) patch.expiresAt = new Date(Date.now() + add).toISOString();
        }
      }
      const asst = store.updateAssistant(req.params.id, patch as never);
      res.json({ ok: true, assistant: { ...asst, tokenHash: undefined, tokenEnc: undefined } });
    } catch (e) {
      res.status(400).json({ ok: false, message: e instanceof Error ? e.message : 'update failed' });
    }
  });

  app.post('/api/assistants/:id/reveal-token', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const token = store.revealToken(req.params.id);
    if (!token) return res.status(404).json({ ok: false, message: 'Token not stored' });
    res.json({ ok: true, token });
  });

  // Kill switch — turn every AI assistant off at once
  app.post('/api/assistants/revoke-all', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const count = store.revokeAllAssistants();
    store.addActivity({ assistantId: null, assistantName: 'VaultAI', appId: null, appName: '-', action: 'vault:revoke_all', ok: true, reason: `${count} turned off` });
    res.json({ ok: true, count });
  });

  app.post('/api/assistants/:id/renew', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const days = Number(req.body?.days ?? 7);
      if (!Number.isInteger(days) || days < 1 || days > 366) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'days must be 1–366' });
      const a = store.renewAssistant(req.params.id, days);
      res.json({ ok: true, expiresAt: a.expiresAt });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.get('/api/assistants/:id/setup', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const a = store.getAssistant(req.params.id);
    if (!a) return res.status(404).json({ ok: false, message: 'not found' });
    const token = store.revealToken(a.id);
    if (!token) return res.status(404).json({ ok: false, message: 'Token not stored — rotate it first' });
    res.json({ ok: true, setup: buildSetup(a, token, store.getClientHost(), store.getListenPort()) });
  });

  app.delete('/api/assistants/:id', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    store.removeAssistant(req.params.id);
    res.json({ ok: true });
  });

  // Permissions — apply immediately
  app.get('/api/permissions', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const apps = store.listApplications();
    // Virtual row for password-manager permission
    const withPasswords = [
      ...apps,
      {
        id: PASSWORDS_PERM_KEY,
        kind: 'passwords' as const,
        name: 'Passwords',
        meta: { notes: 'Password manager — Off / Read / Full' },
        createdAt: '',
        updatedAt: '',
      },
    ];
    res.json({
      ok: true,
      applications: withPasswords,
      assistants: store.listAssistants().map((a) => ({
        id: a.id,
        name: a.name,
        permissions: a.permissions,
        enabled: a.enabled,
        expiresAt: a.expiresAt,
      })),
      passwordsKey: PASSWORDS_PERM_KEY,
    });
  });

  app.put('/api/permissions/:assistantId/:appId', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const level = String(req.body?.level || 'off') as PermissionLevel;
      if (!isLevel(level)) {
        return res.status(400).json({ ok: false, message: 'invalid permission level' });
      }
      store.setPermission(req.params.assistantId, req.params.appId, level);
      res.json({ ok: true, level });
    } catch (e) {
      res.status(400).json({ ok: false, message: e instanceof Error ? e.message : 'set failed' });
    }
  });

  // Daily limits
  app.get('/api/limits', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    res.json({
      ok: true,
      limits: store.listDailyLimits(),
      defaultDailyLimit: store.getSettings().defaultDailyLimit,
      utcDate: store.utcDate(),
      suggestions: limitSuggestions(store),
    });
  });

  app.put('/api/limits/:toolKey', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const limit = Number(req.body?.limit);
    if (!Number.isFinite(limit) || limit < 0) {
      return res.status(400).json({ ok: false, message: 'limit must be >= 0' });
    }
    const toolKey = decodeURIComponent(req.params.toolKey);
    const row = store.setDailyLimit(toolKey, limit);
    res.json({ ok: true, limit: row });
  });

  app.put('/api/settings/default-limit', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const n = Number(req.body?.defaultDailyLimit);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ ok: false, message: 'invalid' });
    store.updateSettings({ defaultDailyLimit: n });
    res.json({ ok: true });
  });

  // Activity
  app.get('/api/activity', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const okParam = req.query.ok;
    res.json({
      ok: true,
      activity: store.listActivity({
        ok: okParam === 'true' ? true : okParam === 'false' ? false : undefined,
        appId: typeof req.query.appId === 'string' ? req.query.appId : undefined,
        assistantId: typeof req.query.assistantId === 'string' ? req.query.assistantId : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 200,
      }),
    });
  });

  // CLI / local tool invoke with assistant token
  app.post('/api/tool/invoke', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const token = tokenFrom(req as never);
    if (!token) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', message: 'token required' });
    const asst = store.findAssistantByTokenHash(hashToken(token));
    if (!asst) return res.status(401).json({ ok: false, code: 'AUTH_INVALID', message: 'bad token' });
    store.touchAssistant(asst.id);
    const name = String(req.body?.name || '');
    const args = (req.body?.arguments || {}) as Record<string, unknown>;
    const result = await invokeTool({ store, assistant: asst }, name, args);
    res.status(result.ok ? 200 : 403).json(result);
  });

  app.get('/api/tool/ls', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const token = tokenFrom(req as never);
    if (!token) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', message: 'token required' });
    const asst = store.findAssistantByTokenHash(hashToken(token));
    if (!asst) return res.status(401).json({ ok: false, code: 'AUTH_INVALID', message: 'bad token' });
    store.touchAssistant(asst.id);
    res.json({ ok: true, tools: listToolsForAssistant(store, asst) });
  });

  // One ladder for every connection; passwords have no "write"
  app.get('/api/permission-levels', (_req, res) => {
    res.json({ ok: true, levels: LEVELS, passwordsKey: PASSWORDS_PERM_KEY, passwordsLevels: levelsForPasswords() });
  });

  // Google OAuth settings + connect
  app.get('/api/google/status', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const g = getGoogleSettings(store);
    res.json({
      ok: true,
      configured: hasGoogleClient(store),
      connected: isGoogleConnected(store),
      clientId: g?.clientId ? g.clientId.slice(0, 12) + '…' : null,
      email: g?.email || null,
      connectedAt: g?.connectedAt || null,
      redirectUri: `http://127.0.0.1:${store.getListenPort()}/oauth/google/callback`,
      scopes: [
        'gmail.modify', 'gmail.compose', 'gmail.send',
        'calendar', 'openid email profile',
      ],
    });
  });

  app.post('/api/google/client', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const clientId = String(req.body?.clientId || '').trim();
      const clientSecret = String(req.body?.clientSecret || '').trim();
      if (!clientId || !clientSecret) {
        return res.status(400).json({ ok: false, message: 'clientId and clientSecret required' });
      }
      saveGoogleClient(store, clientId, clientSecret);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e instanceof Error ? e.message : 'save failed' });
    }
  });

  app.post('/api/google/connect', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const port = store.getListenPort();
      const redirectUri = `http://127.0.0.1:${port}/oauth/google/callback`;
      const { url } = buildAuthUrl(store, redirectUri);
      res.json({ ok: true, url, redirectUri });
    } catch (e) {
      res.status(400).json({ ok: false, message: e instanceof Error ? e.message : 'connect failed' });
    }
  });

  app.post('/api/google/disconnect', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    clearGoogleTokens(store);
    res.json({ ok: true });
  });


  // --- v1.2 vault UX ---
  app.post('/api/vault/change-password', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const oldPassword = String(req.body?.oldPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      const problems = masterPasswordProblems(newPassword);
      if (problems.length) {
        return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', problems, message: 'New master password too weak: ' + problems.join(', ') });
      }
      if (newPassword === oldPassword) {
        return res.status(400).json({ ok: false, code: 'SAME_PASSWORD', message: 'New master password must differ from the current one' });
      }
      store.changeMasterPassword(oldPassword, newPassword);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.get('/api/vault/export', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const backup = store.exportBackup();
      res.json({ ok: true, backup });
    } catch (e) {
      res.status(500).json({ ok: false, message: scrubError(e) });
    }
  });

  app.post('/api/vault/import', (req, res) => {
    if (store.exists() && !store.unlocked) {
      return res.status(423).json({
        ok: false,
        code: 'VAULT_LOCKED',
        message: 'Unlock the current vault before importing a backup',
      });
    }
    try {
      const backup = req.body?.backup;
      const password = String(req.body?.password || '');
      if (!backup?.meta || !backup?.data) {
        return res.status(400).json({ ok: false, message: 'backup.meta and backup.data required' });
      }
      store.importBackup(backup, password);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.post('/api/assistants/:id/rotate-token', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const token = store.rotateAssistantToken(req.params.id);
      res.json({ ok: true, token });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.get('/api/settings', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const s = store.getSettings();
    res.json({
      ok: true,
      settings: {
        port: s.port,
        host: s.host,
        defaultDailyLimit: s.defaultDailyLimit,
        idleLockMinutes: s.idleLockMinutes ?? 30,
        onboardingDismissed: Boolean(s.onboardingDismissed),
        rateLimitPerMinute: s.rateLimitPerMinute ?? 120,
        language: s.language || 'zh-CN',
        clipboardClearSeconds: s.clipboardClearSeconds ?? 30,
        fetchSiteIcons: s.fetchSiteIcons !== false,
        generatorPrefs: s.generatorPrefs || null,
        autofillEnabled: s.autofillEnabled !== false,
        autofillTextTrigger: s.autofillTextTrigger ?? 'pp',
        autofillHotkey: s.autofillHotkey ?? 'CommandOrControl+Shift+P',
        autofillConfirm: Boolean(s.autofillConfirm),
        quickCreateHotkey: s.quickCreateHotkey ?? DEFAULT_QC_HOTKEY,
        saveLoginHotkey: s.saveLoginHotkey ?? DEFAULT_SAVE_HOTKEY,
        dbStorage: publicDbStorage(s.dbStorage, Boolean(s.dbStorage?.passwordEnc)),
        dbStorageActive: store.isDbStorageActive(),
        dbStorageOffline: store.isDbOffline(),
      },
      version: APP_VERSION,
      dataDir: store.getDataDir(),
    });
  });

  app.put('/api/settings', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const patch: Record<string, unknown> = {};
      if (req.body?.idleLockMinutes !== undefined) {
        const n = Number(req.body.idleLockMinutes);
        if (!Number.isInteger(n) || n < 0 || n > 1440) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'idleLockMinutes must be an integer 0–1440' });
        patch.idleLockMinutes = n;
      }
      if (req.body?.onboardingDismissed !== undefined) patch.onboardingDismissed = Boolean(req.body.onboardingDismissed);
      if (req.body?.rateLimitPerMinute !== undefined) {
        const n = Number(req.body.rateLimitPerMinute);
        if (!Number.isInteger(n) || n < 10 || n > 10000) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'rateLimitPerMinute must be an integer 10–10000' });
        patch.rateLimitPerMinute = n;
      }
      if (req.body?.defaultDailyLimit !== undefined) {
        patch.defaultDailyLimit = Number(req.body.defaultDailyLimit);
      }
      if (req.body?.language !== undefined) {
        const lang = String(req.body.language);
        if (lang !== 'zh-CN' && lang !== 'en') {
          return res.status(400).json({ ok: false, message: 'language must be zh-CN or en' });
        }
        patch.language = lang;
      }
      if (req.body?.clipboardClearSeconds !== undefined) {
        const n = Number(req.body.clipboardClearSeconds);
        if (!Number.isInteger(n) || n < 0 || n > 600) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'clipboardClearSeconds must be an integer 0–600' });
        patch.clipboardClearSeconds = n;
      }
      if (req.body?.fetchSiteIcons !== undefined) patch.fetchSiteIcons = Boolean(req.body.fetchSiteIcons);
      const af = parseAutofillSettings(req.body || {});
      if (af.error) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: af.error });
      Object.assign(patch, af.patch);

      if (req.body?.quickCreateHotkey !== undefined) {
        const hk = String(req.body.quickCreateHotkey || '').trim() || DEFAULT_QC_HOTKEY;
        if (hk.length > 80) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'quickCreateHotkey too long' });
        patch.quickCreateHotkey = hk;
      }
      if (req.body?.saveLoginHotkey !== undefined) {
        const hk = String(req.body.saveLoginHotkey || '').trim() || DEFAULT_SAVE_HOTKEY;
        if (hk.length > 80) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'saveLoginHotkey too long' });
        patch.saveLoginHotkey = hk;
      }

      if (req.body?.generatorPrefs !== undefined && req.body.generatorPrefs !== null && typeof req.body.generatorPrefs === 'object') {
        patch.generatorPrefs = normalizePrefs(req.body.generatorPrefs as Record<string, unknown>);
      }
      store.updateSettings(patch as never);
      res.json({ ok: true, settings: store.getSettings() });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  // --- Password manager (v1.3) ---
  app.get('/api/passwords', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    const favorite =
      req.query.favorite === 'true' ? true : req.query.favorite === 'false' ? false : undefined;
    res.json({ ok: true, passwords: store.listPasswords({ q, tag, favorite }) });
  });


  // Password import (1.7.0): Password Depot CSV/XML + generic CSV. Preview never returns plaintext passwords.
  app.post('/api/passwords/import/preview', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const text = String(req.body?.text || '');
      const filename = req.body?.filename != null ? String(req.body.filename) : undefined;
      if (text.length > 8_000_000) {
        return res.status(400).json({ ok: false, message: 'File too large (max 8 MB)' });
      }
      const parsed = parseImportFile(text, filename);
      const existing = store.listPasswords();
      const have = new Set(existing.map((p) => importMatchKey(p.url, p.username)));
      const sample = parsed.rows.slice(0, 50).map((r, i) => {
        const key = importMatchKey(r.url, r.username);
        const dup = Boolean(key !== '\0' && r.url && have.has(key));
        return {
          index: i,
          title: r.title,
          username: r.username,
          url: r.url || '',
          notes: r.notes ? String(r.notes).slice(0, 80) : '',
          tags: r.tags || [],
          hasPassword: Boolean(r.password),
          hasTotp: Boolean(r.totp),
          duplicate: dup,
        };
      });
      const dupCount = parsed.rows.filter((r) => {
        const key = importMatchKey(r.url, r.username);
        return Boolean(r.url && key !== '\0' && have.has(key));
      }).length;
      res.json({
        ok: true,
        format: parsed.format,
        formatLabel: formatLabel(parsed.format),
        delimiter: parsed.delimiter || null,
        warnings: parsed.warnings,
        total: parsed.rows.length,
        duplicates: dupCount,
        withPassword: parsed.rows.filter((r) => r.password).length,
        withTotp: parsed.rows.filter((r) => r.totp).length,
        sample,
        // rows kept only for commit in the same session via client re-send; preview omits secrets
      });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.post('/api/passwords/import', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const text = String(req.body?.text || '');
      const filename = req.body?.filename != null ? String(req.body.filename) : undefined;
      const modeRaw = String(req.body?.mode || 'skip');
      const mode = (modeRaw === 'update' || modeRaw === 'all' || modeRaw === 'skip') ? modeRaw : 'skip';
      if (text.length > 8_000_000) {
        return res.status(400).json({ ok: false, message: 'File too large (max 8 MB)' });
      }
      const parsed = parseImportFile(text, filename);
      if (!parsed.rows.length) {
        return res.status(400).json({ ok: false, message: 'No importable rows', format: parsed.format, warnings: parsed.warnings });
      }
      const result = await store.importPasswords(
        parsed.rows.map((r) => ({
          title: r.title,
          username: r.username,
          password: r.password,
          url: r.url,
          notes: r.notes,
          tags: r.tags,
          totp: r.totp,
        })),
        mode
      );
      store.addActivity({
        assistantId: null,
        assistantName: 'UI',
        appId: PASSWORDS_PERM_KEY,
        appName: 'Passwords',
        action: 'passwords:import',
        ok: true,
        reason: `${parsed.format} mode=${mode} imported=${result.imported} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`,
      });
      res.json({ ok: true, format: parsed.format, warnings: parsed.warnings, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.get('/api/passwords/:id', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const meta = store.getPasswordMeta(req.params.id);
    if (!meta) return res.status(404).json({ ok: false, message: 'not found' });
    res.json({ ok: true, password: meta });
  });

  app.get('/api/passwords/:id/reveal', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const value = store.revealPassword(req.params.id);
      store.addActivity({
        assistantId: null,
        assistantName: 'UI',
        appId: PASSWORDS_PERM_KEY,
        appName: 'Passwords',
        action: 'passwords:reveal',
        ok: true,
      });
      res.json({ ok: true, password: value });
    } catch (e) {
      res.status(404).json({ ok: false, message: e instanceof Error ? e.message : 'not found' });
    }
  });

  /** Current TOTP code (6 digits + countdown). Secret never returned. */
  app.get('/api/passwords/:id/totp', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      if (!store.hasTotp(req.params.id)) {
        return res.status(404).json({ ok: false, message: 'No TOTP on this item' });
      }
      const secret = store.revealTotpSecret(req.params.id);
      const code = generateTotp({ secret });
      res.json({ ok: true, code: code.code, remaining: code.remaining, period: code.period, digits: code.digits });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.post('/api/passwords', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.map(String)
        : typeof req.body?.tags === 'string'
          ? String(req.body.tags).split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)
          : undefined;
      const entry = await store.addPassword({
        title: String(req.body?.title || ''),
        username: req.body?.username != null ? String(req.body.username) : '',
        password: String(req.body?.password || ''),
        url: req.body?.url != null ? String(req.body.url) : undefined,
        notes: req.body?.notes != null ? String(req.body.notes) : undefined,
        tags,
        favorite: Boolean(req.body?.favorite),
        passwordUpdatedAt: process.env.VAULTAI_TEST_HOOKS === '1' && req.body?.passwordUpdatedAt ? String(req.body.passwordUpdatedAt) : undefined,
        totp: req.body?.totp != null && String(req.body.totp).trim() !== '' ? String(req.body.totp) : undefined,
      });
      res.json({ ok: true, password: entry });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.patch('/api/passwords/:id', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const tags = req.body?.tags === undefined
        ? undefined
        : Array.isArray(req.body.tags)
          ? req.body.tags.map(String)
          : String(req.body.tags).split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
      const totpPatch = req.body?.totp === undefined
        ? undefined
        : (req.body.totp === null || String(req.body.totp).trim() === '' ? null : String(req.body.totp));
      const entry = await store.updatePassword(req.params.id, {
        title: req.body?.title,
        username: req.body?.username,
        password: req.body?.password,
        url: req.body?.url,
        notes: req.body?.notes,
        tags,
        favorite: req.body?.favorite,
        totp: totpPatch,
      });
      res.json({ ok: true, password: entry });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  app.delete('/api/passwords/:id', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      await store.removePassword(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  // Password generator — no vault access needed (pure CSPRNG); same engine as UI, CLI and MCP.
  const genHandler = (req: { body?: Record<string, unknown> }, res: Response) => {
    try {
      const body = (req.body || {}) as GenOptions & { digits?: boolean; symbols?: boolean };
      const r = generate(body);
      const s = estimateStrength(r.value);
      res.json({ ok: true, password: r.value, ...r, strength: { score: s.score, bits: s.bits } });
    } catch (e) {
      if (e instanceof GeneratorError) return res.status(400).json({ ok: false, code: e.code, message: e.message });
      res.status(500).json({ ok: false, message: scrubError(e) });
    }
  };
  app.post('/api/generate', genHandler);

  // Duplicate (same site + username) and reused-password checks for the entry form.
  app.post('/api/passwords/check', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const id = req.body?.id ? String(req.body.id) : undefined;
    const password = req.body?.password ? String(req.body.password) : '';
    const hostOf = (u?: string) => { try { return u ? new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } };
    const host = hostOf(req.body?.url ? String(req.body.url) : '');
    const user = String(req.body?.username || '').trim().toLowerCase();
    const all = store.listPasswords();
    const duplicates = host
      ? all.filter((p) => p.id !== id && hostOf(p.url) === host && (p.username || '').trim().toLowerCase() === user).map((p) => ({ id: p.id, title: p.title }))
      : [];
    const reusedBy = password ? store.findPasswordReuse(password, id).map((p) => ({ id: p.id, title: p.title })) : [];
    res.json({ ok: true, duplicates, reusedBy });
  });

  // Security check: weak / reused / old (>180 days)
  app.get('/api/password-health', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    res.json({ ok: true, ...passwordHealth(store) });
  });

  // Home dashboard: onboarding state, what each AI can reach now, today's activity, notices
  app.get('/api/overview', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const apps = store.listApplications();
    const byId = new Map(apps.map((a) => [a.id, a]));
    const userApps = apps.filter((a) => (USER_APP_KINDS as readonly string[]).includes(a.kind) || ((a.kind === 'gmail' || a.kind === 'gcal') && a.meta.connected));
    const assistants = store.listAssistants();
    const now = Date.now();
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = store.listActivity({ limit: 2000 }).filter((r) => Date.parse(r.at) >= midnight.getTime());
    const health = passwordHealth(store);
    const s = store.getSettings();
    res.json({
      ok: true,
      counts: { connections: userApps.length, passwords: health.total, assistants: assistants.length },
      onboarding: {
        vault: true,
        credential: userApps.length > 0 || health.total > 0,
        assistant: assistants.length > 0,
        connected: assistants.some((a) => Boolean(a.lastSeenAt)),
        dismissed: Boolean(s.onboardingDismissed),
      },
      assistants: assistants.map((a) => ({
        id: a.id, name: a.name, kind: a.kind, enabled: a.enabled, expiresAt: a.expiresAt, lastSeenAt: a.lastSeenAt || null,
        expired: Boolean(a.expiresAt && now > Date.parse(a.expiresAt)),
        access: Object.entries(a.permissions)
          .filter(([, lvl]) => lvl !== 'off')
          .map(([id, level]) => (id === PASSWORDS_PERM_KEY
            ? { id, name: 'Passwords', kind: 'passwords', level }
            : { id, name: byId.get(id)?.name || id, kind: byId.get(id)?.kind || '', level }))
          // Unconnected Google gives no real access, so it is not shown
          .filter((x) => x.kind && !((x.kind === 'gmail' || x.kind === 'gcal') && !byId.get(x.id)?.meta.connected)),
      })),
      today: {
        ok: today.filter((r) => r.ok && r.assistantId).length,
        refused: today.filter((r) => !r.ok).length,
        recent: today.filter((r) => r.assistantId).slice(0, 5),
      },
      health: { total: health.total, score: health.score, issues: health.issues },
      notices: store.migrationNotes(),
    });
  });

  app.post('/api/migrations/:id/dismiss', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    store.dismissMigrationNote(req.params.id);
    res.json({ ok: true });
  });

  // Website name + icon for the entry form / list (offline-safe; SSRF-guarded)
  app.get('/api/site-info', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    const allow = store.getSettings().fetchSiteIcons !== false;
    res.json(await siteInfo(url, allow));
  });

  // Connector "Test connection": unsaved credentials (from the form) or a saved application.
  app.post('/api/applications/test', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const kind = String(req.body?.kind || '');
    const secret = String(req.body?.secret || '');
    const preset = req.body?.preset ? String(req.body.preset) : undefined;
    const p = getPreset(preset);
    res.json(await testConnector(kind, secret, {
      baseUrl: req.body?.baseUrl || (preset && preset !== 'custom' ? presetBaseUrl(preset) : undefined),
      headerName: req.body?.headerName || (preset ? p.headerName : undefined),
      preset,
      authScheme: preset && preset !== 'custom' ? p.authScheme : undefined,
    }));
  });
  app.post('/api/applications/:id/test', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const a = store.getApplication(req.params.id);
    if (!a) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'application not found' });
    if (a.kind === 'gmail' || a.kind === 'gcal') {
      const g = getGoogleSettings(store);
      return res.json({ ok: isGoogleConnected(store), kind: a.kind, account: g?.email, warnings: [], code: isGoogleConnected(store) ? undefined : 'NOT_CONNECTED' });
    }
    if (a.kind === 'demo') return res.json({ ok: true, kind: a.kind, account: 'built-in', warnings: [] });
    let secret = '';
    try { secret = store.getSecret(a.id); } catch { /* none */ }
    res.json(await testConnector(a.kind, secret, a.meta || {}));
  });

  // OAuth loopback callback (browser redirect — vault must already be unlocked in this process)
  app.get('/oauth/google/callback', async (req, res) => {
    try {
      if (!store.unlocked) {
        res.status(423).send('<h1>Vault locked</h1><p>Unlock VaultAI, then try Connect again.</p>');
        return;
      }
      const err = req.query.error;
      if (err) {
        res.status(400).send(`<h1>OAuth error</h1><pre>${escapeHtml(err)}</pre>`);
        return;
      }
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code || !state) {
        res.status(400).send('<h1>Missing code/state</h1>');
        return;
      }
      const port = store.getListenPort();
      const redirectUri = `http://127.0.0.1:${port}/oauth/google/callback`;
      const { email } = await exchangeCode(store, code, state, redirectUri);
      res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;background:#f7f2f9">
        <h1 style="color:#4a2558">Google connected</h1>
        <p>Account: <strong>${escapeHtml(email)}</strong></p>
        <p>Gmail and Google Calendar are ready. You can close this tab and return to VaultAI.</p>
        <script>setTimeout(()=>window.close(),1500)</script>
      </body></html>`);
    } catch (e) {
      res.status(500).send(`<h1>OAuth failed</h1><pre>${escapeHtml(scrubError(e))}</pre>`);
    }
  });


  // --- Database storage for passwords (1.8.0): direct CRUD, not backup ---
  app.get('/api/db-storage', (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    const s = store.getSettings();
    res.json({
      ok: true,
      dbStorage: publicDbStorage(s.dbStorage, Boolean(s.dbStorage?.passwordEnc)),
      active: store.isDbStorageActive(),
      offline: store.isDbOffline(),
    });
  });

  app.post('/api/db-storage/reconnect', async (_req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const r = await store.reconnectDbStorage();
      store.addActivity({
        assistantId: null, assistantName: 'VaultAI', appId: null, appName: 'db-storage',
        action: r.ok ? 'db:reconnect:ok' : 'db:reconnect:fail', ok: r.ok,
        reason: r.ok ? `count=${r.count}` : (r.error || 'fail'),
      });
      if (!r.ok) return res.status(400).json({ ok: false, error: r.error, offline: store.isDbOffline(), count: r.count });
      res.json({
        ok: true,
        count: r.count,
        active: store.isDbStorageActive(),
        offline: store.isDbOffline(),
        dbStorage: publicDbStorage(store.getSettings().dbStorage, Boolean(store.getSettings().dbStorage?.passwordEnc)),
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: scrubError(e) });
    }
  });

  app.post('/api/db-storage/test', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const body = req.body || {};
      const s = store.getSettings().dbStorage;
      const password = body.password != null && body.password !== '' ? String(body.password) : undefined;
      const conn = connFromSettings(
        {
          ...(s || {}),
          engine: body.engine || s?.engine,
          sqlitePath: body.sqlitePath ?? s?.sqlitePath,
          connectionUri: body.connectionUri ?? s?.connectionUri,
          host: body.host ?? s?.host,
          port: body.port != null && body.port !== '' ? Number(body.port) : s?.port,
          user: body.user ?? s?.user,
          database: body.database ?? s?.database,
          ssl: body.ssl ?? s?.ssl,
        },
        () => {
          if (!s?.passwordEnc) return '';
          return store.decryptBlob(s.passwordEnc);
        },
        { password },
      );
      const r = await testDbConnection(conn);
      if (!r.ok) {
        store.addActivity({ assistantId: null, assistantName: 'VaultAI', appId: null, appName: 'db-storage', action: 'db:test:fail', ok: false, reason: r.error });
        return res.status(400).json(r);
      }
      store.addActivity({ assistantId: null, assistantName: 'VaultAI', appId: null, appName: 'db-storage', action: 'db:test:ok', ok: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: scrubError(e) });
    }
  });

  app.put('/api/db-storage', async (req, res) => {
    if (!requireUnlocked(store, res)) return;
    try {
      const body = req.body || {};
      const enable = Boolean(body.enabled);
      const allowPlaintext = Boolean(body.allowPlaintextStorage);
      if (allowPlaintext && body.confirmPlaintext !== true) {
        return res.status(400).json({ ok: false, code: 'CONFIRM_PLAINTEXT', message: 'confirmPlaintext:true required to store plaintext in DB' });
      }
      const s = store.getSettings().dbStorage;
      const conn = connFromSettings(
        {
          ...(s || {}),
          engine: body.engine || s?.engine || 'sqlite',
          sqlitePath: body.sqlitePath ?? s?.sqlitePath,
          connectionUri: body.connectionUri ?? s?.connectionUri,
          host: body.host ?? s?.host,
          port: body.port != null ? Number(body.port) : s?.port,
          user: body.user ?? s?.user,
          database: body.database ?? s?.database,
          ssl: body.ssl ?? s?.ssl,
        },
        () => {
          if (body.password != null && body.password !== '') return String(body.password);
          if (!s?.passwordEnc) return '';
          return store.decryptBlob(s.passwordEnc);
        },
        { password: body.password != null && body.password !== '' ? String(body.password) : undefined },
      );
      if (!enable) {
        await store.disableDbStorage({ pullToLocal: true });
        store.addActivity({ assistantId: null, assistantName: 'VaultAI', appId: null, appName: 'db-storage', action: 'db:disable', ok: true });
        return res.json({ ok: true, active: false, dbStorage: publicDbStorage(store.getSettings().dbStorage, Boolean(store.getSettings().dbStorage?.passwordEnc)) });
      }
      const r = await store.enableDbStorage(conn, {
        migrateLocal: body.migrateLocal !== false,
        allowPlaintext,
      });
      if (!r.ok) {
        store.addActivity({ assistantId: null, assistantName: 'VaultAI', appId: null, appName: 'db-storage', action: 'db:enable:fail', ok: false, reason: r.error });
        return res.status(400).json(r);
      }
      store.addActivity({
        assistantId: null, assistantName: 'VaultAI', appId: null, appName: 'db-storage',
        action: 'db:enable:ok', ok: true, reason: `migrated=${r.migrated}`,
      });
      res.json({
        ok: true,
        active: store.isDbStorageActive(),
        migrated: r.migrated,
        dbStorage: publicDbStorage(store.getSettings().dbStorage, Boolean(store.getSettings().dbStorage?.passwordEnc)),
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: scrubError(e) });
    }
  });

  mountAutofillApi(app, store);
}
