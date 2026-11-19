const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('VaultQuickCreate', {
  dismiss: () => ipcRenderer.invoke('qc:dismiss'),
  save: (payload) => ipcRenderer.invoke('qc:save', payload),
  openMore: (draft) => ipcRenderer.invoke('qc:open-more', draft),
  generate: () => ipcRenderer.invoke('qc:generate'),
  onToast: (cb) => ipcRenderer.on('qc:toast', (_e, msg, kind) => cb(String(msg || ''), String(kind || 'ok'))),
  onPrefillSecret: (cb) => ipcRenderer.on('qc:prefill-secret', (_e, v) => cb(String(v || ''))),
  resize: (h) => ipcRenderer.send('qc:resize', Number(h) || 0),
};
