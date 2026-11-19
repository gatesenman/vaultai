// Shared helpers for the v1.5 pages (labels, empty states, times) and the navigation registry.
import { t, tf, esc } from './core.js';

export const isElectron = /Electron/i.test(navigator.userAgent);
export const CLIENTS = [
  { kind: 'claude-desktop', label: 'Claude Desktop' },
  { kind: 'cursor', label: 'Cursor' },
  { kind: 'claude-code', label: 'Claude Code' },
  { kind: 'terminal', labelKey: 'cl_terminal' },
  { kind: 'custom', labelKey: 'cl_custom' },
];
export const clientLabel = (k) => { const c = CLIENTS.find((x) => x.kind === k); return c ? (c.label || t(c.labelKey)) : k; };
export const levelLabel = (l) => t('lv_' + l);
export const actionText = (action) => (action === 'vault:revoke_all' ? t('ks_short') : action);
export const lang = () => window.VaultI18n.getLang();

/** Filled in by app.js so pages can navigate without importing it (avoids cycles). */
export const nav = { switchTab: async () => {}, reloadTab: async () => {}, showLock: () => {}, isUnlocked: () => false };

export function emptyState(icon, title, hint, action) {
  return `<div class="empty"><div class="empty-ico">${icon}</div><strong>${esc(title)}</strong>${hint ? `<div>${esc(hint)}</div>` : ''}${action ? `<div class="empty-action"><button class="btn" id="${action.id}">${esc(action.label)}</button></div>` : ''}</div>`;
}
export function relTime(iso) {
  if (!iso) return t('never');
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return t('rt_now');
  if (s < 3600) return tf('rt_min', { n: Math.floor(s / 60) });
  if (s < 86400) return tf('rt_hour', { n: Math.floor(s / 3600) });
  return tf('rt_day', { n: Math.floor(s / 86400) });
}
export function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString(lang()) : '—'; }
export function asstStatus(a) {
  const expired = a.expired ?? Boolean(a.expiresAt && Date.now() > Date.parse(a.expiresAt));
  if (!a.enabled) return `<span class="badge no">${esc(t('st_off'))}</span>`;
  if (expired) return `<span class="badge write">${esc(t('st_expired'))}</span>`;
  return `<span class="badge ok">${esc(t('st_on'))}</span>`;
}
