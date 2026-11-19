/**
 * Autofill match ranking — pure, no I/O. Used by the picker and unit tests.
 *
 * Score (higher wins):
 *   +100  exact username (case-insensitive)
 *   +70   username starts with the typed query
 *   +50   username contains the query
 *   +80   URL host equals detected host
 *   +55   URL host ends with detected host (subdomain) or title contains host
 *   +40   entry title starts with / contains query
 *   +25   tag contains query
 *   +15   favorite
 *   +10   recent (updated within 30 days) — tie-break only via updatedAt sort
 *
 * Empty query: favorites first, then by updatedAt desc (still capped).
 */

export interface AutofillCandidate {
  id: string;
  title: string;
  username: string;
  url?: string;
  tags?: string[];
  favorite?: boolean;
  updatedAt?: string;
}

export interface AutofillContext {
  /** What the user has typed into the focused account field (may be empty). */
  typed?: string;
  /** Hostname or URL from the browser address bar / window title, if known. */
  host?: string;
  /** Foreground window title. */
  windowTitle?: string;
  /** Process name without .exe, e.g. "chrome". */
  processName?: string;
}

export interface RankedMatch extends AutofillCandidate {
  score: number;
  reasons: string[];
}

function hostOf(urlOrHost?: string): string {
  if (!urlOrHost) return '';
  const s = urlOrHost.trim().toLowerCase();
  if (!s) return '';
  try {
    if (s.includes('://')) return new URL(s).hostname.replace(/^www\./, '');
    if (s.includes('/') && s.includes('.')) return new URL('https://' + s).hostname.replace(/^www\./, '');
    return s.replace(/^www\./, '').split(/[/?#:\s]/)[0];
  } catch {
    return s.replace(/^www\./, '').split(/[/?#:\s]/)[0];
  }
}

function extractHostsFromTitle(title?: string): string[] {
  if (!title) return [];
  const out: string[] = [];
  // Common patterns: "Sign in - example.com", "example.com - Google Chrome"
  const re = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title))) {
    const h = m[1].toLowerCase().replace(/^www\./, '');
    if (!out.includes(h) && !/\.(exe|dll|js|css|png|jpg)$/i.test(h)) out.push(h);
  }
  return out;
}

export function normalizeQuery(q?: string): string {
  return (q || '').trim().toLowerCase();
}

/** Rank and filter candidates. Returns at most `limit` (default 12). */
export function rankAutofillMatches(
  entries: AutofillCandidate[],
  ctx: AutofillContext,
  limit = 12,
): RankedMatch[] {
  const q = normalizeQuery(ctx.typed);
  const detectedHosts = new Set<string>();
  const h = hostOf(ctx.host);
  if (h) detectedHosts.add(h);
  for (const t of extractHostsFromTitle(ctx.windowTitle)) detectedHosts.add(t);

  const ranked: RankedMatch[] = [];
  for (const e of entries) {
    const reasons: string[] = [];
    let score = 0;
    const user = (e.username || '').toLowerCase();
    const title = (e.title || '').toLowerCase();
    const tags = (e.tags || []).map((t) => t.toLowerCase());
    const entryHost = hostOf(e.url);

    if (q) {
      if (user && user === q) { score += 100; reasons.push('user-exact'); }
      else if (user && user.startsWith(q)) { score += 70; reasons.push('user-prefix'); }
      else if (user && user.includes(q)) { score += 50; reasons.push('user-contains'); }

      if (title.startsWith(q)) { score += 40; reasons.push('title-prefix'); }
      else if (title.includes(q)) { score += 25; reasons.push('title-contains'); }

      if (tags.some((t) => t.includes(q))) { score += 25; reasons.push('tag'); }
    }

    if (entryHost && detectedHosts.size) {
      for (const dh of detectedHosts) {
        if (entryHost === dh) { score += 80; reasons.push('host-exact'); break; }
        if (entryHost.endsWith('.' + dh) || dh.endsWith('.' + entryHost)) {
          score += 55; reasons.push('host-related'); break;
        }
      }
    } else if (entryHost && ctx.windowTitle && ctx.windowTitle.toLowerCase().includes(entryHost)) {
      score += 55; reasons.push('host-in-title');
    }

    if (e.favorite) { score += 15; reasons.push('favorite'); }

    // No query and no host signal: still show favorites / recent so the picker is useful
    if (!q && !detectedHosts.size && !e.favorite) {
      // keep a low baseline so empty-state can still list a few recent items
      score += 1;
    }

    if (score > 0 || (!q && !detectedHosts.size)) {
      ranked.push({ ...e, score: score || (e.favorite ? 15 : 1), reasons });
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.updatedAt || '';
    const tb = b.updatedAt || '';
    if (ta !== tb) return tb.localeCompare(ta);
    return (a.title || '').localeCompare(b.title || '');
  });

  // If the user typed something, drop zero-relevance noise (score only from favorite with no text match)
  const filtered = q
    ? ranked.filter((r) => r.reasons.some((x) => x.startsWith('user') || x.startsWith('title') || x.startsWith('tag') || x.startsWith('host')))
    : ranked;

  return filtered.slice(0, limit);
}

/** Word-boundary check for the text trigger: previous char must be empty or non-alphanumeric. */
export function isTriggerBoundary(prevChar: string | undefined): boolean {
  if (prevChar === undefined || prevChar === '') return true;
  return !/[A-Za-z0-9]/.test(prevChar);
}

/** Default trigger string. */
export const DEFAULT_TEXT_TRIGGER = 'pp';
export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+P';

/** Global hotkey for tray quick-create sheet (1.8.0). Distinct from autofill DEFAULT_HOTKEY. */
export const DEFAULT_QC_HOTKEY = 'CommandOrControl+Shift+N';
export const DEFAULT_SAVE_HOTKEY = 'CommandOrControl+Shift+S';
