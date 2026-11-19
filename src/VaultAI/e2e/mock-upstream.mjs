// Mock vendor APIs + a mock website for connector "Test connection" and site-info E2E.
// Tokens containing "good" are accepted; anything else is rejected like the real API would.
import http from 'node:http';
import { createHash } from 'node:crypto';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export function startMockUpstream(port = 3872) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const auth = String(req.headers.authorization || req.headers['x-api-key'] || '');
      const good = auth.includes('good');
      // authSha lets tests prove the exact credential arrived without ever logging it
      hits.push({ method: req.method, url: req.url, auth: auth ? auth.slice(0, 12) + '…' : '', authSha: auth ? createHash('sha256').update(auth).digest('hex').slice(0, 16) : '' });
      const json = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      const u = req.url || '/';
      if (u === '/user') return good ? json(200, { login: 'octo-e2e', name: 'Octo E2E' }, { 'x-oauth-scopes': 'repo, read:user' }) : json(401, { message: 'Bad credentials' });
      if (u === '/v1/users/me') return good ? json(200, { object: 'user', name: 'E2E Notion Bot', bot: { workspace_name: 'E2E Workspace' } }) : json(401, { message: 'API token is invalid.' });
      if (u === '/v1/account') {
        if (!good) return json(401, { error: { message: 'Invalid API Key provided' } });
        if (auth.includes('rk_')) return json(403, { error: { message: 'restricted' } });
        return json(200, { id: 'acct_e2e', settings: { dashboard: { display_name: 'E2E Shop' } } });
      }
      if (u === '/graphql') return good ? json(200, { data: { viewer: { name: 'Lin E2E', email: 'lin@e2e.test' }, organization: { name: 'E2E Org' } } }) : json(400, { errors: [{ message: 'Authentication required' }] });
      if (u === '/api/0/') return good ? json(200, { user: { email: 'sentry@e2e.test' }, auth: { scopes: ['project:read', 'event:read'] } }) : json(401, { detail: 'Invalid token' });
      if (u === '/api/auth.test') return good ? json(200, { ok: true, user: 'e2ebot', team: 'E2E Team' }, { 'x-oauth-scopes': 'chat:write,channels:read' }) : json(200, { ok: false, error: 'invalid_auth' });
      if (u.startsWith('/generic')) return good ? json(200, { ok: true }) : json(401, { error: 'unauthorized' });
      if (u === '/' || u.startsWith('/site') || u.startsWith('/login')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><html><head><meta property="og:site_name" content="Mock Site E2E"><title>Mock Site — Login</title><link rel="icon" type="image/png" href="/favicon.png"></head><body>hi</body></html>');
      }
      if (u === '/favicon.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG_1x1); }
      json(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${port}`, hits, stop: () => new Promise((r) => srv.close(() => r())),
  })));
}
