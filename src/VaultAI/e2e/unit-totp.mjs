// Unit tests for RFC 6238 TOTP (VaultAI 1.9.0).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Recorder, assert, ROOT } from './lib.mjs';

export async function runUnitTotp() {
  const T = await import(pathToFileURL(join(ROOT, 'dist', 'shared', 'totp.js')).href);
  const rec = new Recorder('Unit-Totp');

  // RFC 6238 Appendix B seed "12345678901234567890" as Base32
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  await rec.run('RFC 6238 SHA1 8-digit vectors', () => {
    const cases = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [at, want] of cases) {
      const g = T.generateTotp({ secret: RFC_SECRET, at, digits: 8, period: 30, algo: 'SHA1' });
      assert(g.code === want, `at=${at} got ${g.code} want ${want}`);
      assert(g.remaining >= 1 && g.remaining <= 30, 'remaining');
    }
  });

  await rec.run('6-digit default + remaining countdown', () => {
    const g = T.generateTotp({ secret: RFC_SECRET, at: 59, digits: 6 });
    assert(g.code === '287082', g.code); // last 6 of 94287082
    assert(g.remaining === 1, String(g.remaining)); // 59 % 30 = 29 → remaining 1
    assert(g.period === 30 && g.algo === 'SHA1', 'defaults');
  });

  await rec.run('parse otpauth:// URI extracts secret + params', () => {
    const p = T.parseTotpInput('otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30&algorithm=SHA1');
    assert(p.secret === 'JBSWY3DPEHPK3PXP', p.secret);
    assert(p.issuer === 'GitHub', p.issuer);
    assert(p.account === 'alice', p.account);
    assert(p.digits === 6 && p.period === 30, 'params');
  });

  await rec.run('bare Base32 secret + spaces normalize', () => {
    const p = T.parseTotpInput(' jbsw y3dp ehpk 3pxp ');
    assert(p.secret === 'JBSWY3DPEHPK3PXP', p.secret);
    const g = T.generateTotp({ secret: 'jbsw y3dp ehpk 3pxp', at: 1234567890 });
    assert(/^\d{6}$/.test(g.code), g.code);
  });

  await rec.run('canonicalizeTotpSecret strips otpauth to Base32', () => {
    const s = T.canonicalizeTotpSecret('otpauth://totp/X?secret=MFRGGZDFMZTWQ2LK&issuer=X');
    assert(s === 'MFRGGZDFMZTWQ2LK', s);
  });

  await rec.run('verifyTotp accepts current window', () => {
    const at = 1_111_111_111;
    const g = T.generateTotp({ secret: RFC_SECRET, at, digits: 6 });
    assert(T.verifyTotp(RFC_SECRET, g.code, { at, window: 1 }), 'current');
    assert(!T.verifyTotp(RFC_SECRET, '000000', { at, window: 0 }), 'reject');
  });

  await rec.run('buildOtpAuthUri round-trips', () => {
    const uri = T.buildOtpAuthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'bob', issuer: 'VaultAI' });
    assert(uri.startsWith('otpauth://totp/'), uri);
    const p = T.parseTotpInput(uri);
    assert(p.secret === 'JBSWY3DPEHPK3PXP', p.secret);
    assert(/VaultAI/i.test(p.issuer || '') || /VaultAI/i.test(p.label || ''), JSON.stringify(p));
  });

  await rec.run('rejects empty / invalid Base32', () => {
    let threw = false;
    try { T.parseTotpInput(''); } catch { threw = true; }
    assert(threw, 'empty');
    threw = false;
    try { T.parseTotpInput('!!!!'); } catch { threw = true; }
    assert(threw, 'invalid');
  });

  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitTotp();
  const failed = rec.cases.filter((c) => c.ok === false).length;
  console.log(`SUMMARY totp-unit ${rec.cases.filter((c) => c.ok).length}/${rec.cases.length}`);
  process.exitCode = failed ? 1 : 0;
}
