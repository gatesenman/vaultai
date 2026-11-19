import type { ToolResult } from '../types/index.js';
import { levelAllows, methodNeedsWrite } from './permissions.js';
import type { PermissionLevel } from '../types/index.js';
import { vendorBase } from './preset-base.js';


async function gh(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${vendorBase('github')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'VaultAI-Tools',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

export async function githubTool(
  action: string,
  args: Record<string, unknown>,
  token: string,
  level: PermissionLevel
): Promise<ToolResult> {
  const toolKey = `github:${action}`;
  const needMap: Record<string, PermissionLevel> = {
    list_repos: 'read',
    search_repos: 'read',
    list_issues: 'read',
    get_issue: 'read',
    list_prs: 'read',
    create_issue: 'write',
  };
  const need = needMap[action] || 'full';
  if (!levelAllows(level, need)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `Action github:${action} requires ${need}; assistant has ${level}`,
      fix: `Raise permission for GitHub to at least ${need} in VaultAI → AI assistants → Access`,
    };
  }

  try {
    switch (action) {
      case 'list_repos': {
        const q = new URLSearchParams({
          per_page: String(args.per_page || 30),
          sort: String(args.sort || 'updated'),
        });
        const { status, body } = await gh(token, `/user/repos?${q}`);
        if (status >= 400) {
          return { ok: false, code: 'GITHUB_API_ERROR', message: `GitHub HTTP ${status}`, fix: 'Check PAT scopes (repo/public_repo)' };
        }
        const repos = Array.isArray(body)
          ? (body as Array<Record<string, unknown>>).map((r) => ({
              full_name: r.full_name,
              private: r.private,
              html_url: r.html_url,
              description: r.description,
              updated_at: r.updated_at,
            }))
          : body;
        return { ok: true, data: repos };
      }
      case 'search_repos': {
        const query = String(args.q || args.query || '');
        if (!query) {
          return { ok: false, code: 'BAD_ARGS', message: 'q/query required', fix: 'Pass q=owner/name keywords' };
        }
        const q = new URLSearchParams({ q: query, per_page: String(args.per_page || 20) });
        const { status, body } = await gh(token, `/search/repositories?${q}`);
        if (status >= 400) {
          return { ok: false, code: 'GITHUB_API_ERROR', message: `GitHub HTTP ${status}` };
        }
        const items = (body as { items?: unknown[] })?.items || [];
        return { ok: true, data: items };
      }
      case 'list_issues': {
        const owner = String(args.owner || '');
        const repo = String(args.repo || '');
        if (!owner || !repo) {
          return { ok: false, code: 'BAD_ARGS', message: 'owner and repo required' };
        }
        const q = new URLSearchParams({
          state: String(args.state || 'open'),
          per_page: String(args.per_page || 30),
        });
        const { status, body } = await gh(token, `/repos/${owner}/${repo}/issues?${q}`);
        if (status >= 400) {
          return { ok: false, code: 'GITHUB_API_ERROR', message: `GitHub HTTP ${status}` };
        }
        return { ok: true, data: body };
      }
      case 'get_issue': {
        const owner = String(args.owner || '');
        const repo = String(args.repo || '');
        const number = String(args.number || args.issue_number || '');
        if (!owner || !repo || !number) {
          return { ok: false, code: 'BAD_ARGS', message: 'owner, repo, number required' };
        }
        const { status, body } = await gh(token, `/repos/${owner}/${repo}/issues/${number}`);
        if (status >= 400) {
          return { ok: false, code: 'GITHUB_API_ERROR', message: `GitHub HTTP ${status}` };
        }
        return { ok: true, data: body };
      }
      case 'list_prs': {
        const owner = String(args.owner || '');
        const repo = String(args.repo || '');
        if (!owner || !repo) {
          return { ok: false, code: 'BAD_ARGS', message: 'owner and repo required' };
        }
        const q = new URLSearchParams({
          state: String(args.state || 'open'),
          per_page: String(args.per_page || 30),
        });
        const { status, body } = await gh(token, `/repos/${owner}/${repo}/pulls?${q}`);
        if (status >= 400) {
          return { ok: false, code: 'GITHUB_API_ERROR', message: `GitHub HTTP ${status}` };
        }
        return { ok: true, data: body };
      }
      case 'create_issue': {
        const owner = String(args.owner || '');
        const repo = String(args.repo || '');
        const title = String(args.title || '');
        const bodyText = args.body != null ? String(args.body) : '';
        if (!owner || !repo || !title) {
          return { ok: false, code: 'BAD_ARGS', message: 'owner, repo, title required' };
        }
        const { status, body } = await gh(token, `/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body: bodyText }),
        });
        if (status >= 400) {
          return { ok: false, code: 'GITHUB_API_ERROR', message: `GitHub HTTP ${status}`, fix: 'Need write permission + PAT with issues scope' };
        }
        return { ok: true, data: body };
      }
      default:
        return {
          ok: false,
          code: 'UNKNOWN_ACTION',
          message: `Unknown github action: ${action}`,
          fix: 'Use list_repos, search_repos, list_issues, get_issue, list_prs, create_issue',
        };
    }
  } catch (e) {
    return {
      ok: false,
      code: 'GITHUB_NETWORK',
      message: e instanceof Error ? e.message : 'Network error',
      fix: 'Check internet connectivity',
    };
  }
}

// silence unused import warning path
void methodNeedsWrite;
