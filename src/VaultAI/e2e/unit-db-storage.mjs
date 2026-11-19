// Unit tests: DB storage schema + AES-GCM field round-trip on temp SQLite (1.8.0).
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Recorder, assert, ROOT } from './lib.mjs';

export async function runUnitDbStorage() {
  const DB = await import(pathToFileURL(join(ROOT, 'dist', 'server', 'db-storage.js')).href);
  const Crypto = await import(pathToFileURL(join(ROOT, 'dist', 'crypto', 'vault.js')).href);
  const rec = new Recorder('Unit-DbStorage');
  const dir = mkdtempSync(join(tmpdir(), 'vaultai-db-'));
  const sqlitePath = join(dir, 'passwords.sqlite');
  const vaultKey = randomBytes(32);

  const pe = {
    id: 'pw_test1',
    title: 'Example Site',
    username: 'alice@example.com',
    passwordEnc: Crypto.encrypt('S3cret!Pass', vaultKey),
    url: 'https://example.com/login',
    notes: 'recovery codes in drawer',
    tags: ['work', 'web'],
    favorite: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    passwordUpdatedAt: '2026-01-02T00:00:00.000Z',
  };

  await rec.run('sqlite: ensureSchema creates vaultai_passwords', async () => {
    const backend = await DB.openBackend({ engine: 'sqlite', sqlitePath });
    await backend.ensureSchema();
    const rows = await backend.listAll();
    assert(Array.isArray(rows) && rows.length === 0, 'empty');
    await backend.close();
    assert(existsSync(sqlitePath), 'file written');
  });

  await rec.run('encrypted upsert + list + decode round-trip', async () => {
    const backend = await DB.openBackend({ engine: 'sqlite', sqlitePath });
    await backend.ensureSchema();
    const row = DB.encodeEntryRow(pe, vaultKey, false);
    assert(row.enc_mode === 'vault-aes', row.enc_mode);
    assert(row.password_pt == null && row.username_pt == null, 'no plaintext cols');
    assert(typeof row.password_enc === 'string' && row.password_enc.includes('ciphertext'), 'enc json');
    await backend.upsert(row);
    const listed = await backend.listAll();
    assert(listed.length === 1, listed.length);
    const decoded = DB.decodeEntryRow(listed[0], vaultKey);
    assert(decoded.id === pe.id && decoded.title === pe.title, decoded.title);
    assert(decoded.username === pe.username, decoded.username);
    assert(decoded.notes === pe.notes, decoded.notes);
    assert(decoded.url === pe.url, decoded.url);
    assert(JSON.stringify(decoded.tags) === JSON.stringify(pe.tags), JSON.stringify(decoded.tags));
    assert(decoded.favorite === true, 'favorite');
    const pw = Crypto.decrypt(decoded.passwordEnc, vaultKey).toString('utf8');
    assert(pw === 'S3cret!Pass', pw);
    // ciphertext must not contain plaintext password
    const raw = readFileSync(sqlitePath);
    assert(!raw.includes(Buffer.from('S3cret!Pass')), 'sqlite must not contain plaintext password');
    assert(!raw.includes(Buffer.from('alice@example.com')), 'sqlite must not contain plaintext username');
    await backend.close();
  });

  await rec.run('removePasswordFromDb deletes row', async () => {
    const backend = await DB.openBackend({ engine: 'sqlite', sqlitePath });
    await DB.removePasswordFromDb(backend, pe.id);
    const listed = await backend.listAll();
    assert(listed.length === 0, listed.length);
    await backend.close();
  });

  await rec.run('plaintext mode writes pt columns when requested', async () => {
    const path2 = join(dir, 'plain.sqlite');
    const backend = await DB.openBackend({ engine: 'sqlite', sqlitePath: path2 });
    await backend.ensureSchema();
    const row = DB.encodeEntryRow(pe, vaultKey, true);
    assert(row.enc_mode === 'plaintext', row.enc_mode);
    assert(row.password_pt === 'S3cret!Pass', row.password_pt);
    await backend.upsert(row);
    const decoded = DB.decodeEntryRow((await backend.listAll())[0], vaultKey);
    assert(Crypto.decrypt(decoded.passwordEnc, vaultKey).toString('utf8') === 'S3cret!Pass');
    assert(decoded.username === pe.username);
    await backend.close();
  });

  await rec.run('testDbConnection succeeds for sqlite path', async () => {
    const r = await DB.testDbConnection({ engine: 'sqlite', sqlitePath: join(dir, 'probe.sqlite') });
    assert(r.ok === true, JSON.stringify(r));
  });

  await rec.run('publicDbStorage redacts secrets', () => {
    const pub = DB.publicDbStorage({
      enabled: true, engine: 'postgres', host: 'db.internal', user: 'u',
      passwordEnc: Crypto.encrypt('db-secret', vaultKey),
      allowPlaintextStorage: false,
    }, true);
    assert(pub.hasPassword === true, 'hasPassword');
    assert(pub.passwordEnc === undefined && pub.password === undefined, 'no pw leak');
    assert(pub.host === 'db.internal', pub.host);
  });

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitDbStorage();
  const failed = rec.cases.filter((c) => c.ok === false).length;
  console.log(`SUMMARY db-storage-unit ${rec.cases.filter((c) => c.ok).length}/${rec.cases.length}`);
  process.exitCode = failed ? 1 : 0;
}
