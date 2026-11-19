#!/usr/bin/env node
/**
 * VaultAI stdio MCP bridge — for clients that launch MCP servers as a process (Claude Desktop).
 * Reads newline-delimited JSON-RPC from stdin and forwards each message to the local HTTP
 * endpoint (POST /mcp). Requests get exactly one response line; notifications get none.
 *
 * VaultAI → AI assistants → Setup generates the exact config, e.g. for the installed app:
 *   { "command": "C:\\...\\VaultAI.exe", "args": ["C:\\...\\resources\\app.asar\\bin\\vaultai-mcp-stdio.js"],
 *     "env": { "ELECTRON_RUN_AS_NODE": "1", "VAULTAI_URL": "http://127.0.0.1:3847", "VAULTAI_TOKEN": "vai_…" } }
 */
import readline from 'node:readline';

const BASE = (process.env.VAULTAI_URL || 'http://127.0.0.1:3847').replace(/\/$/, '');
const TOKEN = process.env.VAULTAI_TOKEN || '';

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function forward(msg) {
  const isRequest = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null;
  try {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(msg),
    });
    if (!isRequest) return; // notification: nothing goes back to the client
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); } catch { out = null; }
    if (out && typeof out === 'object' && out.jsonrpc) write(out);
    else write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `VaultAI returned HTTP ${res.status}` } });
  } catch (e) {
    if (!isRequest) return;
    write({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32000, message: `VaultAI is not reachable at ${BASE} — open VaultAI and unlock it (${e instanceof Error ? e.message : e})` },
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  void forward(msg);
});
