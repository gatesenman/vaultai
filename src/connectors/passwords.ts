import { generateTotp } from '../shared/totp.js';
import type { PermissionLevel, Refusal, ToolResult } from '../types/index.js';
import type { VaultStore } from '../store/db.js';
import { levelAllows } from './permissions.js';
import { PASSWORDS_PERM_KEY } from '../types/index.js';

function refusal(code: string, message: string, fix?: string): Refusal {
  return { ok: false, code, message, fix };
}

/**
 * MCP/CLI password tools.
 * Read = metadata only (title, username, url, tags, favorite, hasTotp, times).
 * Full = can retrieve password value and TOTP codes (logged as reveal / totp).
 * TOTP secret itself is never returned to AI/MCP.
 */
export function passwordsTool(
  store: VaultStore,
  action: string,
  args: Record<string, unknown>,
  level: PermissionLevel
): ToolResult {
  if (!levelAllows(level, 'read')) {
    return refusal(
      'PERMISSION_DENIED',
      `passwords:${action} requires read; have ${level}`,
      'Set Passwords access to Read or Full in VaultAI → AI assistants → Access'
    );
  }

  if (action === 'list' || action === 'search') {
    const q = args.q != null ? String(args.q) : args.query != null ? String(args.query) : undefined;
    const tag = args.tag != null ? String(args.tag) : undefined;
    const favorite = args.favorite !== undefined ? Boolean(args.favorite) : undefined;
    const rows = store.listPasswords({ q, tag, favorite });
    return { ok: true, data: { entries: rows, count: rows.length } };
  }

  if (action === 'get' || action === 'get_meta') {
    const id = String(args.id || '');
    if (!id) return refusal('BAD_ARGS', 'id required');
    const meta = store.getPasswordMeta(id);
    if (!meta) return refusal('NOT_FOUND', 'Password entry not found');
    return { ok: true, data: meta };
  }

  if (action === 'get_password' || action === 'reveal') {
    if (!levelAllows(level, 'full')) {
      return refusal(
        'PERMISSION_DENIED',
        'Retrieving password values requires Full permission on Passwords',
        'Set Passwords → Full in VaultAI → AI assistants → Access (logged in activity)'
      );
    }
    const id = String(args.id || '');
    if (!id) return refusal('BAD_ARGS', 'id required');
    try {
      const password = store.revealPassword(id);
      const meta = store.getPasswordMeta(id)!;
      return {
        ok: true,
        data: {
          id: meta.id,
          title: meta.title,
          username: meta.username,
          url: meta.url,
          password,
          hasTotp: Boolean(meta.hasTotp),
        },
      };
    } catch (e) {
      return refusal('NOT_FOUND', e instanceof Error ? e.message : 'not found');
    }
  }

  if (action === 'get_totp' || action === 'totp') {
    if (!levelAllows(level, 'full')) {
      return refusal(
        'PERMISSION_DENIED',
        'Retrieving TOTP codes requires Full permission on Passwords',
        'Set Passwords → Full in VaultAI → AI assistants → Access (logged in activity)'
      );
    }
    const id = String(args.id || '');
    if (!id) return refusal('BAD_ARGS', 'id required');
    try {
      if (!store.hasTotp(id)) return refusal('NOT_FOUND', 'No TOTP on this item');
      const secret = store.revealTotpSecret(id);
      // dynamic import keeps connector light; generateTotp is sync once loaded
      const code = generateTotp({ secret });
      const meta = store.getPasswordMeta(id)!;
      return {
        ok: true,
        data: {
          id: meta.id,
          title: meta.title,
          code: code.code,
          remaining: code.remaining,
          period: code.period,
        },
      };
    } catch (e) {
      return refusal('NOT_FOUND', e instanceof Error ? e.message : 'not found');
    }
  }

  return refusal('UNKNOWN_ACTION', `Unknown passwords action: ${action}`, 'Use list|get|get_password|get_totp');
}

export function getPasswordsPermission(asst: { permissions: Record<string, PermissionLevel> }): PermissionLevel {
  return (asst.permissions[PASSWORDS_PERM_KEY] || 'off') as PermissionLevel;
}
