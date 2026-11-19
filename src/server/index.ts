import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VaultStore } from '../store/db.js';
import { mountApi } from './api.js';
import { mountMcp } from './mcp.js';
import { resolveUiRoot, resolveSharedRoot } from './paths.js';
import { assertLoopbackHost, createOriginGuard, createRateLimiter, scrubError } from './security.js';
import { APP_VERSION } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StartOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  openUi?: boolean;
  allowNonLoopback?: boolean;
}

export async function startServer(opts: StartOptions = {}) {
  const store = new VaultStore(opts.dataDir);
  let host = opts.host || process.env.VAULTAI_HOST || '127.0.0.1';
  const port = Number(opts.port || process.env.VAULTAI_PORT || 3847);
  const allowNon =
    opts.allowNonLoopback === true ||
    process.env.VAULTAI_ALLOW_NON_LOOPBACK === '1' ||
    false;

  try {
    assertLoopbackHost(host, allowNon);
  } catch (e) {
    console.error('[VaultAI]', scrubError(e));
    host = '127.0.0.1';
    console.error('[VaultAI] Falling back to 127.0.0.1');
  }

  store.setListenAddress(host, port);

  const app = express();
  app.set('trust proxy', false);
  // No permissive CORS: only the app's own loopback origin may call the API from a browser.
  app.use(createOriginGuard(() => port, () => allowNon));
  app.use(express.json({ limit: '2mb' }));

  const rateLimit = createRateLimiter(() => {
    try {
      if (store.unlocked) return store.getSettings().rateLimitPerMinute ?? 120;
    } catch { /* */ }
    return 120;
  });
  // AI-facing surfaces (MCP + token tool invoke) use the configured limit.
  app.use('/mcp', rateLimit);
  app.use('/api/tool', rateLimit);
  // Local UI control plane: much higher ceiling so normal desktop use never trips it.
  const uiLimit = createRateLimiter(() => {
    try {
      if (store.unlocked) return Math.max(1200, (store.getSettings().rateLimitPerMinute ?? 120) * 10);
    } catch { /* */ }
    return 1200;
  });
  app.use('/api', (req, res, next) => (req.path.startsWith('/tool') ? next() : uiLimit(req, res, next)));

  const uiRoot = resolveUiRoot();
  app.use(express.static(uiRoot));
  app.use('/shared', express.static(resolveSharedRoot(), { fallthrough: false }));

  mountApi(app, store);
  mountMcp(app, store);

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/oauth'))
      return next();
    res.sendFile(join(uiRoot, 'index.html'), (err) => {
      if (err) next();
    });
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });

  console.log(`[VaultAI] v${APP_VERSION} listening on http://${host}:${port}`);
  console.log(`[VaultAI] MCP endpoint: http://${host}:${port}/mcp`);
  console.log(`[VaultAI] data dir: ${store.getDataDir()}`);

  return { app, server, store, host, port };
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const isMain =
  /\/server\/index\.(js|ts)$/.test(entry) || process.env.VAULTAI_FORCE_START === '1';

if (isMain) {
  startServer().catch((e) => {
    console.error('[VaultAI] failed to start:', scrubError(e));
    process.exit(1);
  });
}
