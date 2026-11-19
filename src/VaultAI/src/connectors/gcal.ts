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

const CAL = 'https://www.googleapis.com/calendar/v3';

async function calFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${CAL}${path}`, {
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

export async function gcalTool(
  store: VaultStore,
  action: string,
  args: Record<string, unknown>,
  level: PermissionLevel
): Promise<ToolResult> {
  if (!hasGoogleClient(store)) return googleNotConfiguredResult();
  if (!isGoogleConnected(store)) return googleNotConnectedResult();

  const need: PermissionLevel =
    action === 'list_events' || action === 'get_event' || action === 'list_calendars'
      ? 'read'
      : 'write';
  if (!levelAllows(level, need)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `gcal:${action} requires ${need}; assistant has ${level}`,
      fix: `Raise Calendar permission to at least ${need}`,
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
    };
  }

  const calendarId = encodeURIComponent(String(args.calendarId || 'primary'));

  try {
    switch (action) {
      case 'list_calendars': {
        const { status, body } = await calFetch(token, '/users/me/calendarList');
        if (status >= 400) return { ok: false, code: 'GCAL_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'list_events': {
        const params = new URLSearchParams({
          maxResults: String(args.maxResults || 20),
          singleEvents: 'true',
          orderBy: 'startTime',
        });
        if (args.timeMin) params.set('timeMin', String(args.timeMin));
        else params.set('timeMin', new Date().toISOString());
        if (args.timeMax) params.set('timeMax', String(args.timeMax));
        if (args.q) params.set('q', String(args.q));
        const { status, body } = await calFetch(token, `/calendars/${calendarId}/events?${params}`);
        if (status >= 400) return { ok: false, code: 'GCAL_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'get_event': {
        const eventId = String(args.eventId || args.id || '');
        if (!eventId) return { ok: false, code: 'BAD_ARGS', message: 'eventId required' };
        const { status, body } = await calFetch(
          token,
          `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`
        );
        if (status >= 400) return { ok: false, code: 'GCAL_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'create_event': {
        const summary = String(args.summary || args.title || '');
        const start = String(args.start || '');
        const end = String(args.end || '');
        if (!summary || !start || !end) {
          return {
            ok: false,
            code: 'BAD_ARGS',
            message: 'summary, start, end required (ISO 8601)',
          };
        }
        const allDay = Boolean(args.allDay);
        const event: Record<string, unknown> = {
          summary,
          description: args.description ? String(args.description) : undefined,
          start: allDay ? { date: start.slice(0, 10) } : { dateTime: start },
          end: allDay ? { date: end.slice(0, 10) } : { dateTime: end },
        };
        const { status, body } = await calFetch(token, `/calendars/${calendarId}/events`, {
          method: 'POST',
          body: JSON.stringify(event),
        });
        if (status >= 400) return { ok: false, code: 'GCAL_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      default:
        return {
          ok: false,
          code: 'UNKNOWN_ACTION',
          message: `Unknown gcal action: ${action}`,
          fix: 'list_calendars, list_events, get_event, create_event',
        };
    }
  } catch (e) {
    return {
      ok: false,
      code: 'GCAL_NETWORK',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
