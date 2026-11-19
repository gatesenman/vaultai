/**
 * Password import parsers (VaultAI 1.9.0).
 * Auto-detects: Password Depot CSV/XML, Chrome/Edge CSV, Firefox CSV,
 * Bitwarden CSV, 1Password CSV, KeePass CSV (+ KeePass XML when straightforward),
 * and a generic CSV fallback.
 * Never logs secret values. Encrypted native formats (.pswe/.pswd/…) unsupported.
 */
export type ImportRow = {
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  tags?: string[];
  /** Raw TOTP secret or otpauth:// URI — encrypted on store */
  totp?: string;
};

export type ImportFormat =
  | 'password-depot-csv'
  | 'password-depot-xml'
  | 'chrome-csv'
  | 'edge-csv'
  | 'firefox-csv'
  | 'bitwarden-csv'
  | 'onepassword-csv'
  | 'keepass-csv'
  | 'keepass-xml'
  | 'generic-csv'
  | 'unknown';

export type ParsedImport = {
  format: ImportFormat;
  delimiter?: string;
  rows: ImportRow[];
  warnings: string[];
};

const TITLE_KEYS = [
  'description', 'title', 'name', 'account', 'entry name', 'entryname',
  'login name', // rarely title
];
const USER_KEYS = [
  'username', 'user name', 'user', 'login', 'login name', 'loginname',
  'login username', 'login_username', 'email', 'user name',
];
const PASS_KEYS = ['password', 'pass', 'login password', 'login_password', 'passwd'];
const URL_KEYS = [
  'url', 'website', 'web site', 'web', 'login uri', 'login_uri', 'uri', 'link',
  'form action origin', 'formactionorigin', 'web site', 'hostname',
];
const NOTES_KEYS = ['comments', 'comment', 'notes', 'note', 'memo', 'extra'];
const TAGS_KEYS = ['tags', 'tag', 'labels', 'label'];
const CATEGORY_KEYS = ['category', 'categories', 'folder', 'group', 'groups'];
const PATH_KEYS = ['entry path', 'entrypath', 'path', 'group tree', 'grouptree'];
const TOTP_KEYS = [
  'totp', 'otp', 'otpauth', 'otp auth', 'login totp', 'login_totp',
  'one time password', 'otpauth url', 'otpurl', '2fa', 'two factor',
];

/** Password Depot default column order when header row is omitted. */
const PD_DEFAULT_COLS = [
  'Description', 'Importance', 'Password', 'Modified', 'Expires',
  'Username', 'URL', 'Comments', 'Category', 'Tags', 'Author', 'Sequence', 'UUID',
] as const;

function normKey(s: string): string {
  return String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function pick(map: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = map[k];
    if (v != null && String(v).length) return String(v);
  }
  return '';
}

function splitTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/[,;|，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

function pathToTags(path: string): string[] {
  if (!path) return [];
  return path
    .split(/[/\\>→]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && !/^root$/i.test(s))
    .slice(0, 10);
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url);
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url.slice(0, 80);
  }
}

function finalizeRow(partial: {
  title?: string; username?: string; password?: string; url?: string; notes?: string; tags?: string[]; totp?: string;
}): ImportRow | null {
  const password = String(partial.password || '');
  const username = String(partial.username || '');
  const url = partial.url ? String(partial.url).trim() : undefined;
  let title = String(partial.title || '').trim();
  if (!title && url) title = titleFromUrl(url);
  if (!title && username) title = username;
  if (!title && !password && !username && !url) return null;
  if (!title) title = 'Imported item';
  const tags = [...new Set((partial.tags || []).map(String).map((t) => t.trim()).filter(Boolean))].slice(0, 20);
  const totp = partial.totp ? String(partial.totp).trim() : undefined;
  return {
    title: title.slice(0, 120),
    username: username.slice(0, 200),
    password,
    url: url || undefined,
    notes: partial.notes ? String(partial.notes).slice(0, 5000) : undefined,
    tags: tags.length ? tags : undefined,
    totp: totp || undefined,
  };
}

/** Parse one CSV line respecting quotes and doubled quotes. */
export function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function detectCsvDelimiter(text: string): ';' | ',' | '\t' {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let inQ = false;
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && (ch === ';' || ch === ',' || ch === '\t')) counts[ch]++;
  }
  if (counts['\t'] >= counts[';'] && counts['\t'] >= counts[','] && counts['\t'] > 0) return '\t';
  if (counts[';'] >= counts[','] && counts[';'] > 0) return ';';
  if (counts[','] > 0) return ',';
  return ';';
}

function rowFromMap(map: Record<string, string>): ImportRow | null {
  const tags = [
    ...splitTags(pick(map, TAGS_KEYS)),
    ...splitTags(pick(map, CATEGORY_KEYS)),
    ...pathToTags(pick(map, PATH_KEYS)),
  ];
  // Bitwarden favorite → tag
  if (map['favorite'] === '1' || /^true$/i.test(map['favorite'] || '')) tags.push('favorite');
  return finalizeRow({
    title: pick(map, TITLE_KEYS),
    username: pick(map, USER_KEYS),
    password: pick(map, PASS_KEYS),
    url: pick(map, URL_KEYS),
    notes: pick(map, NOTES_KEYS),
    tags,
    totp: pick(map, TOTP_KEYS),
  });
}

function looksLikeHeader(cells: string[]): boolean {
  const keys = cells.map(normKey);
  const hits = keys.filter((k) =>
    TITLE_KEYS.includes(k) || USER_KEYS.includes(k) || PASS_KEYS.includes(k) || URL_KEYS.includes(k)
    || k === 'login uri' || k === 'login username' || k === 'login password' || k === 'http realm'
  ).length;
  return hits >= 2;
}

function isPasswordDepotHeader(cells: string[]): boolean {
  const keys = new Set(cells.map(normKey));
  return keys.has('description') && (keys.has('password') || keys.has('username'));
}

/** Detect CSV dialect from normalized header keys. */
export function detectCsvFormat(headerKeys: string[], filename?: string): ImportFormat {
  const keys = new Set(headerKeys.map(normKey));
  const name = (filename || '').toLowerCase();

  // Bitwarden: login_uri / login_username / login_password / folder / type
  if (
    (keys.has('login uri') || keys.has('login_uri')) &&
    (keys.has('login username') || keys.has('login_username') || keys.has('login password') || keys.has('login_password'))
  ) return 'bitwarden-csv';
  if (keys.has('folder') && keys.has('type') && keys.has('name') && (keys.has('login uri') || keys.has('login_uri') || keys.has('login username'))) {
    return 'bitwarden-csv';
  }

  // Firefox: url,username,password,httpRealm,formActionOrigin,guid,timeCreated…
  if (keys.has('http realm') || keys.has('httprealm') || keys.has('form action origin') || keys.has('formactionorigin')) {
    return 'firefox-csv';
  }
  if (keys.has('guid') && keys.has('time created') && keys.has('url') && keys.has('username')) {
    return 'firefox-csv';
  }

  // Chrome / Edge: name,url,username,password[,note]
  if (keys.has('name') && keys.has('url') && keys.has('username') && keys.has('password') && !keys.has('description') && !keys.has('title')) {
    if (/edge/i.test(name)) return 'edge-csv';
    if (/chrome|google/i.test(name)) return 'chrome-csv';
    // Ambiguous Chrome/Edge — prefer chrome-csv unless filename says edge
    return 'chrome-csv';
  }

  // 1Password: Title,Url,Username,Password,OTPAuth / or Title,Website,Username…
  if (
    (keys.has('title') || keys.has('name')) &&
    (keys.has('otpauth') || keys.has('otp auth') || keys.has('one time password') || keys.has('vault') || keys.has('archived'))
  ) return 'onepassword-csv';
  if (keys.has('title') && keys.has('username') && keys.has('password') && (keys.has('url') || keys.has('website')) && keys.has('notes') && keys.has('tags')) {
    // Could be KeePass or 1P — KeePass often has Group
    if (keys.has('group') || keys.has('group tree')) return 'keepass-csv';
  }

  // KeePass CSV: Group,Title,Username,Password,URL,Notes[,TOTP]
  if (keys.has('group') && keys.has('title') && keys.has('password')) return 'keepass-csv';
  if (keys.has('account') && keys.has('login name') && keys.has('password') && keys.has('web site')) return 'keepass-csv';

  // Password Depot
  if (keys.has('description') && (keys.has('password') || keys.has('username'))) return 'password-depot-csv';

  return 'generic-csv';
}

export function formatLabel(format: ImportFormat): string {
  switch (format) {
    case 'password-depot-csv': return 'Password Depot CSV';
    case 'password-depot-xml': return 'Password Depot XML';
    case 'chrome-csv': return 'Chrome CSV';
    case 'edge-csv': return 'Edge CSV';
    case 'firefox-csv': return 'Firefox CSV';
    case 'bitwarden-csv': return 'Bitwarden CSV';
    case 'onepassword-csv': return '1Password CSV';
    case 'keepass-csv': return 'KeePass CSV';
    case 'keepass-xml': return 'KeePass XML';
    case 'generic-csv': return 'Generic CSV';
    default: return 'Unknown';
  }
}

export function parseCsvImport(text: string, filename?: string): ParsedImport {
  const warnings: string[] = [];
  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  if (!lines.length) return { format: 'unknown', rows: [], warnings: ['Empty file'] };

  const delimiter = detectCsvDelimiter(raw);
  const firstCells = parseCsvLine(lines[0], delimiter);
  const hasHeader = looksLikeHeader(firstCells);
  const headers = hasHeader ? firstCells.map(normKey) : PD_DEFAULT_COLS.map(normKey);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows: ImportRow[] = [];
  for (const line of dataLines) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line, delimiter);
    const map: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) map[headers[i]] = cells[i] ?? '';
    // Bitwarden: skip non-login types when present
    if (map['type'] && !/^login$/i.test(map['type']) && map['type'] !== '1') {
      continue;
    }
    const row = rowFromMap(map);
    if (row) rows.push(row);
  }

  let format: ImportFormat = 'generic-csv';
  if (hasHeader) format = detectCsvFormat(headers, filename);
  else if (delimiter === ';') {
    format = 'password-depot-csv';
    warnings.push('No header row — assumed Password Depot default column order');
  }

  if (!rows.length) warnings.push('No password rows found');
  return { format, delimiter, rows, warnings };
}

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return (el.textContent || '').trim();
}

function childText(el: Element, names: string[]): string {
  const want = new Set(names.map((n) => n.toLowerCase()));
  for (const child of Array.from(el.children)) {
    if (want.has(child.tagName.toLowerCase())) return textOf(child);
  }
  for (const n of names) {
    const a = el.getAttribute(n) || el.getAttribute(n.toLowerCase());
    if (a) return a.trim();
  }
  return '';
}

function collectXmlItems(doc: Document): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const push = (els: Iterable<Element>) => {
    for (const el of els) {
      if (seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
  };
  for (const sel of [
    'item', 'Item', 'entry', 'Entry', 'password', 'Password',
    'passworditem', 'PasswordItem', 'record', 'Record',
  ]) {
    push(doc.getElementsByTagName(sel));
  }
  if (!out.length) {
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      if (childText(el, ['password', 'Password', 'passwd']) &&
          (childText(el, ['description', 'Description', 'title', 'Title', 'name', 'Name']) ||
           childText(el, ['username', 'Username', 'user', 'User']))) {
        push([el]);
      }
    }
  }
  return out;
}

function folderPathFor(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el.parentElement;
  while (cur && cur !== cur.ownerDocument?.documentElement) {
    const tag = cur.tagName.toLowerCase();
    if (['group', 'folder', 'category', 'directory', 'passwords', 'passworddepot', 'database', 'root'].includes(tag)) {
      const name = childText(cur, ['name', 'Name', 'description', 'Description', 'title', 'Title'])
        || cur.getAttribute('name') || cur.getAttribute('Name') || '';
      if (name && !/^passwords$/i.test(name)) parts.unshift(name);
    }
    cur = cur.parentElement;
  }
  return parts.join('/');
}

function isKeePassXml(raw: string): boolean {
  return /<KeePassFile\b/i.test(raw) || /<Group>[\s\S]*<Entry>/i.test(raw);
}

/** KeePass 2 XML: Entry/String Key=Title|UserName|Password|URL|Notes|otp|TOTP */
function parseKeePassXmlNode(raw: string): ParsedImport {
  const warnings: string[] = [];
  const rows: ImportRow[] = [];
  const entryRe = /<Entry\b[^>]*>([\s\S]*?)<\/Entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(raw))) {
    const block = m[1];
    const strings = new Map<string, string>();
    const strRe = /<String>\s*<Key>([^<]*)<\/Key>\s*<Value[^>]*>([\s\S]*?)<\/Value>\s*<\/String>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = strRe.exec(block))) {
      strings.set(sm[1].trim().toLowerCase(), decodeXml(sm[2]).trim());
    }
    const totp = strings.get('otp') || strings.get('totp') || strings.get('otpauth') || '';
    const row = finalizeRow({
      title: strings.get('title') || '',
      username: strings.get('username') || strings.get('user name') || '',
      password: strings.get('password') || '',
      url: strings.get('url') || strings.get('web site') || '',
      notes: strings.get('notes') || '',
      totp: totp || undefined,
    });
    if (row) rows.push(row);
  }
  if (!rows.length) warnings.push('No KeePass entries found in XML');
  return { format: rows.length ? 'keepass-xml' : 'unknown', rows, warnings };
}

export function parseXmlImport(text: string): ParsedImport {
  const warnings: string[] = [];
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw.startsWith('<')) {
    return { format: 'unknown', rows: [], warnings: ['Not XML'] };
  }
  if (/<Encrypted>|encrypted=["']?true/i.test(raw) && !/<passworddepot/i.test(raw) && !/<PasswordDepot/i.test(raw) && !isKeePassXml(raw)) {
    warnings.push('File looks encrypted — export plaintext CSV or XML');
  }

  if (isKeePassXml(raw)) {
    return parseKeePassXmlNode(raw);
  }

  let doc: Document;
  try {
    if (typeof DOMParser !== 'undefined') {
      doc = new DOMParser().parseFromString(raw, 'application/xml');
      const err = doc.querySelector('parsererror');
      if (err) return { format: 'unknown', rows: [], warnings: ['Invalid XML'] };
    } else {
      return parseXmlImportNode(raw);
    }
  } catch {
    return parseXmlImportNode(raw);
  }

  const items = collectXmlItems(doc);
  const rows: ImportRow[] = [];
  for (const el of items) {
    const tags = [
      ...splitTags(childText(el, ['tags', 'Tags', 'tag', 'Tag'])),
      ...splitTags(childText(el, ['category', 'Category'])),
      ...pathToTags(folderPathFor(el)),
    ];
    const row = finalizeRow({
      title: childText(el, ['description', 'Description', 'title', 'Title', 'name', 'Name']),
      username: childText(el, ['username', 'Username', 'user', 'User', 'login', 'Login']),
      password: childText(el, ['password', 'Password', 'passwd', 'Pass']),
      url: childText(el, ['url', 'URL', 'website', 'Website', 'href', 'link', 'Link']),
      notes: childText(el, ['comments', 'Comments', 'comment', 'Comment', 'notes', 'Notes', 'note', 'Note']),
      tags,
      totp: childText(el, ['totp', 'TOTP', 'otp', 'OTP', 'otpauth']),
    });
    if (row) rows.push(row);
  }

  const format: ImportFormat = /passworddepot|password.?depot/i.test(raw) || items.length
    ? 'password-depot-xml'
    : rows.length ? 'password-depot-xml' : 'unknown';
  if (!rows.length) warnings.push('No password entries found in XML');
  return { format, rows, warnings };
}

/** Node-safe XML parse without DOMParser — handles typical Password Depot exports. */
function parseXmlImportNode(raw: string): ParsedImport {
  if (isKeePassXml(raw)) return parseKeePassXmlNode(raw);
  const warnings: string[] = [];
  const rows: ImportRow[] = [];
  const itemRe = /<(item|entry|passworditem|record)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  const blocks: string[] = [];
  while ((m = itemRe.exec(raw))) blocks.push(m[2]);
  if (!blocks.length) {
    const loose = /<(?:description|title)>([^<]*)<\/(?:description|title)>[\s\S]{0,1200}?<(?:password)>([^<]*)<\/(?:password)>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = loose.exec(raw))) {
      const start = Math.max(0, lm.index - 200);
      const end = Math.min(raw.length, lm.index + lm[0].length + 400);
      blocks.push(raw.slice(start, end));
    }
  }

  const tag = (block: string, names: string[]): string => {
    for (const n of names) {
      const re = new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i');
      const mm = block.match(re);
      if (mm) return decodeXml(mm[1]).trim();
    }
    return '';
  };

  for (const block of blocks) {
    const row = finalizeRow({
      title: tag(block, ['description', 'title', 'name']),
      username: tag(block, ['username', 'user', 'login']),
      password: tag(block, ['password', 'passwd']),
      url: tag(block, ['url', 'website', 'href', 'link']),
      notes: tag(block, ['comments', 'comment', 'notes', 'note']),
      tags: [
        ...splitTags(tag(block, ['tags', 'tag'])),
        ...splitTags(tag(block, ['category'])),
      ],
      totp: tag(block, ['totp', 'otp', 'otpauth']),
    });
    if (row) rows.push(row);
  }

  if (!rows.length) warnings.push('No password entries found in XML');
  return {
    format: rows.length ? 'password-depot-xml' : 'unknown',
    rows,
    warnings,
  };
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseImportFile(text: string, filename?: string): ParsedImport {
  const name = (filename || '').toLowerCase();
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { format: 'unknown', rows: [], warnings: ['Empty file'] };

  if (/\.(pswe|pswd|pswx|psw\d*|bckd|bckx|kdbx)$/i.test(name)) {
    return {
      format: 'unknown',
      rows: [],
      warnings: [
        'Encrypted / native database formats (.pswe/.pswd/.kdbx/…) are not supported. Export plaintext CSV or XML from your password manager, then import that file.',
      ],
    };
  }

  const looksXml = trimmed.startsWith('<') || /\.xml$/i.test(name);
  if (looksXml) {
    const xml = parseXmlImport(trimmed);
    if (xml.rows.length || xml.format !== 'unknown') return xml;
    if (/\.xml$/i.test(name)) return xml;
  }

  return parseCsvImport(trimmed, filename);
}

/** Host key used for duplicate matching (URL hostname + username). */
export function importMatchKey(url: string | undefined, username: string): string {
  let host = '';
  if (url) {
    try {
      host = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, '').toLowerCase();
    } catch { host = url.toLowerCase(); }
  }
  return `${host}\0${(username || '').trim().toLowerCase()}`;
}
