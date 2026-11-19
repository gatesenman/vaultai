/**
 * VaultAI password generator — shared by the UI (served as an ES module), the server, CLI and MCP.
 * Uses the platform CSPRNG (crypto.getRandomValues; Node ≥ 20 exposes it on globalThis) with
 * rejection sampling, so there is no modulo bias. No vault access, no network.
 */
import { EFF_WORDS } from './wordlist.js';
/** Letters-only EFF words (drops drop-down, felt-tip, t-shirt, yo-yo) so any separator splits unambiguously. */
export const PASSPHRASE_WORDS: readonly string[] = EFF_WORDS.filter((w) => /^[a-z]+$/.test(w));

export type GenMode = 'password' | 'passphrase' | 'pin';

export interface GenOptions {
  mode?: GenMode;
  /** password: 8–128 · pin: 4–12 */
  length?: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
  /** Drop look-alike characters I l 1 O 0 o | */
  excludeAmbiguous?: boolean;
  /** Extra characters never to use */
  exclude?: string;
  minDigits?: number;
  minSymbols?: number;
  /** No two identical characters next to each other */
  avoidRepeats?: boolean;
  /** passphrase: 3–12 words */
  words?: number;
  separator?: string;
  capitalize?: boolean;
  includeNumber?: boolean;
}

export interface GenResult {
  mode: GenMode;
  value: string;
  /** Entropy of the generation process in bits (what an attacker who knows the settings faces) */
  entropyBits: number;
  length: number;
}

export const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>/?~',
} as const;
export const AMBIGUOUS = 'Il1O0o|';

export const LIMITS = {
  password: { min: 8, max: 128, def: 20 },
  pin: { min: 4, max: 12, def: 6 },
  words: { min: 3, max: 12, def: 5 },
} as const;

export const DEFAULT_OPTIONS: Required<GenOptions> = {
  mode: 'password',
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  exclude: '',
  minDigits: 1,
  minSymbols: 1,
  avoidRepeats: false,
  words: 5,
  separator: '-',
  capitalize: true,
  includeNumber: true,
};

export class GeneratorError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function rng(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('No CSPRNG available');
  return c;
}

/** Uniform integer in [0, max) — rejection sampling over 32-bit values (no modulo bias). */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max out of range');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    rng().getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % max;
  }
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

const clampInt = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

function hasAdjacentRepeat(s: string): boolean {
  for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return true;
  return false;
}

export function normalizeOptions(o: GenOptions = {}): Required<GenOptions> {
  const m: GenMode = o.mode === 'passphrase' || o.mode === 'pin' ? o.mode : 'password';
  const lim = m === 'pin' ? LIMITS.pin : LIMITS.password;
  return {
    ...DEFAULT_OPTIONS,
    ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)),
    mode: m,
    length: clampInt(o.length, lim.min, lim.max, lim.def),
    words: clampInt(o.words, LIMITS.words.min, LIMITS.words.max, LIMITS.words.def),
    minDigits: clampInt(o.minDigits, 0, 64, DEFAULT_OPTIONS.minDigits),
    minSymbols: clampInt(o.minSymbols, 0, 64, DEFAULT_OPTIONS.minSymbols),
    separator: typeof o.separator === 'string' ? o.separator.slice(0, 3) : DEFAULT_OPTIONS.separator,
    exclude: typeof o.exclude === 'string' ? o.exclude : '',
  } as Required<GenOptions>;
}

/** Character pools actually used for the given options (after exclusions). */
export function pools(o: Required<GenOptions>): Record<'upper' | 'lower' | 'digits' | 'symbols', string> {
  const drop = new Set([...(o.excludeAmbiguous ? AMBIGUOUS : ''), ...o.exclude]);
  const f = (s: string) => [...s].filter((c) => !drop.has(c)).join('');
  return {
    upper: o.upper ? f(CHARSETS.upper) : '',
    lower: o.lower ? f(CHARSETS.lower) : '',
    digits: o.digits ? f(CHARSETS.digits) : '',
    symbols: o.symbols ? f(CHARSETS.symbols) : '',
  };
}

export function generatePassword(opts: GenOptions = {}): GenResult {
  const o = normalizeOptions({ ...opts, mode: 'password' });
  const p = pools(o);
  const selected = (Object.keys(p) as (keyof typeof p)[]).filter((k) => o[k]);
  if (!selected.length) throw new GeneratorError('NO_CLASSES', 'Select at least one character type');
  for (const k of selected) if (!p[k]) throw new GeneratorError('EMPTY_CLASS', `All ${k} characters are excluded`);
  const need: Record<string, number> = {};
  for (const k of selected) need[k] = 1;
  if (o.digits) need.digits = Math.max(1, o.minDigits);
  if (o.symbols) need.symbols = Math.max(1, o.minSymbols);
  const required = Object.values(need).reduce((a, b) => a + b, 0);
  if (required > o.length) throw new GeneratorError('TOO_SHORT', `Length ${o.length} is shorter than the ${required} required characters`);
  const all = selected.map((k) => p[k]).join('');
  if (o.avoidRepeats && all.length < 2) throw new GeneratorError('POOL_TOO_SMALL', 'Need at least 2 distinct characters to avoid repeats');

  for (let attempt = 0; attempt < 1000; attempt++) {
    const chars: string[] = [];
    for (const k of selected) for (let i = 0; i < need[k]!; i++) chars.push(p[k][randomInt(p[k].length)]!);
    while (chars.length < o.length) chars.push(all[randomInt(all.length)]!);
    const value = shuffle(chars).join('');
    if (o.avoidRepeats && hasAdjacentRepeat(value)) continue;
    return { mode: 'password', value, length: value.length, entropyBits: round1(o.length * Math.log2(all.length)) };
  }
  throw new GeneratorError('UNSATISFIABLE', 'Could not satisfy the options; relax them');
}

export function generatePassphrase(opts: GenOptions = {}): GenResult {
  const o = normalizeOptions({ ...opts, mode: 'passphrase' });
  const words: string[] = [];
  for (let i = 0; i < o.words; i++) {
    let w = PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]!;
    if (o.capitalize) w = w[0]!.toUpperCase() + w.slice(1);
    words.push(w);
  }
  let bits = o.words * Math.log2(PASSPHRASE_WORDS.length);
  if (o.includeNumber) {
    const idx = randomInt(words.length);
    words[idx] = words[idx] + String(randomInt(10));
    bits += Math.log2(10) + Math.log2(words.length);
  }
  const value = words.join(o.separator);
  return { mode: 'passphrase', value, length: value.length, entropyBits: round1(bits) };
}

export function generatePin(opts: GenOptions = {}): GenResult {
  const o = normalizeOptions({ ...opts, mode: 'pin' });
  for (let attempt = 0; attempt < 1000; attempt++) {
    let v = '';
    for (let i = 0; i < o.length; i++) v += String(randomInt(10));
    if (o.avoidRepeats && hasAdjacentRepeat(v)) continue;
    return { mode: 'pin', value: v, length: v.length, entropyBits: round1(o.length * Math.log2(o.avoidRepeats ? 9 : 10) + (o.avoidRepeats ? Math.log2(10 / 9) : 0)) };
  }
  throw new GeneratorError('UNSATISFIABLE', 'Could not generate PIN');
}

export function generate(opts: GenOptions = {}): GenResult {
  const mode = opts.mode || 'password';
  if (mode === 'passphrase') return generatePassphrase(opts);
  if (mode === 'pin') return generatePin(opts);
  return generatePassword(opts);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Remembered generator preferences: keeps password length, PIN length and mode independently. */
export function normalizePrefs(p: Record<string, unknown> = {}): Required<GenOptions> & { pinLength: number } {
  const mode: GenMode = p.mode === 'passphrase' || p.mode === 'pin' ? p.mode : 'password';
  const base = normalizeOptions({ ...(p as GenOptions), mode: 'password' });
  return { ...base, mode, pinLength: clampInt(p.pinLength, LIMITS.pin.min, LIMITS.pin.max, LIMITS.pin.def) };
}
