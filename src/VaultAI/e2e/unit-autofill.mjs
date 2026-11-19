/** Unit tests for autofill match ranking + trigger boundary. */
import { Recorder, assert, ROOT } from './lib.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export async function runUnitAutofill() {
  const mod = await import(pathToFileURL(join(ROOT, 'dist/shared/autofill-match.js')).href);
  const { rankAutofillMatches, isTriggerBoundary, normalizeQuery, DEFAULT_TEXT_TRIGGER, DEFAULT_HOTKEY } = mod;
  const rec = new Recorder('Unit-Autofill');

  const entries = [
    { id: '1', title: 'GitHub', username: 'alice@example.com', url: 'https://github.com/login', favorite: true, updatedAt: '2026-10-01T00:00:00Z', tags: ['dev'] },
    { id: '2', title: 'GitHub work', username: 'alice.work', url: 'https://github.com', favorite: false, updatedAt: '2026-09-01T00:00:00Z' },
    { id: '3', title: 'Bank', username: 'alice', url: 'https://bank.example.com', favorite: false, updatedAt: '2026-08-01T00:00:00Z' },
    { id: '4', title: 'Notes', username: 'other', url: '', favorite: true, updatedAt: '2026-10-10T00:00:00Z', tags: ['personal'] },
    { id: '5', title: 'Gmail', username: 'alice@gmail.com', url: 'https://mail.google.com', favorite: false, updatedAt: '2026-07-01T00:00:00Z' },
  ];

  await rec.run('autofill defaults + normalizeQuery', () => {
    assert(DEFAULT_TEXT_TRIGGER === 'pp');
    assert(DEFAULT_HOTKEY.includes('Shift+P'));
    assert(normalizeQuery('  AbC ') === 'abc');
  });

  await rec.run('trigger boundary: start / space / letter', () => {
    assert(isTriggerBoundary(undefined));
    assert(isTriggerBoundary(''));
    assert(isTriggerBoundary(' '));
    assert(isTriggerBoundary('.'));
    assert(!isTriggerBoundary('a'));
    assert(!isTriggerBoundary('9'));
  });

  await rec.run('exact username wins over favorite-only', () => {
    const r = rankAutofillMatches(entries, { typed: 'alice@example.com' });
    assert(r[0].id === '1', JSON.stringify(r.map((x) => x.id)));
    assert(r[0].reasons.includes('user-exact'));
  });

  await rec.run('username prefix ranks alice* above unrelated favorite', () => {
    const r = rankAutofillMatches(entries, { typed: 'alice' });
    assert(r[0].username.toLowerCase().startsWith('alice'), r[0].username);
    assert(r.every((x) => /alice|gmail|bank|github/i.test(x.username + x.title + (x.url || ''))), 'noise');
  });

  await rec.run('host from URL matches github entries first', () => {
    const r = rankAutofillMatches(entries, { typed: '', host: 'github.com' });
    assert(r[0].url.includes('github'), r[0].url);
    assert(r.filter((x) => x.url?.includes('github')).length >= 2);
  });

  await rec.run('host extracted from window title', () => {
    const r = rankAutofillMatches(entries, { windowTitle: 'Sign in - github.com - Chromium' });
    assert(r[0].url.includes('github'), JSON.stringify(r.slice(0, 3)));
  });

  await rec.run('favorite boost with empty query', () => {
    const r = rankAutofillMatches(entries, {});
    assert(r[0].favorite || r.some((x) => x.favorite), 'fav');
    assert(r.length <= 12);
  });

  await rec.run('no false match on random typed string', () => {
    const r = rankAutofillMatches(entries, { typed: 'zzzxxyy-nomatch' });
    assert(r.length === 0, JSON.stringify(r));
  });

  await rec.run('tag match', () => {
    const r = rankAutofillMatches(entries, { typed: 'dev' });
    assert(r.some((x) => x.id === '1'));
  });

  await rec.run('subdomain related host', () => {
    const r = rankAutofillMatches(
      [{ id: 'a', title: 'App', username: 'u', url: 'https://app.bank.example.com' }],
      { host: 'bank.example.com' },
    );
    assert(r[0]?.reasons.includes('host-related') || r[0]?.reasons.includes('host-exact'), JSON.stringify(r[0]));
  });

  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitAutofill();
  const failed = rec.cases.filter((c) => c.ok === false).length;
  console.log(`SUMMARY autofill-unit ${rec.cases.filter((c) => c.ok).length}/${rec.cases.length}`);
  process.exitCode = failed ? 1 : 0;
}
