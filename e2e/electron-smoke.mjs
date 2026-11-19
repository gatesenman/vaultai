// Electron smoke under xvfb: real app window, embedded server, single-instance lock, port-conflict handling.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Recorder, assert, tempDir, ROOT } from './lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ELECTRON = join(ROOT, 'node_modules', '.bin', 'electron');

function launch({ home, dataDir, port, extraEnv = {}, logFile, debugPort }) {
  const args = ['-a', '-s', '-screen 0 1280x800x24', ELECTRON, '.', '--no-sandbox', '--disable-gpu'];
  if (debugPort) args.push(`--remote-debugging-port=${debugPort}`);
  const c = spawn('xvfb-run', args, {
    cwd: ROOT,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), VAULTAI_DATA: dataDir, VAULTAI_PORT: String(port), ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  const sink = createWriteStream(logFile);
  const on = (d) => { log += d; sink.write(d); };
  c.stdout.on('data', on); c.stderr.on('data', on);
  const exited = new Promise((r) => c.on('exit', (code) => { sink.end(); r(code); }));
  return { c, exited, log: () => log, kill: () => { try { process.kill(-c.pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }, 2000); } };
}

async function waitHealth(port, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return await r.json(); } catch {}
    await sleep(300);
  }
  throw new Error('health timeout on ' + port);
}

export async function runElectronSmoke({ logDir, dataDirs }) {
  const rec = new Recorder('Electron');
  if (spawnSync('which', ['xvfb-run']).status !== 0) { rec.skip('electron smoke', 'xvfb-run not installed'); return [rec]; }
  const home = tempDir('vaultai-e2e-ehome-');
  const dataDir = tempDir('vaultai-e2e-edata-');
  dataDirs.push(dataDir, home);
  const PORT = 3850, DBG = 9333;
  const first = launch({ home, dataDir, port: PORT, logFile: join(logDir, 'electron-1.log'), debugPort: DBG });
  try {
    await rec.run('app starts under xvfb; embedded server healthy on VAULTAI_PORT with isolated VAULTAI_DATA', async () => {
      const h = await waitHealth(PORT);
      assert(h.version === JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, 'version ' + JSON.stringify(h));
      const st = await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json();
      assert(String(st.dataDir || '').startsWith(dataDir) || !st.dataDir, 'dataDir not isolated: ' + st.dataDir);
      return `health ${JSON.stringify(h).slice(0, 80)}`;
    });
    await rec.run('BrowserWindow loaded the UI (CDP target at http://127.0.0.1:3850/), preload ran without errors', async () => {
      let targets = [];
      for (let i = 0; i < 40 && !targets.some((t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${PORT}`)); i++) {
        try { targets = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); } catch {}
        await sleep(300);
      }
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${PORT}`));
      assert(page, 'no page target: ' + JSON.stringify(targets.map((t) => t.url)));
      assert(!/Unable to load preload|preload.*error|SyntaxError/i.test(first.log()), 'preload error in log:\n' + first.log().slice(-800));
      return `title="${page.title}"`;
    });
    await rec.run('single-instance lock: 2nd launch exits quickly, 1st keeps serving', async () => {
      const second = launch({ home, dataDir, port: PORT, logFile: join(logDir, 'electron-2.log') });
      const code = await Promise.race([second.exited, sleep(25000).then(() => 'timeout')]);
      if (code === 'timeout') { second.kill(); throw new Error('second instance did not exit'); }
      const h = await waitHealth(PORT, 5000);
      assert(h.ok !== false, 'first instance died');
      return `2nd exit code ${code}`;
    });
    await rec.run('port already in use: clear error + exit 1 (no silent hang)', async () => {
      const home2 = tempDir('vaultai-e2e-ehome2-'); const d2 = tempDir('vaultai-e2e-edata2-'); dataDirs.push(home2, d2);
      const third = launch({ home: home2, dataDir: d2, port: PORT, extraEnv: { VAULTAI_NO_DIALOG: '1' }, logFile: join(logDir, 'electron-3.log') });
      const code = await Promise.race([third.exited, sleep(30000).then(() => 'timeout')]);
      if (code === 'timeout') { third.kill(); throw new Error('did not exit on EADDRINUSE:\n' + third.log().slice(-600)); }
      assert(/already in use|已被占用/.test(third.log()), 'no clear message:\n' + third.log().slice(-600));
      assert(code !== 0, 'exit code should be non-zero, got ' + code);
      return `exit ${code}`;
    });
    await rec.run('mini picker window: focusable=false, alwaysOnTop, showInactive keeps target focus', async () => {
      const r = spawnSync('xvfb-run', ['-a', ELECTRON, '--no-sandbox', join(ROOT, 'e2e/fixtures/electron-mini-window.mjs')], { env: { ...process.env, VAULTAI_ROOT: ROOT, HOME: home }, encoding: 'utf8', timeout: 60000 });
      const line = (r.stdout + r.stderr).split(/\r?\n/).find((l) => l.startsWith('MINIWIN '));
      assert(line, 'no output: ' + (r.stdout + r.stderr).slice(-600));
      const o = JSON.parse(line.slice(8));
      assert(!o.error, o.error);
      assert(o.focusable === false && o.onTop === true && o.visible === true && o.miniFocused === false && o.resizable === false, JSON.stringify(o));
      return JSON.stringify(o);
    });
  } finally {
    first.kill();
    await Promise.race([first.exited, sleep(5000)]);
  }
  return [rec];
}
