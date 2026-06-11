'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, explicit API to the renderer. The renderer never gets
// direct Node/fs access — it can only call these vetted channels.
contextBridge.exposeInMainWorld('api', {
  locate: () => ipcRenderer.invoke('config:locate'),
  read: () => ipcRenderer.invoke('config:read'),
  save: (servers) => ipcRenderer.invoke('config:save', servers),
  chooseFile: () => ipcRenderer.invoke('config:choose'),
  resetPath: () => ipcRenderer.invoke('config:resetPath'),
  openFolder: () => ipcRenderer.invoke('config:openFolder'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (id) => ipcRenderer.invoke('backups:restore', id),
  browseCatalog: () => ipcRenderer.invoke('catalog:browse'),
});
