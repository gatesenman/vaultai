import { app, BrowserWindow, shell, Tray, Menu, nativeImage, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';
import { resolveUiRoot } from '../server/paths.js';
import type { VaultStore } from '../store/db.js';
import {
  initAutofill,
  refreshAutofillRegistration,
  shutdownAutofill,
  setAutofillWatcherWanted,
  isAutofillWatcherWanted,
  openPicker,
} from './autofill/controller.js';
import {
  initQuickCreate,
  refreshQuickCreateRegistration,
  shutdownQuickCreate,
  openQuickCreateSheet,
  getRegisteredQuickCreateHotkey,
} from './quickcreate/controller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverPort = 3847;
let store: VaultStore | null = null;
let quitting = false;
let hintShown = false;
let lastAutofillSig = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;

function appIcon(size?: number) {
  const img = nativeImage.createFromPath(join(resolveUiRoot(), 'img', 'icon.png'));
  return size && !img.isEmpty() ? img.resize({ width: size, height: size }) : img;
}

async function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'VaultAI Tools',
    backgroundColor: '#f3eef7',
    icon: appIcon(),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' || quitting) return;
    if (tray && mainWindow) {
      e.preventDefault();
      mainWindow.hide();
      if (!hintShown && process.platform === 'win32') {
        hintShown = true;
        tray.displayBalloon({
          iconType: 'info',
          title: 'VaultAI 仍在后台运行 / still running',
          content: 'AI 助手仍可通过 VaultAI 使用凭据。右键托盘图标可停用所有 AI 或退出。\nRight-click the tray icon to revoke AI access or quit.',
        });
      }
    }
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const afOn = isAutofillWatcherWanted();
  const unlocked = Boolean(store?.unlocked);
  const show = () => {
    mainWindow?.show();
    mainWindow?.focus();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 VaultAI / Open VaultAI', click: show },
      {
        label: unlocked
          ? (afOn ? '自动填充：开 ✓ / Autofill: On' : '自动填充：关 / Autofill: Off')
          : '自动填充（需先解锁）/ Autofill (unlock first)',
        enabled: unlocked,
        click: () => {
          if (!store?.unlocked) return show();
          setAutofillWatcherWanted(!isAutofillWatcherWanted());
          rebuildTrayMenu();
        },
      },
      {
        label: '唤起填充选择器 / Open autofill picker',
        enabled: unlocked && afOn,
        click: () => { void openPicker(); },
      },
      {
        label: '快速新建登录 / Quick create login',
        enabled: unlocked,
        click: () => { void openQuickCreateSheet(); },
      },
      { type: 'separator' },
      {
        label: '停用所有 AI / Revoke all AI access',
        click: () => {
          if (!store?.unlocked) return show();
          const n = store.revokeAllAssistants();
          store.addActivity({ assistantId: null, assistantName: 'VaultAI', appId: null, appName: '-', action: 'vault:revoke_all', ok: true, reason: `${n} turned off (tray)` });
          mainWindow?.webContents.send('vaultai:refresh');
          tray?.displayBalloon({ iconType: 'info', title: 'VaultAI', content: `已停用 ${n} 个 AI 助手 / ${n} AI assistant(s) turned off` });
        },
      },
      { type: 'separator' },
      {
        label: '退出 / Quit',
        click: () => {
          quitting = true;
          shutdownAutofill();
          shutdownQuickCreate();
          tray?.destroy();
          tray = null;
          app.quit();
        },
      },
    ]),
  );
}

function setupTray() {
  try {
    const img = appIcon(16);
    if (img.isEmpty()) return;
    tray = new Tray(img);
    tray.setToolTip('VaultAI Tools');
    rebuildTrayMenu();
    tray.on('double-click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch {
    tray = null;
  }
}

function pollAutofillState() {
  const s = store?.unlocked ? store.getSettings() : null;
  const sig = s
    ? `${store?.unlocked}|${s.autofillEnabled}|${s.autofillTextTrigger}|${s.autofillHotkey}|${s.quickCreateHotkey}|${s.saveLoginHotkey}|${isAutofillWatcherWanted()}`
    : `locked|${isAutofillWatcherWanted()}`;
  if (sig !== lastAutofillSig) {
    lastAutofillSig = sig;
    refreshAutofillRegistration();
    refreshQuickCreateRegistration();
    rebuildTrayMenu();
  }
}

// Test/smoke isolation: keep Electron profile (settings, caches, single-instance lock) out of %APPDATA%\VaultAI.
if (process.env.VAULTAI_USER_DATA) {
  try { app.setPath('userData', process.env.VAULTAI_USER_DATA); } catch { /* ignore */ }
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const dataDir = process.env.VAULTAI_DATA || join(app.getPath('userData'), 'vault');
    const wantPort = Number(process.env.VAULTAI_PORT) || 3847;
    let port: number;
    try {
      ({ port, store } = await startServer({ host: '127.0.0.1', port: wantPort, dataDir }));
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const msg = code === 'EADDRINUSE'
        ? `端口 ${wantPort} 已被占用（可能已有 VaultAI 在运行）。请关闭占用程序，或设置环境变量 VAULTAI_PORT 换一个端口。\n\nPort ${wantPort} is already in use (another VaultAI may be running). Close it or set VAULTAI_PORT.`
        : `VaultAI 启动失败 / failed to start: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[VaultAI] ' + msg);
      if (process.env.VAULTAI_NO_DIALOG !== '1') dialog.showErrorBox('VaultAI Tools', msg);
      app.exit(1);
      return;
    }
    serverPort = port;
    setupTray();
    initAutofill({
      getStore: () => store,
      getPort: () => serverPort,
      isQuitting: () => quitting,
      onAutofillToggle: () => rebuildTrayMenu(),
    });
    initQuickCreate({
      getStore: () => store,
      getPort: () => serverPort,
      isQuitting: () => quitting,
      showMainWindow: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
      notify: (title, body) => {
        try { tray?.displayBalloon({ iconType: 'info', title, content: body }); } catch { /* */ }
      },
    });
    // Expose registered QC hotkey for smoke tests
    if (process.env.VAULTAI_TEST_HOOKS === '1') {
      (globalThis as unknown as { __vaultaiQcHotkey?: () => string }).__vaultaiQcHotkey = () => getRegisteredQuickCreateHotkey();
    }
    pollTimer = setInterval(pollAutofillState, 1500);
    await createWindow(port);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
      else mainWindow?.show();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    if (pollTimer) clearInterval(pollTimer);
    shutdownAutofill();
    shutdownQuickCreate();
  });

  app.on('will-quit', () => {
    shutdownAutofill();
    shutdownQuickCreate();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit();
  });
}
