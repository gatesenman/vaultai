// CommonJS preload (Electron cannot load ESM preloads in sandboxed renderers)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vaultai', {
  platform: process.platform,
  isElectron: true,
  /** Tray actions (e.g. "Revoke all AI access") ask the page to refresh. */
  onRefresh: (fn) => ipcRenderer.on('vaultai:refresh', () => fn()),
});
