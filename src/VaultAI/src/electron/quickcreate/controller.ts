/**
 * Global hotkey quick-create (1.8.0).
 * Tray-resident mini floating sheet near caret — mirrors autofill window/caret stack.
 * Distinct from autofill Ctrl+Shift+P and in-app Ctrl+N on Passwords page.
 */
import {
  BrowserWindow, globalShortcut, screen, ipcMain, app,
} from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { VaultStore } from '../../store/db.js';
import { resolveUiRoot } from '../../server/paths.js';
import { detectFocus } from '../autofill/controller.js';
import { DEFAULT_QC_HOTKEY, DEFAULT_SAVE_HOTKEY } from '../../shared/autofill-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface QuickCreateHost {
  getStore: () => VaultStore | null;
  getPort: () => number;
  isQuitting: () => boolean;
  showMainWindow: () => void;
  /** Optional balloon / tray toast */
  notify?: (title: string, body: string) => void;
}

let sheet: BrowserWindow | null = null;
let registeredHotkey = '';
let registeredSaveHotkey = '';
let host: QuickCreateHost | null = null;
let ipcWired = false;
let sheetAnchor: { x: number; y: number; width: number; height: number } | null = null;
/** 'quick' = blank QC; 'save' = capture-from-focus (Ctrl+Shift+S / autofill empty-state) */
let sheetMode: 'quick' | 'save' = 'quick';

const QC_WIDTH = 340;
const QC_HEIGHT_DEFAULT = 292;

type MiniCore = {
  chooseAnchor: (a: { caret?: Rect | null; element?: Rect | null; mouse?: { x: number; y: number } | null }) => { rect: Rect; source: string };
  computeMiniBounds: (a: { anchor: Rect; displays: unknown[]; width?: number; height?: number }) => Rect & { flipped: boolean };
  physicalToDip: (r: Rect, displays: unknown[]) => Rect;
  miniWindowOptions: (b: Rect) => Electron.BrowserWindowConstructorOptions;
};
type Rect = { x: number; y: number; width: number; height: number };

let corePromise: Promise<MiniCore> | null = null;
function loadCore(): Promise<MiniCore> {
  if (!corePromise) {
    corePromise = import(pathToFileURL(join(resolveUiRoot(), 'autofill', 'mini-core.js')).href) as Promise<MiniCore>;
  }
  return corePromise;
}

function settingsFromStore() {
  const store = host?.getStore();
  if (!store?.unlocked) return null;
  const s = store.getSettings();
  return {
    hotkey: (s.quickCreateHotkey ?? DEFAULT_QC_HOTKEY) as string,
    saveHotkey: (s.saveLoginHotkey ?? DEFAULT_SAVE_HOTKEY) as string,
    language: (s.language || 'zh-CN') as string,
  };
}

function unregisterHotkey() {
  if (registeredHotkey) {
    try { globalShortcut.unregister(registeredHotkey); } catch { /* */ }
    registeredHotkey = '';
  }
  if (registeredSaveHotkey) {
    try { globalShortcut.unregister(registeredSaveHotkey); } catch { /* */ }
    registeredSaveHotkey = '';
  }
}

export function refreshQuickCreateRegistration(): void {
  unregisterHotkey();
  const s = settingsFromStore();
  if (!s) return;
  try {
    if (s.hotkey) {
      const ok = globalShortcut.register(s.hotkey, () => { void openQuickCreateSheet('quick'); });
      if (ok) registeredHotkey = s.hotkey;
    }
  } catch { /* invalid accelerator */ }
  try {
    // Distinct from QC / autofill; only reads focus AFTER the hotkey (no always-on keylog)
    if (s.saveHotkey && s.saveHotkey !== s.hotkey) {
      const ok = globalShortcut.register(s.saveHotkey, () => { void openQuickCreateSheet('save'); });
      if (ok) registeredSaveHotkey = s.saveHotkey;
    }
  } catch { /* invalid accelerator */ }
}

export function getRegisteredQuickCreateHotkey(): string {
  return registeredHotkey;
}

export function getRegisteredSaveLoginHotkey(): string {
  return registeredSaveHotkey;
}

function toDip(r: Rect | null | undefined, core: MiniCore): Rect | null {
  if (!r) return null;
  if (process.platform === 'win32' && typeof screen.screenToDipRect === 'function') {
    try { return screen.screenToDipRect(null, r); } catch { /* */ }
  }
  return core.physicalToDip(r, screen.getAllDisplays());
}

function placeSheet(core: MiniCore, height = QC_HEIGHT_DEFAULT) {
  if (!sheet || sheet.isDestroyed() || !sheetAnchor) return;
  const b = core.computeMiniBounds({
    anchor: sheetAnchor,
    displays: screen.getAllDisplays(),
    width: QC_WIDTH + 8,
    height: height + 8,
  });
  sheet.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
}

function closeSheet() {
  if (sheet && !sheet.isDestroyed()) sheet.close();
  sheet = null;
  sheetAnchor = null;
}

export async function openQuickCreateSheet(mode: 'quick' | 'save' = 'quick'): Promise<void> {
  const store = host?.getStore();
  const port = host?.getPort() ?? 3847;
  if (!store?.unlocked) {
    // Locked: do not expose secrets; nudge unlock via main window
    host?.showMainWindow();
    return;
  }
  const s = settingsFromStore();
  if (!s) return;
  sheetMode = mode;
  const core = await loadCore();

  if (sheet && !sheet.isDestroyed()) {
    sheet.show();
    sheet.focus();
    return;
  }

  let focus: Awaited<ReturnType<typeof detectFocus>> | null = null;
  try { focus = await detectFocus(); } catch { focus = null; }
  const cursor = screen.getCursorScreenPoint();
  const anchor = core.chooseAnchor({
    caret: toDip(focus?.caret || null, core),
    element: toDip(focus?.element || null, core),
    mouse: cursor,
  });
  sheetAnchor = anchor.rect;
  const b = core.computeMiniBounds({
    anchor: anchor.rect,
    displays: screen.getAllDisplays(),
    width: QC_WIDTH + 8,
    height: QC_HEIGHT_DEFAULT + 8,
  });
  const opts = core.miniWindowOptions(b);
  // Form needs typing → focusable + show() (unlike autofill picker's showInactive)
  opts.focusable = true;
  sheet = new BrowserWindow({
    ...opts,
    webPreferences: {
      preload: join(__dirname, 'sheet-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  sheet.setAlwaysOnTop(true, 'pop-up-menu');
  sheet.once('ready-to-show', () => {
    if (!sheet) return;
    sheet.show();
    sheet.focus();
  });
  sheet.on('blur', () => {
    // Allow brief focus loss (e.g. generator); dismiss if still blurred
    setTimeout(() => {
      if (sheet && !sheet.isDestroyed() && !sheet.isFocused()) closeSheet();
    }, 220);
  });
  sheet.on('closed', () => { sheet = null; sheetAnchor = null; });

  // Prefill from focus ONLY after hotkey/explicit save — never continuous capture
  let preUser = '';
  let prePass = '';
  if (mode === 'save' && focus) {
    if (focus.isPassword && focus.value) prePass = focus.value;
    else if (focus.value && !focus.isPassword) preUser = focus.value;
  }

  const ui = resolveUiRoot();
  const q = new URLSearchParams({
    port: String(port),
    lang: s.language,
    mode,
    url: focus?.url || '',
    host: (() => {
      try {
        if (focus?.url) return new URL(focus.url).hostname;
      } catch { /* */ }
      return '';
    })(),
    title: focus?.windowTitle ? String(focus.windowTitle).slice(0, 80) : '',
    user: preUser,
    src: anchor.source,
  });
  await sheet.loadFile(join(ui, 'quickcreate', 'index.html'), { search: q.toString() });
  if (prePass && sheet && !sheet.isDestroyed()) {
    sheet.webContents.once('did-finish-load', () => {
      sheet?.webContents.send('qc:prefill-secret', prePass);
      prePass = '';
    });
  }
}

function wireIpc() {
  if (ipcWired) return;
  ipcWired = true;

  ipcMain.handle('qc:dismiss', () => { closeSheet(); return { ok: true }; });

  ipcMain.handle('qc:generate', async () => {
    const port = host?.getPort() ?? 3847;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'password' }),
      });
      const j = await r.json() as { ok?: boolean; value?: string; password?: string; message?: string };
      const val = j.value || j.password;
      if (!j.ok || !val) return { ok: false, error: j.message || 'gen-failed' };
      return { ok: true, value: val };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'gen-error' };
    }
  });

  ipcMain.handle('qc:save', async (_e, payload: {
    title?: string; username?: string; password?: string; url?: string; another?: boolean;
  }) => {
    const store = host?.getStore();
    const port = host?.getPort() ?? 3847;
    if (!store?.unlocked) return { ok: false, error: 'locked' };
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/passwords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload?.title || '',
          username: payload?.username || '',
          password: payload?.password || '',
          url: payload?.url || undefined,
        }),
      });
      const j = await r.json() as { ok?: boolean; password?: { id?: string }; message?: string };
      if (!j.ok) return { ok: false, error: j.message || 'save-failed' };
      const zh = (store.getSettings().language || 'zh-CN').startsWith('zh');
      host?.notify?.('VaultAI', zh ? '条目已保存' : 'Item saved');
      if (!payload?.another) closeSheet();
      return { ok: true, id: j.password?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'save-error' };
    }
  });

  ipcMain.handle('qc:open-more', (_e, draft: {
    title?: string; username?: string; url?: string; password?: string;
  }) => {
    closeSheet();
    host?.showMainWindow();
    // Ask main window to open full editor with draft
    const w = BrowserWindow.getAllWindows().find((x) => x !== sheet && !x.isDestroyed());
    if (w) {
      w.webContents.send('vaultai:quick-create-more', draft || {});
    }
    return { ok: true };
  });

  ipcMain.on('qc:resize', async (_e, h: number) => {
    const height = Math.max(200, Math.min(480, Number(h) || QC_HEIGHT_DEFAULT));
    placeSheet(await loadCore(), height);
  });
}

export function initQuickCreate(h: QuickCreateHost): void {
  host = h;
  wireIpc();
  refreshQuickCreateRegistration();
}

export function shutdownQuickCreate(): void {
  unregisterHotkey();
  closeSheet();
}
