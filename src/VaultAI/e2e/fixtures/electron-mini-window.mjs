// Real Electron check of the mini picker window flags (non-activating, on top, no taskbar).
import { app, BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = process.env.VAULTAI_ROOT;
const core = await import(pathToFileURL(join(root, 'ui/autofill/mini-core.js')).href);
app.whenReady().then(async () => {
  const out = {};
  try {
    const main = new BrowserWindow({ width: 500, height: 300, show: true });
    await main.loadURL('data:text/html,<input id=u autofocus>');
    main.focus();
    await new Promise((r) => setTimeout(r, 400));
    const b = core.computeMiniBounds({ anchor: { x: 100, y: 100, width: 1, height: 18 }, displays: (await import('electron')).screen.getAllDisplays(), height: core.miniHeight(3) + 8, width: core.MINI.width + 6 });
    const w = new BrowserWindow(core.miniWindowOptions(b));
    w.setAlwaysOnTop(true, 'pop-up-menu');
    await w.loadFile(join(root, 'ui/autofill/index.html'), { search: 'port=1&lang=en' });
    w.showInactive();
    await new Promise((r) => setTimeout(r, 500));
    Object.assign(out, {
      focusable: w.isFocusable(), onTop: w.isAlwaysOnTop(), visible: w.isVisible(),
      miniFocused: w.isFocused(), mainFocused: main.isFocused(), bounds: w.getBounds(),
      resizable: w.isResizable(),
    });
  } catch (e) { out.error = String(e); }
  console.log('MINIWIN ' + JSON.stringify(out));
  app.exit(0);
});
