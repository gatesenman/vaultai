#!/usr/bin/env node
const BASE = process.env.VAULTAI_URL || 'http://127.0.0.1:3847';
const TOKEN = process.env.VAULTAI_TOKEN || '';

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-f' || a === '--format') flags.format = argv[++i] || 'json';
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') && argv[i + 1] !== '-f' ? argv[++i] : 'true';
      flags[key] = val;
    } else pos.push(a);
  }
  return { flags, pos };
}

async function api(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function print(obj: unknown, format = 'json') {
  if (format === 'json' || format === 'raw') console.log(JSON.stringify(obj, null, 2));
  else console.log(JSON.stringify(obj));
}

const HELPS: Record<string, string> = {
  github: 'list_repos | search_repos --q | list_issues --owner --repo | get_issue | list_prs | create_issue (Write)',
  notion: 'search | get_page --page_id | get_blocks | create_page (Write) | append_blocks (Write)',
  stripe: 'list_customers | list_charges | list_payment_intents | create_customer (Write)',
  generic: 'tool generic <connectionId> [--method GET] --path /v1/... [--body \'{"json":1}\']  (GET = Read, others = Write; Linear GraphQL queries = Read)',
  gmail: '(Beta) search --q | get --id | list_labels | create_draft --to --subject | modify | archive (Write) | send (Full)',
  gcal: '(Beta) list_calendars | list_events | get_event --eventId | create_event --summary --start --end (Write)',
  passwords: 'list [--q] | get --id | get_password --id (Full; logged)',
};

function usage() {
  console.log(`VaultAI CLI v1.5 — lets AI assistants use your credentials safely

  vaultai status | doctor
  vaultai tool ls
  vaultai tool help <app>
  vaultai tool <group> <action> [--flags] [-f json]
  vaultai activity ls [--ok true|false] [--app name] [--ai name] [-f json]
  vaultai gen [password|passphrase|pin] [--length 24] [--no-symbols] [--exclude-ambiguous]
              [--min-digits 2] [--min-symbols 2] [--avoid-repeats] [--words 6] [--sep -] [--count 5] [-f json]

Env: VAULTAI_URL  VAULTAI_TOKEN
Groups: ${Object.keys(HELPS).join(', ')}
`);
}

async function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const fmt = flags.format || 'json';
  const [cmd, sub, ...rest] = pos;

  if (!cmd || cmd === 'help' || cmd === '-h') { usage(); return; }

  if (cmd === 'gen' || cmd === 'generate') {
    // Local generator: no daemon, no vault, no token needed.
    const G = await import('../shared/generator.js');
    const S = await import('../shared/strength.js');
    const all = parseArgs(process.argv.slice(3)).flags;
    const bool = (k: string, def?: boolean) => (all[k] === undefined ? def : all[k] !== 'false');
    const num = (k: string) => (all[k] !== undefined ? Number(all[k]) : undefined);
    const mode = (sub === 'passphrase' || sub === 'pin' || sub === 'password' ? sub : all.mode) as 'password' | 'passphrase' | 'pin' | undefined;
    const opts = {
      mode, length: num('length') ?? num('len'), words: num('words'), separator: all.separator ?? all.sep,
      upper: all['no-upper'] ? false : bool('upper'), lower: all['no-lower'] ? false : bool('lower'),
      digits: all['no-digits'] ? false : bool('digits'), symbols: all['no-symbols'] ? false : bool('symbols'),
      excludeAmbiguous: bool('exclude-ambiguous'), exclude: all.exclude,
      minDigits: num('min-digits'), minSymbols: num('min-symbols'), avoidRepeats: bool('avoid-repeats'),
      capitalize: all['no-capitalize'] ? false : bool('capitalize'), includeNumber: all['no-number'] ? false : bool('number'),
    };
    const count = Math.min(50, Math.max(1, Number(all.count) || 1));
    try {
      const out = Array.from({ length: count }, () => G.generate(opts));
      if (fmt === 'json' && (flags.format || all.format)) {
        print({ ok: true, results: out.map((r) => ({ ...r, strength: S.estimateStrength(r.value).score })) }, 'json');
      } else {
        for (const r of out) console.log(r.value);
        if (process.stderr.isTTY) console.error(`(${out[0]!.mode}, ~${out[0]!.entropyBits} bits)`);
      }
    } catch (e) {
      // same contract as tool refusals: JSON on stdout, exit code 1 (no hard exit, so piped output is flushed)
      console.log(JSON.stringify({ ok: false, code: (e as { code?: string }).code || 'BAD_ARGS', message: e instanceof Error ? e.message : String(e) }));
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'status') { print((await api('/api/status')).json, fmt); return; }

  if (cmd === 'doctor') {
    const health = await api('/api/health');
    const status = await api('/api/status');
    const issues: string[] = [];
    const h = health.json as { ok?: boolean; unlocked?: boolean; exists?: boolean };
    if (!h?.ok) issues.push('Daemon not reachable');
    else {
      if (!h.exists) issues.push('No vault');
      else if (!h.unlocked) issues.push('Vault locked');
      if (!TOKEN) issues.push('VAULTAI_TOKEN not set');
    }
    print({ ok: issues.length === 0, health: health.json, status: status.json, issues }, fmt);
    process.exit(issues.length ? 1 : 0);
  }

  if (cmd === 'activity' && sub === 'ls') {
    if (!TOKEN) { console.error('Set VAULTAI_TOKEN'); process.exit(1); }
    const q = new URLSearchParams();
    if (flags.ok) q.set('ok', flags.ok);
    const { json } = await api(`/api/activity?${q}`);
    type Act = { appName?: string; assistantName?: string };
    let rows: Act[] = ((json as { activity?: Act[] }).activity || []);
    if (flags.app) {
      const f = flags.app.toLowerCase();
      rows = rows.filter((a) => (a.appName || '').toLowerCase().includes(f));
    }
    if (flags.ai) {
      const f = flags.ai.toLowerCase();
      rows = rows.filter((a) => (a.assistantName || '').toLowerCase().includes(f));
    }
    print({ ok: true, activity: rows }, fmt);
    return;
  }

  if (cmd === 'tool') {
    if (sub === 'help') {
      const app = rest[0] || 'gmail';
      console.log(HELPS[app] || `Unknown. Try: ${Object.keys(HELPS).join(', ')}`);
      return;
    }
    if (!TOKEN) { console.error('Set VAULTAI_TOKEN'); process.exit(1); }
    if (sub === 'ls') {
      print((await api('/api/tool/ls')).json, fmt);
      return;
    }

    const restFlags = parseArgs(rest).flags;
    Object.assign(flags, restFlags);
    const action = rest[0];
    const groups = ['github', 'gmail', 'gcal', 'notion', 'stripe', 'passwords'];
    let toolName = '';
    let args: Record<string, unknown> = { ...flags };
    delete args.format;

    if (sub && groups.includes(sub)) {
      if (!action) { console.error(`Need action. vaultai tool help ${sub}`); process.exit(1); }
      toolName = `${sub}_${action}`;
      if (flags.q) args.q = flags.q;
      if (flags.query) args.q = flags.query;
    } else if (sub === 'generic') {
      const appId = rest[0];
      if (!appId) { console.error('Need a connection id (see: vaultai tool ls)'); process.exit(1); }
      toolName = `generic_${appId}_http_request`;
      args = {
        method: flags.method || 'GET',
        path: flags.path,
        body: flags.body ? JSON.parse(flags.body) : undefined,
      };
    } else {
      usage();
      process.exit(1);
    }

    const { json, status } = await api('/api/tool/invoke', {
      method: 'POST',
      body: JSON.stringify({ name: toolName, arguments: args }),
    });
    print(json, fmt);
    process.exit(status >= 400 || (json as { ok?: boolean })?.ok === false ? 1 : 0);
  }

  usage();
  process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
