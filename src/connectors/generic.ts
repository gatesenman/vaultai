import type { PermissionLevel, ToolResult } from '../types/index.js';
import { levelAllows, methodNeedsWrite } from './permissions.js';
import { getPreset, isGraphqlRead } from '../shared/presets.js';

export interface GenericMeta {
  baseUrl?: string;
  headerName?: string;
  preset?: string;
  authScheme?: 'bearer' | 'raw';
}

/** Header value VaultAI sends for this connection. */
export function authHeaderValue(secret: string, meta: GenericMeta): string {
  const headerName = meta.headerName || 'Authorization';
  const scheme = meta.authScheme || (headerName.toLowerCase() === 'authorization' ? 'bearer' : 'raw');
  if (scheme === 'bearer' && !/^bearer /i.test(secret)) return `Bearer ${secret}`;
  return secret;
}

/**
 * Resolve the request URL and make sure it stays under the connection's base URL.
 * 1.4.0 accepted any absolute `url`, which let an AI send the stored key to any host.
 */
export function resolveTarget(base: string, args: { path?: string; url?: string }): { url: string } | { error: string } {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b)) return { error: 'NO_BASE_URL' };
  let baseUrl: URL;
  try { baseUrl = new URL(b); } catch { return { error: 'NO_BASE_URL' }; }
  let target: URL;
  try {
    if (args.url) target = new URL(String(args.url));
    else {
      const p = String(args.path || '/');
      target = new URL(b + (p.startsWith('/') ? p : '/' + p));
    }
  } catch {
    return { error: 'BAD_URL' };
  }
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const inside =
    target.origin === baseUrl.origin &&
    (basePath === '' || target.pathname === basePath || target.pathname.startsWith(basePath + '/'));
  if (!inside) return { error: 'URL_NOT_ALLOWED' };
  return { url: target.href };
}

export function requiredLevel(method: string, body: unknown, meta: GenericMeta): PermissionLevel {
  if (!methodNeedsWrite(method)) return 'read';
  if (method === 'POST' && getPreset(meta.preset).graphql && isGraphqlRead(body)) return 'read';
  return 'write';
}

export async function genericHttpRequest(
  args: { method?: string; path?: string; url?: string; body?: unknown; headers?: Record<string, string> },
  secret: string,
  meta: GenericMeta,
  level: PermissionLevel
): Promise<ToolResult> {
  const method = String(args.method || 'GET').toUpperCase();
  const need = requiredLevel(method, args.body, meta);
  if (!levelAllows(level, need)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `HTTP ${method} requires ${need}; assistant has ${level}`,
      fix: `Raise this connection to at least "${need}" in VaultAI → AI assistants → Access`,
    };
  }
  const t = resolveTarget(meta.baseUrl || '', args);
  if ('error' in t) {
    const messages: Record<string, [string, string]> = {
      NO_BASE_URL: ['This connection has no base URL', 'Open VaultAI → Connections → Edit and set a base URL'],
      BAD_URL: ['Invalid path or url', 'Pass a path such as "/v1/items"'],
      URL_NOT_ALLOWED: [`Requests are limited to ${meta.baseUrl}`, 'Pass a path relative to the base URL'],
    };
    const [message, fix] = messages[t.error];
    return { ok: false, code: t.error, message, fix };
  }
  const headerName = meta.headerName || 'Authorization';
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(args.headers || {})) {
    if (k.toLowerCase() !== headerName.toLowerCase() && k.toLowerCase() !== 'host') extra[k] = String(v);
  }
  try {
    const res = await fetch(t.url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: 'application/json',
        ...(args.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...extra,
        [headerName]: authHeaderValue(secret, meta),
      },
      body: args.body != null ? (typeof args.body === 'string' ? args.body : JSON.stringify(args.body)) : undefined,
    });
    let text = await res.text();
    if (secret.length >= 6) text = text.split(secret).join('••••');
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { ok: true, data: { status: res.status, body: parsed } };
  } catch (e) {
    return { ok: false, code: 'HTTP_NETWORK', message: e instanceof Error ? e.message : 'Network error' };
  }
}
