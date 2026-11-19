import type { PermissionLevel, ToolResult } from '../types/index.js';
import type { VaultStore } from '../store/db.js';
import { levelAllows } from './permissions.js';
import {
  getAccessToken,
  googleNotConfiguredResult,
  googleNotConnectedResult,
  hasGoogleClient,
  isGoogleConnected,
} from './google-oauth.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1';

async function gmailFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep */
  }
  return { status: res.status, body };
}

function needFor(action: string): PermissionLevel {
  const map: Record<string, PermissionLevel> = {
    search: 'read',
    get: 'read',
    create_draft: 'write',
    list_labels: 'read',
    modify: 'write',
    archive: 'write',
    send: 'full',
  };
  return map[action] || 'full';
}

export async function gmailTool(
  store: VaultStore,
  action: string,
  args: Record<string, unknown>,
  level: PermissionLevel
): Promise<ToolResult> {
  if (!hasGoogleClient(store)) return googleNotConfiguredResult();
  if (!isGoogleConnected(store)) return googleNotConnectedResult();

  const need = needFor(action);
  if (!levelAllows(level, need)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `gmail:${action} requires ${need}; assistant has ${level}`,
      fix: `Raise Gmail permission to at least ${need}`,
    };
  }

  let token: string;
  try {
    token = await getAccessToken(store);
  } catch (e) {
    return {
      ok: false,
      code: (e as { code?: string }).code || 'GOOGLE_AUTH',
      message: e instanceof Error ? e.message : 'Auth failed',
      fix: 'Reconnect Google in VaultAI → Connections',
    };
  }

  try {
    switch (action) {
      case 'search': {
        const q = String(args.q || args.query || '');
        if (!q) return { ok: false, code: 'BAD_ARGS', message: 'q required' };
        const params = new URLSearchParams({
          q,
          maxResults: String(args.maxResults || args.max || 20),
        });
        const { status, body } = await gmailFetch(token, `/users/me/messages?${params}`);
        if (status >= 400) {
          return { ok: false, code: 'GMAIL_API', message: `HTTP ${status}` };
        }
        return { ok: true, data: body };
      }
      case 'get': {
        const id = String(args.id || args.messageId || '');
        if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
        const format = String(args.format || 'full');
        const { status, body } = await gmailFetch(
          token,
          `/users/me/messages/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}`
        );
        if (status >= 400) {
          return { ok: false, code: 'GMAIL_API', message: `HTTP ${status}` };
        }
        return { ok: true, data: body };
      }
      case 'create_draft': {
        const to = String(args.to || '');
        const subject = String(args.subject || '');
        const text = String(args.body || args.text || '');
        if (!to || !subject) {
          return { ok: false, code: 'BAD_ARGS', message: 'to and subject required' };
        }
        const raw = [
          `To: ${to}`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          text,
        ].join('\r\n');
        const encoded = Buffer.from(raw)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const { status, body } = await gmailFetch(token, '/users/me/drafts', {
          method: 'POST',
          body: JSON.stringify({ message: { raw: encoded } }),
        });
        if (status >= 400) {
          return { ok: false, code: 'GMAIL_API', message: `HTTP ${status}`, fix: 'Need Write access and the gmail.compose scope' };
        }
        return { ok: true, data: body };
      }
      case 'list_labels': {
        const { status, body } = await gmailFetch(token, '/users/me/labels');
        if (status >= 400) return { ok: false, code: 'GMAIL_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'modify':
      case 'archive': {
        const id = String(args.id || args.messageId || '');
        if (!id) return { ok: false, code: 'BAD_ARGS', message: 'id required' };
        const addLabelIds = (args.addLabelIds as string[]) || [];
        let removeLabelIds = (args.removeLabelIds as string[]) || [];
        if (action === 'archive' || args.archive) {
          removeLabelIds = [...new Set([...removeLabelIds, 'INBOX'])];
        }
        const { status, body } = await gmailFetch(
          token,
          `/users/me/messages/${encodeURIComponent(id)}/modify`,
          {
            method: 'POST',
            body: JSON.stringify({ addLabelIds, removeLabelIds }),
          }
        );
        if (status >= 400) return { ok: false, code: 'GMAIL_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'send': {
        const to = String(args.to || '');
        const subject = String(args.subject || '');
        const text = String(args.body || args.text || '');
        if (!to || !subject) {
          return { ok: false, code: 'BAD_ARGS', message: 'to and subject required' };
        }
        const raw = [
          `To: ${to}`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          text,
        ].join('\r\n');
        const encoded = Buffer.from(raw)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const { status, body } = await gmailFetch(token, '/users/me/messages/send', {
          method: 'POST',
          body: JSON.stringify({ raw: encoded }),
        });
        if (status >= 400) {
          return { ok: false, code: 'GMAIL_API', message: `HTTP ${status}`, fix: 'Need Full permission + gmail.send scope' };
        }
        return { ok: true, data: body };
      }
      default:
        return {
          ok: false,
          code: 'UNKNOWN_ACTION',
          message: `Unknown gmail action: ${action}`,
          fix: 'search, get, create_draft, list_labels, modify, archive, send',
        };
    }
  } catch (e) {
    return {
      ok: false,
      code: 'GMAIL_NETWORK',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
