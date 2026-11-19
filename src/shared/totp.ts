/**
 * TOTP (RFC 6238) — Google Authenticator compatible defaults:
 * SHA-1, 30s period, 6 digits, Base32 secret.
 * Never logs secrets. Used by UI, API, MCP (Full passwords only).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TotpAlgo = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpParams {
  secret: string; // raw Base32 (spaces/padding stripped) or otpauth URI
  digits?: number;
  period?: number;
  algo?: TotpAlgo;
  /** Unix seconds; default now */
  at?: number;
}

export interface TotpCode {
  code: string;
  remaining: number;
  period: number;
  digits: number;
  algo: TotpAlgo;
}

export interface ParsedOtpAuth {
  secret: string;
  label?: string;
  issuer?: string;
  digits: number;
  period: number;
  algo: TotpAlgo;
  account?: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Normalize user/paste input: strip spaces, fix common otpauth paste, uppercase. */
export function normalizeTotpSecretInput(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, '');
}

export function isOtpAuthUri(s: string): boolean {
  return /^otpauth:\/\//i.test(String(s || '').trim());
}

export function decodeBase32(input: string): Buffer {
  const cleaned = String(input || '')
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[^A-Z2-7]/g, '');
  if (!cleaned) throw new Error('Empty TOTP secret');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid Base32 TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function parseAlgo(a?: string | null): TotpAlgo {
  const u = String(a || 'SHA1').toUpperCase().replace(/^HMAC-?/i, '');
  if (u === 'SHA256' || u === 'SHA512') return u;
  return 'SHA1';
}

/** Parse otpauth://totp/... URI or return a bare secret as ParsedOtpAuth. */
export function parseTotpInput(raw: string): ParsedOtpAuth {
  const s = normalizeTotpSecretInput(raw);
  if (!s) throw new Error('TOTP secret required');
  if (isOtpAuthUri(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw new Error('Invalid otpauth URI');
    }
    if (url.protocol !== 'otpauth:') throw new Error('Not an otpauth URI');
    const type = url.hostname.toLowerCase(); // totp / hotp
    if (type && type !== 'totp') throw new Error('Only otpauth://totp/ is supported');
    const secret = url.searchParams.get('secret') || '';
    if (!secret) throw new Error('otpauth URI missing secret');
    // label is path without leading /
    const label = decodeURIComponent((url.pathname || '').replace(/^\//, ''));
    let issuer = url.searchParams.get('issuer') || undefined;
    let account = label;
    if (label.includes(':')) {
      const [iss, acc] = label.split(/:(.+)/);
      if (!issuer) issuer = iss || undefined;
      account = (acc || label).trim();
    }
    const digits = Math.min(8, Math.max(6, Number(url.searchParams.get('digits') || 6) || 6));
    const period = Math.min(120, Math.max(15, Number(url.searchParams.get('period') || 30) || 30));
    return {
      secret: secret.toUpperCase().replace(/\s+/g, ''),
      label: label || undefined,
      issuer,
      account,
      digits,
      period,
      algo: parseAlgo(url.searchParams.get('algorithm')),
    };
  }
  // Bare secret — validate Base32
  const secret = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  decodeBase32(secret); // throws if bad
  return { secret, digits: 6, period: 30, algo: 'SHA1' };
}

/** Canonical storage form: Base32 secret only (params fixed to GA defaults unless encoded in notes). */
export function canonicalizeTotpSecret(raw: string): string {
  return parseTotpInput(raw).secret;
}

function hotp(key: Buffer, counter: number, algo: TotpAlgo, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const nodeAlgo = algo === 'SHA256' ? 'sha256' : algo === 'SHA512' ? 'sha512' : 'sha1';
  const hmac = createHmac(nodeAlgo, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(code % mod).padStart(digits, '0');
}

export function generateTotp(params: TotpParams): TotpCode {
  const parsed = parseTotpInput(params.secret);
  const digits = params.digits ?? parsed.digits ?? 6;
  const period = params.period ?? parsed.period ?? 30;
  const algo = params.algo ?? parsed.algo ?? 'SHA1';
  const at = params.at ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(at / period);
  const remaining = period - (at % period);
  const key = decodeBase32(parsed.secret);
  const code = hotp(key, counter, algo, digits);
  return { code, remaining, period, digits, algo };
}

/** Constant-time compare of current (and previous) window — for tests / verify hooks. */
export function verifyTotp(secret: string, code: string, opts?: { window?: number; at?: number }): boolean {
  const want = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6,8}$/.test(want)) return false;
  const window = opts?.window ?? 1;
  const at = opts?.at ?? Math.floor(Date.now() / 1000);
  const parsed = parseTotpInput(secret);
  for (let w = -window; w <= window; w++) {
    const g = generateTotp({ secret: parsed.secret, at: at + w * parsed.period, digits: parsed.digits, period: parsed.period, algo: parsed.algo });
    const a = Buffer.from(g.code);
    const b = Buffer.from(want.padStart(g.digits, '0'));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function buildOtpAuthUri(opts: {
  secret: string;
  account?: string;
  issuer?: string;
  digits?: number;
  period?: number;
  algo?: TotpAlgo;
}): string {
  const secret = canonicalizeTotpSecret(opts.secret);
  const account = opts.account || 'VaultAI';
  const issuer = opts.issuer || 'VaultAI';
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: opts.algo || 'SHA1',
    digits: String(opts.digits || 6),
    period: String(opts.period || 30),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
