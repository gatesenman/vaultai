/**
 * Human autofill API (1.6.0). Independent of AI/MCP password permissions.
 * Never logs plaintext secrets. Picker uses /search (metadata) then /prepare (one-shot secret).
 */
import type { Express, Request, Response } from 'express';
import type { VaultStore } from '../store/db.js';
import { rankAutofillMatches, DEFAULT_HOTKEY, DEFAULT_TEXT_TRIGGER } from '../shared/autofill-match.js';
import { generateTotp } from '../shared/totp.js';
import { scrubError } from './security.js';

const prepareHits = new Map<string, number[]>(); // ip → timestamps
const PREPARE_LIMIT = 30; // per minute

function rateOk(ip: string): boolean {
  const now = Date.now();
  const arr = (prepareHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= PREPARE_LIMIT) { prepareHits.set(ip, arr); return false; }
  arr.push(now); prepareHits.set(ip, arr); return true;
}

function requireUnlocked(store: VaultStore, res: Response): boolean {
  if (!store.unlocked) { res.status(423).json({ ok: false, code: 'VAULT_LOCKED', message: 'Vault is locked' }); return false; }
  return true;
}

export function mountAutofillApi(app: Express, store: VaultStore): void {
  app.get('/api/autofill/status', (_req, res) => {
    const s = store.exists() && store.unlocked ? store.getSettings() : null;
    res.json({
      ok: true,
      unlocked: store.unlocked,
      exists: store.exists(),
      enabled: s ? s.autofillEnabled !== false : false,
      textTrigger: s?.autofillTextTrigger ?? DEFAULT_TEXT_TRIGGER,
      hotkey: s?.autofillHotkey ?? DEFAULT_HOTKEY,
      confirm: Boolean(s?.autofillConfirm),
      clipboardClearSeconds: s?.clipboardClearSeconds ?? 30,
      language: s?.language || 'zh-CN',
    });
  });

  app.post('/api/autofill/search', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const s = store.getSettings();
    if (s.autofillEnabled === false) return res.status(403).json({ ok: false, code: 'AUTOFILL_OFF', message: 'Autofill is disabled' });
    try {
      const typed = typeof req.body?.typed === 'string' ? req.body.typed : '';
      const host = typeof req.body?.host === 'string' ? req.body.host : '';
      const windowTitle = typeof req.body?.windowTitle === 'string' ? req.body.windowTitle : '';
      const processName = typeof req.body?.processName === 'string' ? req.body.processName : '';
      const entries = store.listPasswords().map((p) => ({
        id: p.id, title: p.title, username: p.username, url: p.url, tags: p.tags, favorite: p.favorite, updatedAt: p.updatedAt, hasTotp: Boolean(p.hasTotp),
      }));
      const matches = rankAutofillMatches(entries, { typed, host, windowTitle, processName });
      res.json({
        ok: true,
        matches: matches.map(({ score, reasons, ...m }) => m), // UI doesn't need score; keep ranking order
        context: { typed, host, windowTitle, processName },
        detection: {
          // Honest about what we got — empty means unavailable
          hasTyped: Boolean(typed),
          hasHost: Boolean(host),
          hasWindowTitle: Boolean(windowTitle),
        },
      });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });

  /** One-shot: return username+password for fill. Logged without the secret. */
  app.post('/api/autofill/prepare', (req, res) => {
    if (!requireUnlocked(store, res)) return;
    const s = store.getSettings();
    if (s.autofillEnabled === false) return res.status(403).json({ ok: false, code: 'AUTOFILL_OFF', message: 'Autofill is disabled' });
    const ip = String(req.ip || req.socket.remoteAddress || '');
    if (!rateOk(ip)) return res.status(429).json({ ok: false, code: 'RATE_LIMIT', message: 'Too many autofill requests' });
    try {
      const id = String(req.body?.id || '');
      if (!id) return res.status(400).json({ ok: false, code: 'BAD_ARGS', message: 'id required' });
      const meta = store.listPasswords().find((p) => p.id === id);
      if (!meta) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Entry not found' });
      const password = store.revealPassword(id);
      let totp: { code: string; remaining: number; period: number } | null = null;
      if (meta.hasTotp) {
        try {
          const secret = store.revealTotpSecret(id);
          const c = generateTotp({ secret });
          totp = { code: c.code, remaining: c.remaining, period: c.period };
        } catch { totp = null; }
      }
      store.addActivity({
        assistantId: null,
        assistantName: 'VaultAI',
        appId: null,
        appName: 'autofill',
        action: 'autofill:used',
        ok: true,
        reason: (meta.title || meta.username || id) + (totp ? '+totp' : ''),
      });
      res.json({
        ok: true,
        username: meta.username || '',
        password,
        title: meta.title,
        hasTotp: Boolean(meta.hasTotp),
        totp,
        clearAfterSec: s.clipboardClearSeconds ?? 30,
      });
    } catch (e) {
      res.status(400).json({ ok: false, message: scrubError(e) });
    }
  });
}

/** Validate autofill settings patch fields. Returns error message or null. */
export function parseAutofillSettings(body: Record<string, unknown>): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};
  if (body.autofillEnabled !== undefined) patch.autofillEnabled = Boolean(body.autofillEnabled);
  if (body.autofillConfirm !== undefined) patch.autofillConfirm = Boolean(body.autofillConfirm);
  if (body.autofillTextTrigger !== undefined) {
    const t = String(body.autofillTextTrigger);
    if (t.length > 16) return { patch, error: 'autofillTextTrigger too long (max 16)' };
    if (t && !/^[A-Za-z0-9]+$/.test(t)) return { patch, error: 'autofillTextTrigger must be letters/digits only (or empty to disable)' };
    patch.autofillTextTrigger = t;
  }
  if (body.autofillHotkey !== undefined) {
    const h = String(body.autofillHotkey).trim();
    if (h.length > 64) return { patch, error: 'autofillHotkey too long' };
    // Electron accelerator-ish: allow empty to mean "hotkey off"
    if (h && !/^[A-Za-z0-9+]+$/.test(h.replace(/CommandOrControl|CmdOrCtrl|Control|Ctrl|Command|Cmd|Alt|Option|Shift|Super|Meta/g, 'X'))) {
      return { patch, error: 'autofillHotkey looks invalid' };
    }
    patch.autofillHotkey = h || 'CommandOrControl+Shift+P';
  }
  return { patch };
}
