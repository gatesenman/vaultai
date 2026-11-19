// Unit tests for multi-source password import parsers (1.9.0).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder, assert, ROOT } from './lib.mjs';

export async function runUnitImport() {
  const P = await import(pathToFileURL(join(ROOT, 'dist', 'shared', 'import-passwords.js')).href);
  const rec = new Recorder('Unit-Import');
  const fx = (name) => readFileSync(join(ROOT, 'e2e', 'fixtures', 'import', name), 'utf8');

  await rec.run('rejects encrypted .pswe by extension (no rows)', () => {
    const r = P.parseImportFile('not-really-binary', 'vault.pswe');
    assert(r.rows.length === 0, 'rows');
    assert(r.format === 'unknown', 'format');
    assert(/CSV or XML/i.test(r.warnings.join(' ')), r.warnings.join('|'));
  });

  await rec.run('Password Depot CSV (; + header): maps Description→title, Comments→notes, Tags+Category', () => {
    const r = P.parseImportFile(fx('password-depot.csv'), 'password-depot.csv');
    assert(r.format === 'password-depot-csv', r.format);
    assert(r.delimiter === ';', r.delimiter);
    assert(r.rows.length === 3, 'row count ' + r.rows.length); // includes no-password row as finalize allows
    const gh = r.rows.find((x) => x.title === 'GitHub');
    assert(gh && gh.username === 'alice' && gh.password === 'DepotPass1!', JSON.stringify(gh));
    assert(gh.url.includes('github.com'), gh.url);
    assert(gh.notes === 'work account', gh.notes);
    assert(gh.tags?.includes('git') && gh.tags?.includes('Dev'), JSON.stringify(gh.tags));
    const empty = r.rows.find((x) => x.title === 'NoPasswordRow');
    assert(empty && !empty.password, 'empty pw kept for store to fail');
  });

  await rec.run('generic comma CSV (name/folder headers)', () => {
    const r = P.parseImportFile(fx('generic-comma.csv'), 'generic-comma.csv');
    assert(r.format === 'generic-csv', r.format);
    assert(r.delimiter === ',', r.delimiter);
    assert(r.rows.length === 1, r.rows.length);
    assert(r.rows[0].title === 'Bitwarden Style', r.rows[0].title);
    assert(r.rows[0].tags?.includes('Personal'), JSON.stringify(r.rows[0].tags));
  });

  await rec.run('Password Depot XML ITEM blocks', () => {
    const r = P.parseImportFile(fx('password-depot.xml'), 'password-depot.xml');
    assert(r.format === 'password-depot-xml', r.format);
    assert(r.rows.length === 1, r.rows.length);
    const x = r.rows[0];
    assert(x.title === 'XML Item' && x.username === 'xmluser' && x.password === 'XmlPass9!', JSON.stringify(x));
    assert(x.tags?.includes('xml') && x.tags?.includes('Imported'), JSON.stringify(x.tags));
  });

  await rec.run('delimiter auto-detect prefers ; when denser', () => {
    const text = 'Description;Username;Password\nA;u;p1\nB;v;p2\n';
    const r = P.parseCsvImport(text);
    assert(r.delimiter === ';', r.delimiter);
  });

  await rec.run('importMatchKey normalizes host + username', () => {
    assert(P.importMatchKey('https://WWW.GitHub.com/login', 'Alice') === P.importMatchKey('github.com', 'alice'));
    assert(P.importMatchKey('https://a.com', 'x') !== P.importMatchKey('https://a.com', 'y'));
  });

  await rec.run('CSV without header assumes PD default columns when ;', () => {
    const line = '"OnlyTitle";"0";"Secret!";"";;"user";"https://x.example";"c";"Cat";"t";"a";"";""';
    const r = P.parseCsvImport(line);
    assert(r.format === 'password-depot-csv', r.format);
    assert(r.rows[0].title === 'OnlyTitle' && r.rows[0].password === 'Secret!', JSON.stringify(r.rows[0]));
    assert(/No header/i.test(r.warnings.join(' ')), r.warnings.join('|'));
  });


  await rec.run('Chrome CSV auto-detect', () => {
    const r = P.parseImportFile(fx('chrome.csv'), 'chrome_passwords.csv');
    assert(r.format === 'chrome-csv', r.format);
    assert(r.rows.length === 1 && r.rows[0].username === 'chrome-user', JSON.stringify(r.rows[0]));
  });

  await rec.run('Edge CSV via filename', () => {
    const r = P.parseImportFile(fx('edge.csv'), 'edge_export.csv');
    assert(r.format === 'edge-csv', r.format);
    assert(r.rows[0].title === 'Outlook', r.rows[0].title);
  });

  await rec.run('Firefox CSV (httpRealm / formActionOrigin)', () => {
    const r = P.parseImportFile(fx('firefox.csv'), 'firefox.csv');
    assert(r.format === 'firefox-csv', r.format);
    assert(r.rows[0].username === 'ff-user' && r.rows[0].password === 'FfPass3!', JSON.stringify(r.rows[0]));
  });

  await rec.run('Bitwarden CSV + TOTP + skip note type', () => {
    const r = P.parseImportFile(fx('bitwarden.csv'), 'bitwarden.csv');
    assert(r.format === 'bitwarden-csv', r.format);
    assert(r.rows.length === 1, 'only login rows ' + r.rows.length);
    assert(r.rows[0].totp && /otpauth|JBSWY3DPEHPK3PXP/i.test(r.rows[0].totp), r.rows[0].totp);
    assert(r.rows[0].tags?.includes('Personal'), JSON.stringify(r.rows[0].tags));
  });

  await rec.run('1Password CSV + OTPAuth', () => {
    const r = P.parseImportFile(fx('onepassword.csv'), '1password.csv');
    assert(r.format === 'onepassword-csv', r.format);
    assert(r.rows[0].totp && /MFRGGZDFMZTWQ2LK/i.test(r.rows[0].totp), r.rows[0].totp);
  });

  await rec.run('KeePass CSV + TOTP column', () => {
    const r = P.parseImportFile(fx('keepass.csv'), 'keepass.csv');
    assert(r.format === 'keepass-csv', r.format);
    assert(r.rows[0].totp === 'JBSWY3DPEHPK3PXP', r.rows[0].totp);
    assert(r.rows[0].tags?.some((x) => /Dev|Internet/i.test(x)), JSON.stringify(r.rows[0].tags));
  });

  await rec.run('KeePass XML Entry/String', () => {
    const r = P.parseImportFile(fx('keepass.xml'), 'keepass.xml');
    assert(r.format === 'keepass-xml', r.format);
    assert(r.rows[0].title === 'KP XML Item' && r.rows[0].password === 'KpXml7!', JSON.stringify(r.rows[0]));
  });

  await rec.run('formatLabel covers new dialects', () => {
    assert(P.formatLabel('chrome-csv').includes('Chrome'), P.formatLabel('chrome-csv'));
    assert(P.formatLabel('bitwarden-csv').includes('Bitwarden'), P.formatLabel('bitwarden-csv'));
  });

  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitImport();
  const failed = rec.cases.filter((c) => c.ok === false).length;
  console.log(`SUMMARY import-unit ${rec.cases.filter((c) => c.ok).length}/${rec.cases.length}`);
  process.exitCode = failed ? 1 : 0;
}
