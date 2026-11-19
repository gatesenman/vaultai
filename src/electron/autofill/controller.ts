/**
 * Human autofill controller (Electron main).
 * - Registers globalShortcut from vault settings
 * - Optionally spawns Watch-Trigger.ps1 for text "pp" (Windows only, opt-in via non-empty trigger)
 * - Opens frameless picker; fill via UIA/clipboard helpers
 * Secrets never go to helper stdout; Fill uses env vars cleared by the script.
 */
import {
  BrowserWindow, globalShortcut, screen, clipboard, ipcMain, app,
} from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { VaultStore } from '../../store/db.js';
import { resolveUiRoot } from '../../server/paths.js';
import { DEFAULT_HOTKEY, DEFAULT_TEXT_TRIGGER } from '../../shared/autofill-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AutofillHost {
  getStore: () => VaultStore | null;
  getPort: () => number;
  isQuitting: () => boolean;
  onAutofillToggle?: (enabled: boolean) => void;
}

let picker: BrowserWindow | null = null;
let watchProc: ChildProcessWithoutNullStreams | null = null;
let registeredHotkey = '';
let host: AutofillHost | null = null;
let watcherWanted = true; // tray toggle
let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;
let ipcWired = false;

function scriptsDir(): string {
  // Packaged: extraResources → resources/win-autofill
  const packed = join(process.resourcesPath || '', 'win-autofill');
  if (existsSync(packed)) return packed;
  // Dev / unpacked: project scripts/win-autofill
  const dev = join(__dirname, '..', '..', '..', 'scripts', 'win-autofill');
  if (existsSync(dev)) return dev;
  return join(app.getAppPath(), 'scripts', 'win-autofill');
}

function psExe(): string {
  return process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

async function runPsJson(scriptName: string, envExtra: Record<string, string> = {}, timeoutMs = 8000): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') return { ok: false, error: 'not-windows' };
  const script = join(scriptsDir(), scriptName);
  if (!existsSync(script)) return { ok: false, error: `missing ${scriptName}` };
  return new Promise((resolve) => {
    const child = spawn(psExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      env: { ...process.env, ...envExtra },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const t = setTimeout(() => { try { child.kill(); } catch { /* */ } resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('close', () => {
      clearTimeout(t);
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try { resolve(JSON.parse(line) as Record<string, unknown>); }
      catch { resolve({ ok: false, error: err || out || 'no-json' }); }
    });
  });
}

export async function detectFocus(): Promise<{
  value: string; name: string; windowTitle: string; processName: string; url: string;
  isPassword: boolean; ok: boolean; error?: string;
  caret: Rect | null; element: Rect | null; fg: number; caretSource: string;
}> {
  const r = await runPsJson('Detect-Focus.ps1');
  return {
    ok: r.ok !== false,
    value: String(r.value || ''),
    name: String(r.name || ''),
    windowTitle: String(r.windowTitle || ''),
    processName: String(r.processName || ''),
    url: String(r.url || ''),
    isPassword: Boolean(r.isPassword),
    error: r.error ? String(r.error) : undefined,
    caret: (r.caret as Rect) || null,
    element: (r.element as Rect) || null,
    fg: Number(r.fg || 0),
    caretSource: String(r.caretSource || ''),
  };
}

async function fillFields(username: string, password: string): Promise<{ ok: boolean; method: string; error?: string }> {
  // Prefer UIA; script falls back to SendKeys+clipboard internally
  const r = await runPsJson('Fill-Fields.ps1', {
    VAULTAI_FILL_USER: username,
    VAULTAI_FILL_PASS: password,
    VAULTAI_FILL_MODE: 'uia',
  }, 12000);
  return { ok: Boolean(r.ok), method: String(r.method || ''), error: r.error ? String(r.error) : undefined };
}

function settingsFromStore() {
  const store = host?.getStore();
  if (!store?.unlocked) return null;
  const s = store.getSettings();
  return {
    enabled: s.autofillEnabled !== false && watcherWanted,
    textTrigger: (s.autofillTextTrigger ?? DEFAULT_TEXT_TRIGGER) as string,
    hotkey: (s.autofillHotkey ?? DEFAULT_HOTKEY) as string,
    confirm: Boolean(s.autofillConfirm),
    clipboardClearSeconds: s.clipboardClearSeconds ?? 30,
    language: (s.language || 'zh-CN') as string,
  };
}

function unregisterHotkey() {
  if (registeredHotkey) {
    try { globalShortcut.unregister(registeredHotkey); } catch { /* */ }
    registeredHotkey = '';
  }
}

function stopTextWatcher() {
  if (watchProc) {
    try { watchProc.stdin.write('STOP\n'); } catch { /* */ }
    try { watchProc.kill(); } catch { /* */ }
    watchProc = null;
  }
}

function startTextWatcher(trigger: string) {
  stopTextWatcher();
  if (process.platform !== 'win32' || !trigger) return;
  const script = join(scriptsDir(), 'Watch-Trigger.ps1');
  if (!existsSync(script)) return;
  try {
    watchProc = spawn(psExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      env: { ...process.env, VAULTAI_TRIGGER: trigger },
      windowsHide: true,
    });
    let buf = '';
    watchProc.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.trim() === 'WAKE') void openPicker();
      }
    });
    watchProc.on('exit', () => { watchProc = null; });
  } catch {
    watchProc = null;
  }
}

export function refreshAutofillRegistration(): void {
  unregisterHotkey();
  stopTextWatcher();
  const s = settingsFromStore();
  if (!s?.enabled) {
    host?.onAutofillToggle?.(false);
    return;
  }
  if (s.hotkey) {
    try {
      const ok = globalShortcut.register(s.hotkey, () => { void openPicker(); });
      if (ok) registeredHotkey = s.hotkey;
    } catch { /* accelerator invalid */ }
  }
  if (s.textTrigger) startTextWatcher(s.textTrigger);
  host?.onAutofillToggle?.(true);
}

export function setAutofillWatcherWanted(on: boolean): void {
  watcherWanted = on;
  refreshAutofillRegistration();
}

export function isAutofillWatcherWanted(): boolean {
  return watcherWanted;
}

type Rect = { x: number; y: number; width: number; height: number };
type MiniCore = {
  MINI: { width: number; rowHeight: number; maxRows: number; footer: number; pad: number; gap: number };
  miniHeight: (n: number) => number;
  chooseAnchor: (a: { caret?: Rect | null; element?: Rect | null; mouse?: { x: number; y: number } | null }) => { rect: Rect; source: string };
  computeMiniBounds: (a: { anchor: Rect; displays: unknown[]; width?: number; height?: number }) => Rect & { flipped: boolean };
  physicalToDip: (r: Rect, displays: unknown[]) => Rect;
  isOutsideClick: (b: Rect, p: { x: number; y: number }) => boolean;
  miniWindowOptions: (b: Rect) => Electron.BrowserWindowConstructorOptions;
  PICKER_KEYS: string[];
};
let corePromise: Promise<MiniCore> | null = null;
function loadCore(): Promise<MiniCore> {
  if (!corePromise) {
    corePromise = import(pathToFileURL(join(resolveUiRoot(), 'autofill', 'mini-core.js')).href) as Promise<MiniCore>;
  }
  return corePromise;
}

let trackProc: ChildProcessWithoutNullStreams | null = null;
let pickerKeys: string[] = [];
let pickerAnchor: Rect | null = null;
let pickerRows = 1;
let pickerInline = false;
let pickerFg = 0;
let openedAt = 0;

function toDip(r: Rect | null | undefined, core: MiniCore): Rect | null {
  if (!r) return null;
  if (process.platform === 'win32' && typeof screen.screenToDipRect === 'function') {
    try { return screen.screenToDipRect(null, r); } catch { /* fall through */ }
  }
  return core.physicalToDip(r, screen.getAllDisplays());
}

function releasePickerKeys() {
  for (const k of pickerKeys) { try { globalShortcut.unregister(k); } catch { /* */ } }
  pickerKeys = [];
}

function grabPickerKeys(core: MiniCore) {
  releasePickerKeys();
  for (const k of core.PICKER_KEYS) {
    try {
      if (globalShortcut.register(k, () => { picker?.webContents.send('autofill:key', k); })) pickerKeys.push(k);
    } catch { /* */ }
  }
}

function stopTracker() {
  if (trackProc) {
    try { trackProc.stdin.write('STOP\n'); } catch { /* */ }
    const p = trackProc;
    setTimeout(() => { try { p.kill(); } catch { /* */ } }, 300);
    trackProc = null;
  }
}

function startTracker(core: MiniCore) {
  stopTracker();
  if (process.platform !== 'win32') return;
  const script = join(scriptsDir(), 'Track-Caret.ps1');
  if (!existsSync(script)) return;
  try {
    trackProc = spawn(psExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    let buf = '';
    trackProc.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        let m: Record<string, unknown>;
        try { m = JSON.parse(line); } catch { continue; }
        if (!picker || picker.isDestroyed()) return;
        if (m.t === 'click') {
          const pt = toDip({ x: Number(m.x), y: Number(m.y), width: 1, height: 1 }, core);
          if (pt && Date.now() - openedAt > 150 && core.isOutsideClick(picker.getBounds(), pt)) closePicker();
        } else if (m.t === 'state') {
          const fg = Number(m.fg || 0);
          if (pickerFg && fg && fg !== pickerFg) { closePicker(); return; } // user switched apps
          if (!m.isPassword) picker.webContents.send('autofill:typed', String(m.value ?? ''));
          const c = m.caret as Rect | undefined;
          if (c) {
            const dip = toDip(c, core);
            if (dip && (!pickerAnchor || Math.abs(dip.y - pickerAnchor.y) > 2 || Math.abs(dip.x - pickerAnchor.x) > 40)) {
              pickerAnchor = dip;
              placePicker(core);
            }
          }
        }
      }
    });
    trackProc.on('exit', () => { trackProc = null; });
  } catch { trackProc = null; }
}

function placePicker(core: MiniCore) {
  if (!picker || picker.isDestroyed() || !pickerAnchor) return;
  const shadow = 8; // transparent margin for CSS shadow
  const h = core.miniHeight(pickerRows) + (pickerInline ? 25 : 0) + shadow;
  const b = core.computeMiniBounds({ anchor: pickerAnchor, displays: screen.getAllDisplays(), width: core.MINI.width + 6, height: h });
  picker.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
}

function closePicker() {
  releasePickerKeys();
  stopTracker();
  if (picker && !picker.isDestroyed()) {
    picker.close();
  }
  picker = null;
}

export async function openPicker(): Promise<void> {
  const store = host?.getStore();
  const port = host?.getPort() ?? 3847;
  if (!store?.unlocked) return;
  const s = settingsFromStore();
  if (!s?.enabled) return;
  const core = await loadCore();

  const focus = await detectFocus();
  const typed = focus.isPassword ? '' : (focus.value || '');
  const hostUrl = focus.url || '';

  if (picker && !picker.isDestroyed()) {
    picker.webContents.send('autofill:context', { typed, focus, language: s.language });
    return;
  }

  const cursor = screen.getCursorScreenPoint(); // already DIP
  const anchor = core.chooseAnchor({
    caret: toDip(focus.caret, core),
    element: toDip(focus.element, core),
    mouse: cursor,
  });
  pickerAnchor = anchor.rect;
  pickerRows = 1;
  // Live filtering needs the tracker (Windows). Elsewhere show a minimal inline filter line.
  pickerInline = process.platform !== 'win32';
  pickerFg = Number(focus.fg || 0);
  openedAt = Date.now();
  const b = core.computeMiniBounds({ anchor: anchor.rect, displays: screen.getAllDisplays(), width: core.MINI.width + 6, height: core.miniHeight(1) + 8 });
  const opts = core.miniWindowOptions(b);
  if (pickerInline) opts.focusable = true; // inline filter must receive keys
  picker = new BrowserWindow({
    ...opts,
    webPreferences: {
      preload: join(__dirname, 'picker-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  picker.setAlwaysOnTop(true, 'pop-up-menu');
  picker.once('ready-to-show', () => {
    if (!picker) return;
    if (pickerInline) picker.show(); else picker.showInactive();
  });
  if (pickerInline) {
    picker.on('blur', () => setTimeout(() => { if (picker && !picker.isDestroyed() && !picker.isFocused()) closePicker(); }, 180));
  }
  picker.on('closed', () => { releasePickerKeys(); stopTracker(); picker = null; });
  if (!pickerInline) { grabPickerKeys(core); startTracker(core); }

  const ui = resolveUiRoot();
  const q = new URLSearchParams({
    port: String(port), lang: s.language, typed, host: hostUrl,
    title: focus.windowTitle || '', process: focus.processName || '',
    confirm: s.confirm ? '1' : '0', inline: pickerInline ? '1' : '0', src: anchor.source,
  });
  await picker.loadFile(join(ui, 'autofill', 'index.html'), { search: q.toString() });
}

async function doFill(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = host?.getStore();
  const port = host?.getPort() ?? 3847;
  if (!store?.unlocked) return { ok: false, error: 'locked' };
  const s = settingsFromStore();
  if (!s?.enabled) return { ok: false, error: 'off' };

  let username = '';
  let password = '';
  let clearAfter = s.clipboardClearSeconds;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/autofill/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await r.json() as { ok?: boolean; username?: string; password?: string; clearAfterSec?: number; message?: string };
    if (!j.ok) return { ok: false, error: j.message || 'prepare-failed' };
    username = j.username || '';
    password = j.password || '';
    clearAfter = j.clearAfterSec ?? clearAfter;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'prepare-error' };
  }

  const wasInline = pickerInline;
  closePicker();
  // Mini box never takes focus on Windows; inline mode (non-Windows) hands it back first.
  await new Promise((r) => setTimeout(r, wasInline ? 150 : 40));

  const prevClip = clipboard.readText();
  const filled = await fillFields(username, password);
  // Always schedule clipboard clear / restore — Fill may have left the password on the clipboard briefly
  if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
  const delay = Math.max(0, (clearAfter || 0) * 1000);
  if (delay > 0) {
    clipboardClearTimer = setTimeout(() => {
      try {
        const cur = clipboard.readText();
        // Only restore/clear if clipboard still looks like our secret
        if (cur === password || cur === username) {
          if (prevClip) clipboard.writeText(prevClip);
          else clipboard.clear();
        }
      } catch { /* */ }
      password = '';
      username = '';
    }, delay);
  } else {
    // Immediate restore when clear is 0? Still wipe our paste residue after a short settle
    setTimeout(() => {
      try {
        const cur = clipboard.readText();
        if (cur === password) {
          if (prevClip) clipboard.writeText(prevClip);
          else clipboard.clear();
        }
      } catch { /* */ }
      password = '';
    }, 500);
  }

  return { ok: filled.ok, error: filled.error, ...(filled.method ? { method: filled.method } as object : {}) };
}

function wireIpc() {
  if (ipcWired) return;
  ipcWired = true;
  ipcMain.handle('autofill:dismiss', () => { closePicker(); return { ok: true }; });
  ipcMain.handle('autofill:fill', async (_e, id: string) => doFill(String(id || '')));
  ipcMain.handle('autofill:detect', async () => detectFocus());
  ipcMain.handle('autofill:open-app', () => {
    closePicker();
    const w = BrowserWindow.getAllWindows().find((x) => x !== picker && !x.isDestroyed());
    if (w) { w.show(); w.focus(); }
    return { ok: true };
  });
  ipcMain.handle('autofill:save-login', async () => {
    closePicker();
    try {
      const { openQuickCreateSheet } = await import('../quickcreate/controller.js');
      await openQuickCreateSheet('save');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'save-login-failed' };
    }
  });
  ipcMain.on('autofill:resize', async (_e, rows: number, inline: boolean) => {
    pickerRows = Math.max(1, Math.min(6, Number(rows) || 1));
    pickerInline = !!inline;
    placePicker(await loadCore());
  });
}

export function initAutofill(h: AutofillHost): void {
  host = h;
  wireIpc();
  // Re-register when vault unlocks / settings change — caller should also invoke refreshAutofillRegistration
  refreshAutofillRegistration();
}

export function shutdownAutofill(): void {
  unregisterHotkey();
  stopTextWatcher();
  closePicker();
}
