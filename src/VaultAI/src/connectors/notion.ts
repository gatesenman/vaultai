import type { PermissionLevel, ToolResult } from '../types/index.js';
import { levelAllows } from './permissions.js';
import { vendorBase } from './preset-base.js';

const NOTION_VERSION = '2022-06-28';

async function notionFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${vendorBase('notion')}/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
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
  if (action === 'search' || action === 'get_page' || action === 'get_blocks') return 'read';
  if (action === 'create_page' || action === 'append_blocks') return 'write';
  return 'full';
}

export async function notionTool(
  action: string,
  args: Record<string, unknown>,
  token: string,
  level: PermissionLevel
): Promise<ToolResult> {
  const need = needFor(action);
  if (!levelAllows(level, need)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `notion:${action} requires ${need}; assistant has ${level}`,
      fix: `Raise Notion permission to at least ${need}`,
    };
  }

  try {
    switch (action) {
      case 'search': {
        const query = String(args.query || args.q || '');
        const { status, body } = await notionFetch(token, '/search', {
          method: 'POST',
          body: JSON.stringify({
            query: query || undefined,
            page_size: Number(args.page_size || 20),
            filter: args.filter || undefined,
          }),
        });
        if (status >= 400) return { ok: false, code: 'NOTION_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'get_page': {
        const pageId = String(args.page_id || args.id || '');
        if (!pageId) return { ok: false, code: 'BAD_ARGS', message: 'page_id required' };
        const { status, body } = await notionFetch(token, `/pages/${pageId}`);
        if (status >= 400) return { ok: false, code: 'NOTION_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'get_blocks': {
        const blockId = String(args.block_id || args.page_id || args.id || '');
        if (!blockId) return { ok: false, code: 'BAD_ARGS', message: 'block_id or page_id required' };
        const { status, body } = await notionFetch(
          token,
          `/blocks/${blockId}/children?page_size=${Number(args.page_size || 50)}`
        );
        if (status >= 400) return { ok: false, code: 'NOTION_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'create_page': {
        const parent = args.parent as Record<string, unknown> | undefined;
        const title = String(args.title || 'Untitled');
        if (!parent) {
          return {
            ok: false,
            code: 'BAD_ARGS',
            message: 'parent required, e.g. { database_id } or { page_id }',
          };
        }
        const properties =
          (args.properties as Record<string, unknown>) ||
          ({
            title: {
              title: [{ text: { content: title } }],
            },
          } as Record<string, unknown>);
        // If parent is page_id, use title as child page title property differently
        const payload: Record<string, unknown> = {
          parent,
          properties,
        };
        if (args.children) payload.children = args.children;
        const { status, body } = await notionFetch(token, '/pages', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (status >= 400) return { ok: false, code: 'NOTION_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      case 'append_blocks': {
        const blockId = String(args.block_id || args.page_id || '');
        const children = args.children as unknown[];
        if (!blockId || !Array.isArray(children)) {
          return {
            ok: false,
            code: 'BAD_ARGS',
            message: 'block_id/page_id and children[] required',
          };
        }
        const { status, body } = await notionFetch(token, `/blocks/${blockId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({ children }),
        });
        if (status >= 400) return { ok: false, code: 'NOTION_API', message: `HTTP ${status}` };
        return { ok: true, data: body };
      }
      default:
        return {
          ok: false,
          code: 'UNKNOWN_ACTION',
          message: `Unknown notion action: ${action}`,
          fix: 'search, get_page, get_blocks, create_page, append_blocks',
        };
    }
  } catch (e) {
    return {
      ok: false,
      code: 'NOTION_NETWORK',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
