import type { Request, Response, NextFunction } from 'express';

const SECRET_PATTERNS = [
  /\b(ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}\b/g,
  /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bsecret_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]+\b/g,
  /\bvai_[A-Za-z0-9_-]{16,}\b/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
];

export function scrubSecrets(text: string): string {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

export function scrubError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return scrubSecrets(msg);
}

/** Simple sliding-window rate limiter */
export function createRateLimiter(getLimit: () => number) {
  const hits = new Map<string, number[]>();
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const limit = getLimit();
    if (!limit || limit <= 0) return next();
    const ip = req.ip || req.socket.remoteAddress || 'local';
    const now = Date.now();
    const windowMs = 60_000;
    let arr = hits.get(ip) || [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      return res.status(429).json({
        ok: false,
        code: 'RATE_LIMIT',
        message: `Too many requests (${limit}/min)`,
        fix: 'Wait a minute or raise rateLimitPerMinute in Settings',
      });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

export function assertLoopbackHost(host: string, allowNonLoopback: boolean): void {
  const h = (host || '').toLowerCase();
  const ok =
    h === '127.0.0.1' ||
    h === 'localhost' ||
    h === '::1' ||
    h === '[::1]';
  if (!ok && !allowNonLoopback) {
    throw new Error(
      `Refusing to bind non-loopback host "${host}". Set VAULTAI_ALLOW_NON_LOOPBACK=1 to override (not recommended)`
    );
  }
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

/**
 * Blocks cross-site browser requests (CSRF / malicious web pages) and DNS-rebinding:
 *  - Host header must be a loopback name (unless non-loopback is explicitly allowed)
 *  - If an Origin header is present it must be the app's own loopback origin
 * CLI / MCP clients send no Origin header and are unaffected.
 */
export function createOriginGuard(getPort: () => number, allowNonLoopback: () => boolean) {
  return function originGuard(req: Request, res: Response, next: NextFunction) {
    const allowNon = allowNonLoopback();
    const host = String(req.headers.host || '');
    if (!allowNon && host && !LOOPBACK_HOSTNAMES.has(hostnameOf(host))) {
      return res.status(403).json({
        ok: false,
        code: 'BAD_HOST',
        message: 'Requests must target 127.0.0.1 / localhost',
      });
    }
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let ok = false;
      try {
        const u = new URL(origin);
        const port = String(getPort());
        ok =
          (u.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase()) && u.port === port) ||
          (allowNon && hostnameOf(host) === u.hostname.toLowerCase());
      } catch {
        ok = false;
      }
      if (!ok) {
        return res.status(403).json({
          ok: false,
          code: 'BAD_ORIGIN',
          message: 'Cross-origin requests are not allowed',
        });
      }
    } else if (origin === 'null') {
      return res.status(403).json({ ok: false, code: 'BAD_ORIGIN', message: 'Opaque origin not allowed' });
    }
    next();
  };
}
