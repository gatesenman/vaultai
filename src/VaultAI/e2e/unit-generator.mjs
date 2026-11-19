// Unit tests for the shared CSPRNG generator + strength estimator (dist/shared, same code the UI/CLI/MCP use).
import { Recorder, assert } from './lib.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

export async function runUnitGenerator() {
  const G = await import(pathToFileURL(join(ROOT, 'dist', 'shared', 'generator.js')).href);
  const S = await import(pathToFileURL(join(ROOT, 'dist', 'shared', 'strength.js')).href);
  const W = await import(pathToFileURL(join(ROOT, 'dist', 'shared', 'wordlist.js')).href);
  const rec = new Recorder('Unit');
  const many = (n, opts) => Array.from({ length: n }, () => G.generatePassword(opts).value);
  const SYM = /[^A-Za-z0-9]/;

  await rec.run('randomInt: always in range, all values reachable (n=7, 70k draws)', () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 70000; i++) { const v = G.randomInt(7); assert(Number.isInteger(v) && v >= 0 && v < 7, 'range ' + v); counts[v]++; }
    assert(counts.every((c) => c > 9000 && c < 11000), 'counts ' + counts);
    let threw = false; try { G.randomInt(0); } catch { threw = true; }
    assert(threw, 'randomInt(0) must throw');
  });
  await rec.run('modulo-bias sanity: chi-square over 94-char pool (200k chars) below p=0.001 critical value', () => {
    const pool = G.CHARSETS.upper + G.CHARSETS.lower + G.CHARSETS.digits + G.CHARSETS.symbols;
    const k = pool.length;
    const N = 200000;
    const counts = new Map();
    for (let i = 0; i < N; i++) { const c = pool[G.randomInt(k)]; counts.set(c, (counts.get(c) || 0) + 1); }
    const exp = N / k;
    let chi = 0; for (const c of pool) chi += ((counts.get(c) || 0) - exp) ** 2 / exp;
    // df = k-1 (≈93); chi-square critical value at p=0.001 ≈ 136.9
    assert(chi < 137, `chi2=${chi.toFixed(1)} (k=${k})`);
    // a deliberately biased "% 94" over a byte would put the first 68 chars at 3/256 vs 2/256 → our generator must not show that skew
    const firstHalf = [...pool.slice(0, 68)].reduce((a, c) => a + (counts.get(c) || 0), 0) / 68;
    const rest = [...pool.slice(68)].reduce((a, c) => a + (counts.get(c) || 0), 0) / (k - 68);
    assert(Math.abs(firstHalf / rest - 1) < 0.03, `skew ${(firstHalf / rest).toFixed(3)}`);
    return `chi2=${chi.toFixed(1)}, df=${k - 1}`;
  });
  await rec.run('length: exact for 8, 20, 64, 128; clamped below 8 / above 128', () => {
    for (const L of [8, 20, 64, 128]) for (const v of many(50, { length: L })) assert([...v].length === L, `len ${L}: ${v.length}`);
    assert(G.generatePassword({ length: 3 }).value.length === 8, 'clamp low');
    assert(G.generatePassword({ length: 999 }).value.length === 128, 'clamp high');
  });
  await rec.run('class guarantees: every selected class appears (2000 × length 8, all four classes)', () => {
    for (const v of many(2000, { length: 8 })) assert(/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && SYM.test(v), v);
  });
  await rec.run('class toggles: only selected classes used', () => {
    for (const v of many(300, { length: 16, symbols: false, digits: false })) assert(/^[A-Za-z]{16}$/.test(v), v);
    for (const v of many(300, { length: 12, upper: false, lower: false, symbols: false })) assert(/^\d{12}$/.test(v), v);
    for (const v of many(300, { length: 12, upper: false, digits: false })) assert(/[a-z]/.test(v) && SYM.test(v) && !/[A-Z\d]/.test(v), v);
  });
  await rec.run('exclusions: ambiguous (Il1O0o|) and custom characters never appear', () => {
    for (const v of many(500, { length: 32, excludeAmbiguous: true })) assert(!/[Il1O0o|]/.test(v), v);
    for (const v of many(500, { length: 32, exclude: 'abcXYZ789#$%' })) assert(!/[abcXYZ789#$%]/.test(v), v);
  });
  await rec.run('minimum digits / symbols honoured', () => {
    for (const v of many(500, { length: 16, minDigits: 6, minSymbols: 4 })) {
      assert((v.match(/\d/g) || []).length >= 6, 'digits ' + v);
      assert((v.match(/[^A-Za-z0-9]/g) || []).length >= 4, 'symbols ' + v);
    }
  });
  await rec.run('avoidRepeats: no identical neighbours (1000 × 40, small pool)', () => {
    for (const v of many(1000, { length: 40, upper: false, lower: false, symbols: false, avoidRepeats: true })) assert(!/(.)\1/.test(v), v);
  });
  await rec.run('error codes: NO_CLASSES, EMPTY_CLASS, TOO_SHORT', () => {
    const code = (o) => { try { G.generatePassword(o); return 'none'; } catch (e) { return e.code; } };
    assert(code({ upper: false, lower: false, digits: false, symbols: false }) === 'NO_CLASSES', 'NO_CLASSES');
    assert(code({ upper: false, lower: false, symbols: false, exclude: '0123456789' }) === 'EMPTY_CLASS', 'EMPTY_CLASS');
    assert(code({ length: 8, minDigits: 6, minSymbols: 6 }) === 'TOO_SHORT', 'TOO_SHORT');
  });
  await rec.run('entropy: reported bits = length × log2(pool) (±0.5)', () => {
    const r = G.generatePassword({ length: 20 });
    const pool = (G.CHARSETS.upper + G.CHARSETS.lower + G.CHARSETS.digits + G.CHARSETS.symbols).length;
    assert(Math.abs(r.entropyBits - 20 * Math.log2(pool)) < 0.5, `${r.entropyBits}`);
    const p = G.generatePin({ length: 6 });
    assert(Math.abs(p.entropyBits - 6 * Math.log2(10)) < 0.5, `pin ${p.entropyBits}`);
  });
  await rec.run('passphrase: word count, separator, capitalisation, number, EFF words only', () => {
    const words = new Set(W.EFF_WORDS);
    assert(W.EFF_WORDS.length === 7776, 'EFF list size ' + W.EFF_WORDS.length);
    assert(G.PASSPHRASE_WORDS.length === 7772 && G.PASSPHRASE_WORDS.every((w) => /^[a-z]+$/.test(w)), 'letters-only list');
    for (let i = 0; i < 200; i++) {
      const r = G.generatePassphrase({ words: 6, separator: '.', capitalize: false, includeNumber: false });
      const parts = r.value.split('.');
      assert(parts.length === 6 && parts.every((w) => words.has(w)), r.value);
    }
    for (let i = 0; i < 2000; i++) {
      const r = G.generatePassphrase({ words: 4, separator: '-', capitalize: true, includeNumber: true });
      const parts = r.value.split('-'); // unambiguous: no hyphenated words
      assert(parts.length === 4 && parts.every((w) => /^[A-Z]/.test(w)) && /\d/.test(r.value), r.value);
    }
    const r5 = G.generatePassphrase({ words: 5 });
    assert(r5.entropyBits >= 5 * 12.9 - 0.1, 'entropy ' + r5.entropyBits);
  });
  await rec.run('PIN: digits only, length 4–12, avoidRepeats', () => {
    for (let i = 0; i < 300; i++) assert(/^\d{6}$/.test(G.generatePin({ length: 6 }).value), 'pin');
    assert(G.generatePin({ length: 2 }).value.length === 4 && G.generatePin({ length: 40 }).value.length === 12, 'clamp');
    for (let i = 0; i < 300; i++) assert(!/(.)\1/.test(G.generatePin({ length: 12, avoidRepeats: true }).value), 'repeat');
  });
  await rec.run('normalizePrefs keeps password length, PIN length and mode independent', () => {
    const p = G.normalizePrefs({ mode: 'pin', length: 40, pinLength: 9, words: 7 });
    assert(p.mode === 'pin' && p.length === 40 && p.pinLength === 9 && p.words === 7, JSON.stringify(p));
    const q = G.normalizePrefs({ mode: 'evil', length: 1e9 });
    assert(q.mode === 'password' && q.length === 128, JSON.stringify(q));
  });
  await rec.run('strength estimator: common/patterns weak, generated strong, master policy', () => {
    for (const pw of ['password', 'password1', 'P@ssw0rd!', 'qwerty123', '12345678', 'aaaaaaaaaaaa', 'iloveyou2024']) {
      const s = S.estimateStrength(pw); assert(s.score <= 1, `${pw} score ${s.score}`);
    }
    const strong = S.estimateStrength(G.generatePassword({ length: 20 }).value);
    assert(strong.score === 4, 'generated score ' + strong.score);
    const phrase = S.estimateStrength('correct-horse-battery-staple');
    assert(phrase.score <= 3 && phrase.bits < 70, 'famous phrase bits ' + phrase.bits);
    assert(S.masterPasswordProblems('password1').includes('COMMON'), 'policy common');
    assert(S.masterPasswordProblems('short').includes('MIN_LENGTH'), 'policy len');
    assert(S.masterPasswordProblems('Forms-E2E-Master-Quartz-4471').length === 0, 'policy ok');
  });
  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitGenerator();
  const bad = rec.cases.filter((c) => !c.ok).length;
  console.log(`\nUnit: ${rec.cases.length - bad} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
}
