/**
 * Lightweight zxcvbn-style strength estimate (no dependencies):
 * the estimate is the minimum over several attack models — brute force over the observed
 * character classes, dictionary of 10k common passwords (incl. leet + suffix variants),
 * EFF-wordlist passphrases, and penalties for sequences, keyboard runs, repeats and years.
 */
import { COMMON_PASSWORDS } from './common-passwords.js';
import { EFF_WORDS } from './wordlist.js';

const WORDSET = new Set(EFF_WORDS);
export type StrengthWarning =
  | 'empty' | 'common' | 'commonVariant' | 'short' | 'sequence' | 'keyboard' | 'repeat'
  | 'year' | 'onlyDigits' | 'onlyLetters' | 'containsCommon';

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  bits: number;
  /** Estimated guesses = 2^bits */
  guessesLog10: number;
  /** Seconds to crack offline at 10^10 guesses/s (fast hash, worst case) */
  crackSecondsOffline: number;
  /** Seconds at 10^4 guesses/s (slow KDF like the VaultAI master password) */
  crackSecondsSlow: number;
  warnings: StrengthWarning[];
  classes: { lower: boolean; upper: boolean; digits: boolean; symbols: boolean; count: number };
  isCommon: boolean;
}

const LEET: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsxedc', 'azertyuiop'];

export function isCommonPassword(pw: string): boolean {
  const l = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(l)) return true;
  const deleet = [...l].map((c) => LEET[c] ?? c).join('');
  if (COMMON_PASSWORDS.has(deleet)) return true;
  // common word + trailing digits/symbols (e.g. "Password123!", "dragon2024")
  const stem = l.replace(/[\d\W_]+$/, '');
  if (stem.length >= 4 && stem !== l && (COMMON_PASSWORDS.has(stem) || COMMON_PASSWORDS.has([...stem].map((c) => LEET[c] ?? c).join('')))) return true;
  return false;
}

function classesOf(pw: string) {
  const lower = /[a-z]/.test(pw), upper = /[A-Z]/.test(pw), digits = /\d/.test(pw), symbols = /[^A-Za-z0-9]/.test(pw);
  return { lower, upper, digits, symbols, count: [lower, upper, digits, symbols].filter(Boolean).length };
}

function poolSize(c: ReturnType<typeof classesOf>, pw: string) {
  let n = (c.lower ? 26 : 0) + (c.upper ? 26 : 0) + (c.digits ? 10 : 0) + (c.symbols ? 33 : 0);
  if (/[^\x00-\x7f]/.test(pw)) n += 100; // non-ASCII (e.g. CJK) widens the space
  return Math.max(n, 10);
}

/** Length of segments that are runs of sequential / keyboard characters (>= 3). */
function patternChars(pw: string, warnings: Set<StrengthWarning>): number {
  const l = pw.toLowerCase();
  let penalised = 0;
  // ascending/descending char-code sequences: abc, 987
  let run = 1;
  for (let i = 1; i <= l.length; i++) {
    const d = i < l.length ? l.charCodeAt(i) - l.charCodeAt(i - 1) : 99;
    const prev = i > 1 ? l.charCodeAt(i - 1) - l.charCodeAt(i - 2) : 99;
    if (i < l.length && Math.abs(d) === 1 && (run === 1 || d === prev)) run++;
    else { if (run >= 3) { penalised += run - 1; warnings.add('sequence'); } run = 1; }
  }
  for (const row of KEYBOARD_ROWS) {
    for (let len = Math.min(row.length, l.length); len >= 4; len--) {
      let hit = false;
      for (let s = 0; s + len <= row.length; s++) {
        const seg = row.slice(s, s + len);
        if (l.includes(seg) || l.includes([...seg].reverse().join(''))) { penalised += len - 1; warnings.add('keyboard'); hit = true; break; }
      }
      if (hit) break;
    }
  }
  // repeated characters (aaa) and repeated blocks (abcabc)
  const rep = l.match(/(.)\1{2,}/g);
  if (rep) { for (const r of rep) penalised += r.length - 1; warnings.add('repeat'); }
  const block = l.match(/(.{2,})\1+/);
  if (block && block[0].length >= 4) { penalised += block[0].length - block[1]!.length; warnings.add('repeat'); }
  if (/(19|20)\d\d/.test(l)) { penalised += 2; warnings.add('year'); }
  return Math.min(penalised, Math.max(0, pw.length - 1));
}

export function estimateStrength(pw: string): StrengthResult {
  const warnings = new Set<StrengthWarning>();
  const classes = classesOf(pw || '');
  if (!pw) return finish(0, ['empty'], classes, false);
  const len = [...pw].length;
  const common = isCommonPassword(pw);

  // Model 1: brute force over observed classes, with pattern penalties
  const effLen = Math.max(1, len - patternChars(pw, warnings));
  let bits = effLen * Math.log2(poolSize(classes, pw));

  // Model 2: common password dictionary (~10k entries ≈ 13.3 bits, variants ≈ +4)
  if (common) {
    warnings.add(COMMON_PASSWORDS.has(pw.toLowerCase()) ? 'common' : 'commonVariant');
    bits = Math.min(bits, COMMON_PASSWORDS.has(pw.toLowerCase()) ? 10 : 18);
  } else {
    // contains a common password of length >= 5 as substring
    const l = pw.toLowerCase();
    for (let size = Math.min(12, l.length - 1); size >= 5; size--) {
      let found = '';
      for (let s = 0; s + size <= l.length && !found; s++) if (COMMON_PASSWORDS.has(l.slice(s, s + size))) found = l.slice(s, s + size);
      if (found) {
        warnings.add('containsCommon');
        const rest = len - size;
        bits = Math.min(bits, 13.3 + rest * Math.log2(poolSize(classes, pw)));
        break;
      }
    }
  }

  // Model 3: passphrase from a wordlist (separator-split or camel-case words)
  const parts = pw.split(/[\s\-_.,+]+|(?=[A-Z])/).map((w) => w.replace(/\d+$/, '').toLowerCase()).filter(Boolean);
  const isWord = (w: string) => WORDSET.has(w) || (w.length >= 3 && COMMON_PASSWORDS.has(w));
  if (parts.length >= 2 && parts.every(isWord)) {
    const digits = (pw.match(/\d/g) || []).length;
    // each word ≈ 14 bits (union of EFF list + common words), plus separator/case/digit choices
    bits = Math.min(bits, parts.length * 14 + digits * Math.log2(10) + 3);
  }

  if (len < 8) warnings.add('short');
  if (/^\d+$/.test(pw)) warnings.add('onlyDigits');
  else if (/^[A-Za-z]+$/.test(pw)) warnings.add('onlyLetters');
  return finish(bits, [...warnings], classes, common);
}

function finish(bits: number, warnings: StrengthWarning[], classes: StrengthResult['classes'], isCommon: boolean): StrengthResult {
  bits = Math.max(0, Math.round(bits * 10) / 10);
  const score = (bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4) as StrengthResult['score'];
  const guessesLog10 = bits * Math.log10(2);
  return {
    score,
    bits,
    guessesLog10: Math.round(guessesLog10 * 10) / 10,
    crackSecondsOffline: Math.pow(2, bits) / 2 / 1e10,
    crackSecondsSlow: Math.pow(2, bits) / 2 / 1e4,
    warnings,
    classes,
    isCommon,
  };
}

/** Human crack time bucket → i18n key + count (e.g. {unit:'years', n: 3}). */
export function crackTimeBucket(seconds: number): { unit: 'instant' | 'seconds' | 'minutes' | 'hours' | 'days' | 'months' | 'years' | 'centuries'; n: number } {
  const s = seconds;
  if (s < 1) return { unit: 'instant', n: 0 };
  if (s < 60) return { unit: 'seconds', n: Math.round(s) };
  if (s < 3600) return { unit: 'minutes', n: Math.round(s / 60) };
  if (s < 86400) return { unit: 'hours', n: Math.round(s / 3600) };
  if (s < 86400 * 31) return { unit: 'days', n: Math.round(s / 86400) };
  if (s < 86400 * 365) return { unit: 'months', n: Math.round(s / (86400 * 30.4)) };
  if (s < 86400 * 365 * 100) return { unit: 'years', n: Math.round(s / (86400 * 365)) };
  return { unit: 'centuries', n: 0 };
}

/** Master password policy (enforced in UI and on the server). */
export function masterPasswordProblems(pw: string): string[] {
  const p: string[] = [];
  if ([...pw].length < 8) p.push('MIN_LENGTH');
  if (isCommonPassword(pw)) p.push('COMMON');
  if (estimateStrength(pw).score < 2) p.push('TOO_WEAK');
  return p;
}
