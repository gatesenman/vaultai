import type { AssistantRecord, PermissionLevel, Refusal, ToolResult } from '../types/index.js';
import type { VaultStore } from '../store/db.js';
import { githubTool } from '../connectors/github.js';
import { genericHttpRequest } from '../connectors/generic.js';
import { demoEcho, demoPing } from '../connectors/demo.js';
import { gmailTool } from '../connectors/gmail.js';
import { gcalTool } from '../connectors/gcal.js';
import { notionTool } from '../connectors/notion.js';
import { stripeTool } from '../connectors/stripe.js';
import { levelAllows } from '../connectors/permissions.js';
import { scrubError } from './security.js';
import { passwordsTool, getPasswordsPermission } from '../connectors/passwords.js';
import { PASSWORDS_PERM_KEY } from '../types/index.js';
import { generate, GeneratorError } from '../shared/generator.js';
import { estimateStrength } from '../shared/strength.js';
import { getPreset } from '../shared/presets.js';
import { isDevMode } from './devmode.js';

export interface InvokeContext {
  store: VaultStore;
  assistant: AssistantRecord;
}

function refusal(code: string, message: string, fix?: string): Refusal {
  return { ok: false, code, message, fix };
}

export function assertAssistantActive(asst: AssistantRecord): Refusal | null {
  if (!asst.enabled) {
    return refusal(
      'ASSISTANT_DISABLED',
      `Assistant "${asst.name}" is turned off`,
      'Turn it back on in VaultAI → AI assistants'
    );
  }
  if (asst.expiresAt && Date.now() > new Date(asst.expiresAt).getTime()) {
    return refusal(
      'ASSISTANT_EXPIRED',
      `Assistant "${asst.name}" expired at ${asst.expiresAt}`,
      'Renew it in VaultAI → AI assistants'
    );
  }
  return null;
}

type ToolDef = {
  name: string;
  description: string;
  appId: string;
  appName: string;
  level: PermissionLevel;
  inputSchema?: Record<string, unknown>;
};

function pushIf(
  tools: ToolDef[],
  level: PermissionLevel,
  need: PermissionLevel,
  def: Omit<ToolDef, 'level'>
) {
  if (!levelAllows(level, need)) return;
  tools.push({ ...def, level });
}

const SCHEMA_OBJ = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

export function listToolsForAssistant(store: VaultStore, asst: AssistantRecord) {
  const apps = store.listApplications();
  const tools: ToolDef[] = [];

  for (const app of apps) {
    const level = (asst.permissions[app.id] || 'off') as PermissionLevel;
    if (level === 'off') continue;
    const base = { appId: app.id, appName: app.name, inputSchema: SCHEMA_OBJ };

    if (app.kind === 'github') {
      for (const [a, d] of [
        ['list_repos', 'List repositories'],
        ['search_repos', 'Search repos (q)'],
        ['list_issues', 'List issues (owner, repo)'],
        ['get_issue', 'Get issue'],
        ['list_prs', 'List PRs'],
      ] as const) {
        pushIf(tools, level, 'read', { ...base, name: `github_${a}`, description: d });
      }
      pushIf(tools, level, 'write', {
        ...base,
        name: 'github_create_issue',
        description: 'Create issue (owner, repo, title, body?)',
      });
    } else if (app.kind === 'generic') {
      const preset = getPreset(app.meta.preset);
      const ex = preset.example;
      pushIf(tools, level, 'read', {
        ...base,
        name: `generic_${app.id}_http_request`,
        description:
          `HTTP request to ${app.name} (${app.meta.baseUrl || 'base URL not set'}). VaultAI adds the credential. ` +
          `Args: method (GET by default), path relative to the base URL, body (JSON), headers. ` +
          (preset.graphql ? 'GraphQL: POST /graphql with {query}; queries need Read, mutations need Write. ' : 'GET needs Read; other methods need Write. ') +
          `Example: ${ex.method} ${ex.path}`,
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
            path: { type: 'string', description: 'Path under the base URL, e.g. /v1/items?limit=10' },
            body: { description: 'JSON body' },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
          },
          additionalProperties: true,
        },
      });
    } else if (app.kind === 'demo') {
      if (!isDevMode()) continue;
      pushIf(tools, level, 'read', { ...base, name: 'demo_echo', description: 'Echo message (developer mode)' });
      pushIf(tools, level, 'read', { ...base, name: 'demo_ping', description: 'Ping (developer mode)' });
    } else if (app.kind === 'gmail') {
      pushIf(tools, level, 'read', { ...base, name: 'gmail_search', description: 'Search mail (q)' });
      pushIf(tools, level, 'read', { ...base, name: 'gmail_get', description: 'Get message (id)' });
      pushIf(tools, level, 'read', { ...base, name: 'gmail_list_labels', description: 'List labels' });
      pushIf(tools, level, 'write', { ...base, name: 'gmail_create_draft', description: 'Create draft (to, subject, body?)' });
      pushIf(tools, level, 'write', { ...base, name: 'gmail_modify', description: 'Modify labels' });
      pushIf(tools, level, 'write', { ...base, name: 'gmail_archive', description: 'Archive' });
      pushIf(tools, level, 'full', { ...base, name: 'gmail_send', description: 'Send mail' });
    } else if (app.kind === 'gcal') {
      pushIf(tools, level, 'read', { ...base, name: 'gcal_list_calendars', description: 'List calendars' });
      pushIf(tools, level, 'read', { ...base, name: 'gcal_list_events', description: 'List events' });
      pushIf(tools, level, 'read', { ...base, name: 'gcal_get_event', description: 'Get event' });
      pushIf(tools, level, 'write', { ...base, name: 'gcal_create_event', description: 'Create event' });
    } else if (app.kind === 'notion') {
      pushIf(tools, level, 'read', { ...base, name: 'notion_search', description: 'Search' });
      pushIf(tools, level, 'read', { ...base, name: 'notion_get_page', description: 'Get page' });
      pushIf(tools, level, 'read', { ...base, name: 'notion_get_blocks', description: 'Get blocks' });
      pushIf(tools, level, 'write', { ...base, name: 'notion_create_page', description: 'Create page' });
      pushIf(tools, level, 'write', { ...base, name: 'notion_append_blocks', description: 'Append blocks' });
    } else if (app.kind === 'stripe') {
      pushIf(tools, level, 'read', { ...base, name: 'stripe_list_customers', description: 'List customers' });
      pushIf(tools, level, 'read', { ...base, name: 'stripe_list_charges', description: 'List charges' });
      pushIf(tools, level, 'read', {
        ...base,
        name: 'stripe_list_payment_intents',
        description: 'List payment intents',
      });
      pushIf(tools, level, 'write', {
        ...base,
        name: 'stripe_create_customer',
        description: 'Create customer',
      });
    }
  }

  // Password manager (special permission key — not an ApplicationRecord)
  const pwLevel = getPasswordsPermission(asst);
  if (pwLevel !== 'off') {
    const base = {
      appId: PASSWORDS_PERM_KEY,
      appName: 'Passwords',
      inputSchema: SCHEMA_OBJ,
    };
    pushIf(tools, pwLevel, 'read', {
      ...base,
      name: 'passwords_list',
      description: 'List/search password entries (metadata only: title, username, url, tags)',
    });
    pushIf(tools, pwLevel, 'read', {
      ...base,
      name: 'passwords_get',
      description: 'Get password entry metadata by id (no password value)',
    });
    pushIf(tools, pwLevel, 'full', {
      ...base,
      name: 'passwords_get_password',
      description: 'Reveal password value by id (Full permission; logged in activity)',
    });
  }

  // Password generator: always available to an active assistant — no permission, no vault data.
  tools.push({
    name: 'generate_password',
    description: 'Generate a strong random password, passphrase or PIN locally (no vault access, nothing stored). Args: mode (password|passphrase|pin), length (8–128; PIN 4–12), upper/lower/digits/symbols (bool), excludeAmbiguous, exclude, minDigits, minSymbols, avoidRepeats, words (3–12), separator, capitalize, includeNumber',
    appId: 'generator',
    appName: 'Generator',
    level: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['password', 'passphrase', 'pin'] },
        length: { type: 'integer', minimum: 4, maximum: 128 },
        upper: { type: 'boolean' }, lower: { type: 'boolean' }, digits: { type: 'boolean' }, symbols: { type: 'boolean' },
        excludeAmbiguous: { type: 'boolean' }, exclude: { type: 'string' },
        minDigits: { type: 'integer', minimum: 0 }, minSymbols: { type: 'integer', minimum: 0 },
        avoidRepeats: { type: 'boolean' },
        words: { type: 'integer', minimum: 3, maximum: 12 }, separator: { type: 'string' },
        capitalize: { type: 'boolean' }, includeNumber: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  });

  return tools;
}

export async function invokeTool(
  ctx: InvokeContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { store, assistant } = ctx;
  const blocked = assertAssistantActive(assistant);
  if (blocked) {
    store.addActivity({
      assistantId: assistant.id,
      assistantName: assistant.name,
      appId: null,
      appName: '-',
      action: toolName,
      ok: false,
      reason: blocked.message,
      code: blocked.code,
    });
    return blocked;
  }

  if (toolName === 'generate_password') {
    try {
      const r = generate(args as never);
      const s = estimateStrength(r.value);
      store.addActivity({ assistantId: assistant.id, assistantName: assistant.name, appId: 'generator', appName: 'Generator', action: `generator:${r.mode}`, ok: true });
      return { ok: true, data: { password: r.value, mode: r.mode, length: r.length, entropyBits: r.entropyBits, strength: { score: s.score, bits: s.bits }, note: 'Generated locally; not stored in the vault.' } };
    } catch (e) {
      const code = e instanceof GeneratorError ? e.code : 'BAD_ARGS';
      return refusal(code, e instanceof Error ? e.message : 'generation failed', 'Relax the options (e.g. longer length or fewer minimums)');
    }
  }

  let appId: string | null = null;
  let action = toolName;
  let appKind: string | null = null;
  const findKind = (kind: string) => store.listApplications().find((a) => a.kind === kind);

  const prefixes: Array<[string, string]> = [
    ['github_', 'github'],
    ['gmail_', 'gmail'],
    ['gcal_', 'gcal'],
    ['notion_', 'notion'],
    ['stripe_', 'stripe'],
  ];

  let matched = false;
  for (const [prefix, kind] of prefixes) {
    if (toolName.startsWith(prefix)) {
      const app = findKind(kind);
      if (!app) {
        const r = refusal('NO_APP', `No ${kind} connection`, `Add ${kind} in VaultAI → Connections`);
        store.addActivity({
          assistantId: assistant.id,
          assistantName: assistant.name,
          appId: null,
          appName: kind,
          action: toolName,
          ok: false,
          reason: r.message,
          code: r.code,
        });
        return r;
      }
      appId = app.id;
      appKind = kind;
      action = toolName.slice(prefix.length);
      matched = true;
      break;
    }
  }

  if (!matched && toolName.startsWith('passwords_')) {
    appId = PASSWORDS_PERM_KEY;
    appKind = 'passwords';
    action = toolName.slice('passwords_'.length);
    matched = true;
  } else if (!matched && toolName.startsWith('generic_') && toolName.endsWith('_http_request')) {
    appId = toolName.slice('generic_'.length, -'_http_request'.length);
    appKind = 'generic';
    action = 'http_request';
    matched = true;
  } else if (!matched && isDevMode() && (toolName === 'demo_echo' || toolName === 'demo_ping')) {
    appId = findKind('demo')?.id || 'app_demo_builtin';
    appKind = 'demo';
    action = toolName.replace(/^demo_/, '');
    matched = true;
  }

  if (!matched) {
    const r = refusal('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
    store.addActivity({
      assistantId: assistant.id,
      assistantName: assistant.name,
      appId: null,
      appName: '-',
      action: toolName,
      ok: false,
      reason: r.message,
      code: r.code,
    });
    return r;
  }

  const app = appId ? store.getApplication(appId) : undefined;
  const appName = app?.name || appKind || '-';
  const level = (assistant.permissions[appId!] || 'off') as PermissionLevel;

  if (level === 'off') {
    const r = refusal('PERMISSION_DENIED', `No access to ${appName}`, 'Grant access in VaultAI → AI assistants → Access');
    store.addActivity({
      assistantId: assistant.id,
      assistantName: assistant.name,
      appId,
      appName,
      action: `${appKind}:${action}`,
      ok: false,
      reason: r.message,
      code: r.code,
    });
    return r;
  }

  const limitKey = `${appKind}:${action}`;
  const lim = store.checkAndIncrementLimit(limitKey);
  if (!lim.ok) {
    const r = refusal(
      'DAILY_LIMIT',
      `Daily limit reached for ${limitKey} (${lim.used}/${lim.limit})`,
      'Raise limit or wait until midnight UTC'
    );
    store.addActivity({
      assistantId: assistant.id,
      assistantName: assistant.name,
      appId,
      appName,
      action: limitKey,
      ok: false,
      reason: r.message,
      code: r.code,
    });
    return r;
  }

  let result: ToolResult;
  try {
    if (appKind === 'github') result = await githubTool(action, args, store.getSecret(appId!), level);
    else if (appKind === 'generic') {
      if (!app || app.kind !== 'generic') result = refusal('NO_APP', 'Connection not found');
      else result = await genericHttpRequest(args as never, store.getSecret(appId!), app.meta, level);
    }
    else if (appKind === 'demo')
      result = action === 'ping' ? demoPing(level) : demoEcho(args as never, level);
    else if (appKind === 'gmail') result = await gmailTool(store, action, args, level);
    else if (appKind === 'gcal') result = await gcalTool(store, action, args, level);
    else if (appKind === 'notion')
      result = await notionTool(action, args, store.getSecret(appId!), level);
    else if (appKind === 'stripe')
      result = await stripeTool(action, args, store.getSecret(appId!), level);
    else if (appKind === 'passwords') result = passwordsTool(store, action, args, level);
    else result = refusal('INTERNAL', 'Unhandled app kind');
  } catch (e) {
    result = refusal('INTERNAL', scrubError(e));
  }

  if (!result.ok) {
    result = { ...result, message: scrubError(result.message) };
  }

  store.addActivity({
    assistantId: assistant.id,
    assistantName: assistant.name,
    appId,
    appName,
    action: `${appKind}:${action}`,
    ok: result.ok,
    reason: result.ok ? undefined : result.message,
    code: result.ok ? undefined : result.code,
  });

  return result;
}
