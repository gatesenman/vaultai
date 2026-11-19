/**
 * Per-client MCP setup snippets (1.5.0). The assistant's client kind decides what we show:
 *  - Claude Desktop: stdio bridge, launched with the VaultAI executable itself (no Node needed)
 *  - Cursor: HTTP url + Authorization header
 *  - Claude Code: `claude mcp add --transport http …`
 *  - Terminal: environment variables + the bundled CLI
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AssistantRecord } from '../types/index.js';
import { resolveAppRoot } from './paths.js';

export interface SetupInfo {
  client: AssistantRecord['kind'];
  mcpUrl: string;
  baseUrl: string;
  token: string;
  platform: string;
  warnings: string[];
  claudeDesktop: { file: string; json: unknown };
  cursor: { file: string; json: unknown };
  claudeCode: { command: string };
  terminal: { lines: string[] };
}

function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

export function buildSetup(asst: AssistantRecord, token: string, host: string, port: number): SetupInfo {
  const baseUrl = `http://${host}:${port}`;
  const mcpUrl = `${baseUrl}/mcp`;
  const root = resolveAppRoot();
  const bridge = join(root, 'bin', 'vaultai-mcp-stdio.js');
  const cli = join(root, 'bin', 'vaultai.js');
  const electron = Boolean(process.versions.electron);
  const command = process.execPath;
  const env: Record<string, string> = { VAULTAI_URL: baseUrl, VAULTAI_TOKEN: token };
  if (electron) env.ELECTRON_RUN_AS_NODE = '1';
  const warnings: string[] = [];
  if (process.env.PORTABLE_EXECUTABLE_FILE) warnings.push('portable');
  const win = process.platform === 'win32';
  const q = (s: string) => (s.includes(' ') ? `"${s}"` : s);
  const terminal = win
    ? [
        `$env:VAULTAI_URL = "${baseUrl}"`,
        `$env:VAULTAI_TOKEN = "${token}"`,
        ...(electron ? ['$env:ELECTRON_RUN_AS_NODE = "1"'] : []),
        `& "${command}" "${cli}" tool ls`,
      ]
    : [
        `export VAULTAI_URL=${baseUrl}`,
        `export VAULTAI_TOKEN=${token}`,
        ...(electron ? ['export ELECTRON_RUN_AS_NODE=1'] : []),
        `${q(command)} ${q(cli)} tool ls`,
      ];
  return {
    client: asst.kind,
    mcpUrl,
    baseUrl,
    token,
    platform: process.platform,
    warnings,
    claudeDesktop: {
      file: claudeDesktopConfigPath(),
      json: { mcpServers: { vaultai: { command, args: [bridge], env } } },
    },
    cursor: {
      file: join(win ? process.env.USERPROFILE || homedir() : homedir(), '.cursor', 'mcp.json'),
      json: { mcpServers: { vaultai: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
    },
    claudeCode: { command: `claude mcp add --transport http vaultai ${mcpUrl} --header "Authorization: Bearer ${token}"` },
    terminal: { lines: terminal },
  };
}
