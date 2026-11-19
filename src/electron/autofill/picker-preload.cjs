const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('VaultAutofill', {
  dismiss: () => ipcRenderer.invoke('autofill:dismiss'),
  fill: (id) => ipcRenderer.invoke('autofill:fill', id),
  openApp: () => ipcRenderer.invoke('autofill:open-app'),
  saveLogin: () => ipcRenderer.invoke('autofill:save-login'),
  detect: () => ipcRenderer.invoke('autofill:detect'),
  resize: (rows, inline) => ipcRenderer.send('autofill:resize', rows, !!inline),
  onContext: (cb) => ipcRenderer.on('autofill:context', (_e, data) => cb(data)),
  onTyped: (cb) => ipcRenderer.on('autofill:typed', (_e, v) => cb(String(v ?? ''))),
  onKey: (cb) => ipcRenderer.on('autofill:key', (_e, k) => cb(String(k))),
});
