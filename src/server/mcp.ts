import type { Express, Request, Response } from 'express';
import type { VaultStore } from '../store/db.js';
import { hashToken } from '../crypto/vault.js';
import { assertAssistantActive, invokeTool, listToolsForAssistant } from './tools.js';
import { APP_VERSION } from '../types/index.js';

/** Protocol versions we can speak; the client's requested version is echoed when supported. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Tokens travel in headers only — never in the URL, where they end up in logs and history. */
function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const h = req.headers['x-vaultai-token'];
  if (typeof h === 'string' && h) return h.trim();
  return null;
}

function resolveAssistant(store: VaultStore, req: Request) {
  if (!store.unlocked) {
    return { error: { ok: false as const, code: 'VAULT_LOCKED', message: 'Vault is locked', fix: 'Unlock VaultAI on this computer' } };
  }
  const token = extractToken(req);
  if (!token) {
    return { error: { ok: false as const, code: 'AUTH_REQUIRED', message: 'Missing access token', fix: 'Send Authorization: Bearer <token>' } };
  }
  const asst = store.findAssistantByTokenHash(hashToken(token));
  if (!asst) {
    return { error: { ok: false as const, code: 'AUTH_INVALID', message: 'Invalid access token', fix: 'Copy the setup again from VaultAI → AI assistants' } };
  }
  store.touchAssistant(asst.id);
  return { asst };
}

/** MCP over HTTP (JSON responses, no server-initiated stream). */
export function mountMcp(app: Express, store: VaultStore): void {
  app.get('/mcp', (req, res) => {
    // Streamable-HTTP clients probe GET for an SSE stream; we do not offer one.
    if (String(req.headers.accept || '').includes('text/event-stream')) {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST /mcp (JSON-RPC)' });
    }
    res.json({ name: 'VaultAI Tools', version: APP_VERSION, rpc: 'POST /mcp', auth: 'Authorization: Bearer <access token>' });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const body = req.body || {};
    const method = String(body.method || '');
    const isNotification = body.id === undefined || body.id === null;
    const id = body.id ?? null;

    const r = resolveAssistant(store, req);
    if ('error' in r && r.error) {
      return res.status(401).json({ jsonrpc: '2.0', id, error: { code: -32001, message: r.error.message, data: r.error } });
    }
    // JSON-RPC notifications get no response body.
    if (isNotification) return res.status(202).end();

    try {
      if (method === 'initialize') {
        const asked = String(body.params?.protocolVersion || '');
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'vaultai', version: APP_VERSION },
          },
        });
      }
      if (method === 'ping') return res.json({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') {
        const blocked = assertAssistantActive(r.asst!);
        if (blocked) return res.status(403).json({ jsonrpc: '2.0', id, error: { code: -32003, message: blocked.message, data: blocked } });
        const tools = listToolsForAssistant(store, r.asst!);
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
            })),
          },
        });
      }
      if (method === 'tools/call') {
        const name = String(body.params?.name || '');
        const args = (body.params?.arguments || {}) as Record<string, unknown>;
        const result = await invokeTool({ store, assistant: r.asst! }, name, args);
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result.ok ? result.data : result) }],
            isError: !result.ok,
          },
        });
      }
      return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      return res.status(500).json({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' } });
    }
  });
}
