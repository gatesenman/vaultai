/**
 * Form assistance back-end (v1.4):
 *  - testConnector: validates a credential against the vendor API and reports account/scopes
 *    without ever echoing the secret.
 *  - siteInfo: website name + favicon for password entries, with SSRF protection
 *    (http/https only, private/loopback addresses refused after DNS resolution, manual
 *    redirect following with re-checks, size + time limits, in-memory cache).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getPreset, pick } from '../shared/presets.js';
import { authHeaderValue, type GenericMeta } from '../connectors/generic.js';
import { vendorBase } from '../connectors/preset-base.js';

export interface TestResult {
  ok: boolean;
  kind: string;
  account?: string;
  scopes?: string[];
  details?: Record<string, string | number | boolean>;
  warnings: string[];
  status?: number;
  code?: string;
  message?: string;
}

/** Test/self-hosting override, e.g. VAULTAI_API_BASE_GITHUB=https://github.example.com/api/v3 */
function base(kind: string): string {
  return vendorBase(kind as 'github' | 'notion' | 'stripe');
}

function scrub(text: string, secret: string): string {
  let t = String(text || '');
  if (secret && secret.length >= 4) t = t.split(secret).join('••••');
  return t.slice(0, 300);
}

async function call(url: string, init: RequestInit): Promise<{ status: number; headers: Headers; json: any; text: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), redirect: 'follow' });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
}

const splitScopes = (h: string | null) => (h || '').split(',').map((s) => s.trim()).filter(Boolean);

export async function testConnector(
  kind: string,
  secret: string,
  meta: GenericMeta = {}
): Promise<TestResult> {
  const r: TestResult = { ok: false, kind, warnings: [] };
  if (kind === 'demo') return { ok: true, kind, account: 'demo', scopes: ['demo:echo'], warnings: [] };
  if (!secret) return { ...r, code: 'MISSING_SECRET', message: 'Secret is required' };
  try {
    if (kind === 'github') {
      const x = await call(`${base('github')}/user`, { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json', 'User-Agent': 'VaultAI' } });
      r.status = x.status;
      if (x.status !== 200) return { ...r, code: x.status === 401 ? 'AUTH_FAILED' : 'HTTP_' + x.status, message: scrub(x.json?.message || x.text, secret) };
      r.ok = true; r.account = x.json?.login; r.scopes = splitScopes(x.headers.get('x-oauth-scopes'));
      if (!x.headers.get('x-oauth-scopes')) r.warnings.push('fineGrained');
      if (r.scopes.some((s) => ['delete_repo', 'admin:org', 'admin:enterprise', 'site_admin'].includes(s))) r.warnings.push('broadScopes');
      if (x.json?.name) r.details = { name: x.json.name };
    } else if (kind === 'notion') {
      const x = await call(`${base('notion')}/v1/users/me`, { headers: { Authorization: `Bearer ${secret}`, 'Notion-Version': '2022-06-28' } });
      r.status = x.status;
      if (x.status !== 200) return { ...r, code: x.status === 401 ? 'AUTH_FAILED' : 'HTTP_' + x.status, message: scrub(x.json?.message || x.text, secret) };
      r.ok = true; r.account = x.json?.name || x.json?.bot?.owner?.user?.name || 'integration';
      if (x.json?.bot?.workspace_name) r.details = { workspace: x.json.bot.workspace_name };
      r.scopes = ['shared pages only'];
    } else if (kind === 'stripe') {
      const live = /^(sk|rk)_live_/.test(secret);
      if (secret.startsWith('sk_live_')) r.warnings.push('liveSecretKey');
      const x = await call(`${base('stripe')}/v1/account`, { headers: { Authorization: `Bearer ${secret}` } });
      r.status = x.status;
      if (x.status === 403 && secret.startsWith('rk_')) {
        r.ok = true; r.account = 'restricted key'; r.warnings.push('restrictedNoAccountRead');
      } else if (x.status !== 200) {
        return { ...r, code: x.status === 401 ? 'AUTH_FAILED' : 'HTTP_' + x.status, message: scrub(x.json?.error?.message || x.text, secret) };
      } else {
        r.ok = true; r.account = x.json?.settings?.dashboard?.display_name || x.json?.business_profile?.name || x.json?.email || x.json?.id;
      }
      r.details = { mode: live ? 'live' : 'test', keyType: secret.startsWith('rk_') ? 'restricted' : 'secret' };
    } else if (kind === 'generic') {
      const baseUrl = String(meta.baseUrl || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(baseUrl)) return { ...r, code: 'BAD_URL', message: 'Base URL must start with https://' };
      const preset = getPreset(meta.preset);
      const headerName = meta.headerName || preset.headerName;
      const auth = { [headerName]: authHeaderValue(secret, { ...meta, headerName }) };
      if (preset.tokenPattern && !new RegExp(preset.tokenPattern).test(secret)) r.warnings.push('unexpectedFormat');
      if (baseUrl.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl)) r.warnings.push('plainHttp');
      if (preset.test) {
        const t = preset.test;
        const x = await call(baseUrl + t.path, {
          method: t.method,
          headers: { ...auth, Accept: 'application/json', ...(t.body ? { 'Content-Type': 'application/json' } : {}) },
          body: t.body ? JSON.stringify(t.body) : undefined,
        });
        r.status = x.status;
        const fieldOk = t.okField ? Boolean(pick(x.json, t.okField)) : !x.json?.errors;
        if (x.status !== 200 || !fieldOk) {
          const msg = x.json?.errors?.[0]?.message || x.json?.error || x.json?.detail || `HTTP ${x.status}`;
          return { ...r, code: x.status >= 500 ? 'HTTP_' + x.status : 'AUTH_FAILED', message: scrub(String(msg), secret) };
        }
        r.ok = true;
        r.account = t.account.map((pth) => pick(x.json, pth)).filter(Boolean).map(String).join(' @ ') || preset.name;
        const sc = x.headers.get('x-oauth-scopes');
        if (sc) r.scopes = splitScopes(sc);
        else if (Array.isArray(x.json?.auth?.scopes)) r.scopes = x.json.auth.scopes;
        if ((r.scopes || []).some((sx) => /:admin$/.test(sx))) r.warnings.push('broadScopes');
        if (preset.id === 'slack' && secret.startsWith('xoxp-')) r.warnings.push('userToken');
      } else {
        const x = await call(baseUrl, { headers: { ...auth, Accept: 'application/json' } });
        r.status = x.status;
        if (x.status === 401 || x.status === 403) return { ...r, code: 'AUTH_FAILED', message: `HTTP ${x.status}` };
        if (x.status >= 500) return { ...r, code: 'HTTP_' + x.status, message: `HTTP ${x.status}` };
        r.ok = true;
        r.account = `HTTP ${x.status}`;
        if (x.status === 404) r.warnings.push('notFoundAtBase');
      }
    } else {
      return { ...r, code: 'UNSUPPORTED', message: `No connection test for ${kind}` };
    }
    return r;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'Timed out after 8s' : e.message) : String(e);
    return { ...r, code: 'NETWORK', message: scrub(msg, secret) };
  }
}

// ---------------- site info (name + favicon) ----------------

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some((r) => r.test(ip));
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
}

async function assertPublic(u: URL): Promise<void> {
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http/https');
  if (process.env.VAULTAI_ALLOW_PRIVATE_SITEINFO === '1') return; // test hook
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private host');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
}

async function safeFetch(url: string, maxBytes: number, accept: string): Promise<{ url: string; type: string; body: Buffer } | null> {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(4000), headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 VaultAI' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    if (!res.ok || !res.body) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel().catch(() => {}); break; }
      chunks.push(Buffer.from(value));
    }
    return { url: current.toString(), type: res.headers.get('content-type') || '', body: Buffer.concat(chunks) };
  }
  return null;
}

export function nameFromHost(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  const label = parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
  const sld = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'].includes(label) && parts.length >= 3 ? parts[parts.length - 3]! : label;
  return sld ? sld[0]!.toUpperCase() + sld.slice(1) : host;
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export interface SiteInfo { ok: boolean; origin: string; host: string; name: string; title?: string; icon?: string; fetched: boolean; }
const cache = new Map<string, { at: number; info: SiteInfo }>();

export async function siteInfo(rawUrl: string, allowNetwork: boolean): Promise<SiteInfo> {
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`); } catch { return { ok: false, origin: '', host: '', name: '', fetched: false }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, origin: '', host: '', name: '', fetched: false };
  const base: SiteInfo = { ok: true, origin: u.origin, host: u.hostname, name: nameFromHost(u.hostname), fetched: false };
  if (!allowNetwork) return base;
  const hit = cache.get(u.origin);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.info;
  const info = { ...base };
  try {
    const page = await safeFetch(u.origin + '/', 512 * 1024, 'text/html');
    let iconHref = '/favicon.ico';
    if (page && /html/i.test(page.type)) {
      const html = page.body.toString('utf8');
      const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']{1,80})["']/i) || html.match(/<meta[^>]+content=["']([^"']{1,80})["'][^>]*property=["']og:site_name["']/i);
      const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
      if (title) info.title = decodeEntities(title[1]!);
      if (og) info.name = decodeEntities(og[1]!);
      else if (info.title) {
        const seg = info.title.split(/\s[|\-–—·:]\s/).map((s) => s.trim()).filter(Boolean);
        const pick = seg.find((s) => s.toLowerCase().includes(info.name.toLowerCase())) || (seg.length > 1 ? seg[seg.length - 1] : seg[0]);
        if (pick && pick.length <= 40) info.name = pick;
      }
      const links = [...html.matchAll(/<link[^>]+>/gi)].map((m) => m[0]);
      const iconLink = links.find((l) => /rel=["'][^"']*(apple-touch-icon)[^"']*["']/i.test(l)) || links.find((l) => /rel=["'][^"']*\bicon\b[^"']*["']/i.test(l));
      const href = iconLink?.match(/href=["']([^"']+)["']/i)?.[1];
      if (href && !href.startsWith('data:')) iconHref = href;
    }
    const iconUrl = new URL(iconHref, page?.url || u.origin).toString();
    const icon = await safeFetch(iconUrl, 100 * 1024, 'image/*');
    if (icon && icon.body.length > 0 && (/^image\//i.test(icon.type) || iconUrl.endsWith('.ico'))) {
      const type = /^image\//i.test(icon.type) ? icon.type.split(';')[0] : 'image/x-icon';
      if (!/svg/i.test(type)) info.icon = `data:${type};base64,${icon.body.toString('base64')}`; // no SVG (script risk)
    }
    info.fetched = true;
  } catch { /* offline / blocked → derived name only */ }
  cache.set(u.origin, { at: Date.now(), info });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return info;
}
