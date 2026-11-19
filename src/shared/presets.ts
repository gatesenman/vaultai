/**
 * Generic HTTP presets (1.5.0). Linear, Sentry and Slack used to be dedicated connectors with
 * a handful of fixed tools; they are now plain data that pre-fills a Generic HTTP connection.
 * Shared by the server (migration, connection test, GraphQL read detection) and the UI.
 */
export type PresetId = 'linear' | 'sentry' | 'slack' | 'custom';

export interface HttpPreset {
  id: PresetId;
  name: string;
  /** Default base URL ('' for custom) — the AI can only call URLs under it */
  baseUrl: string;
  headerName: string;
  /** bearer: send "Bearer <secret>"; raw: send the secret unchanged */
  authScheme: 'bearer' | 'raw';
  /** POST queries that are not mutations count as read */
  graphql?: boolean;
  /** Regex source the secret is expected to match (warning only) */
  tokenPattern?: string;
  placeholder: string;
  docsUrl?: string;
  /** Request used by "Test connection"; account = dotted JSON paths tried in order */
  test?: { method: 'GET' | 'POST'; path: string; body?: unknown; account: string[]; okField?: string };
  /** Example call shown to the user / AI */
  example: { method: string; path: string; body?: unknown };
}

export const HTTP_PRESETS: HttpPreset[] = [
  {
    id: 'linear',
    name: 'Linear',
    baseUrl: 'https://api.linear.app',
    headerName: 'Authorization',
    authScheme: 'raw',
    graphql: true,
    tokenPattern: '^lin_api_',
    placeholder: 'lin_api_…',
    docsUrl: 'https://linear.app/settings/account/security',
    test: { method: 'POST', path: '/graphql', body: { query: '{ viewer { name email } }' }, account: ['data.viewer.email', 'data.viewer.name'] },
    example: { method: 'POST', path: '/graphql', body: { query: '{ issues(first: 10) { nodes { identifier title } } }' } },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    baseUrl: 'https://sentry.io/api/0',
    headerName: 'Authorization',
    authScheme: 'bearer',
    tokenPattern: '^(sntrys_|sntryu_|[0-9a-f]{64}$)',
    placeholder: 'sntrys_…',
    docsUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    test: { method: 'GET', path: '/', account: ['user.email', 'user.username'], okField: 'auth' },
    example: { method: 'GET', path: '/organizations/' },
  },
  {
    id: 'slack',
    name: 'Slack',
    baseUrl: 'https://slack.com/api',
    headerName: 'Authorization',
    authScheme: 'bearer',
    tokenPattern: '^xox[bpae]-',
    placeholder: 'xoxb-…',
    docsUrl: 'https://api.slack.com/apps',
    test: { method: 'POST', path: '/auth.test', account: ['user', 'team'], okField: 'ok' },
    example: { method: 'GET', path: '/conversations.list?limit=20' },
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    headerName: 'Authorization',
    authScheme: 'bearer',
    placeholder: '',
    example: { method: 'GET', path: '/' },
  },
];

export function getPreset(id: string | undefined): HttpPreset {
  return HTTP_PRESETS.find((p) => p.id === id) || HTTP_PRESETS[HTTP_PRESETS.length - 1];
}

/** A GraphQL document is a read unless its first operation is a mutation (or subscription). */
export function isGraphqlRead(body: unknown): boolean {
  let q: unknown = body;
  if (typeof body === 'string') {
    try { q = JSON.parse(body); } catch { q = { query: body }; }
  }
  const query = q && typeof q === 'object' ? (q as { query?: unknown }).query : undefined;
  if (typeof query !== 'string') return false;
  const cleaned = query.replace(/#[^\n]*/g, '').trim();
  return !/^(mutation|subscription)\b/i.test(cleaned);
}

/** Read a dotted path from a JSON value. */
export function pick(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
