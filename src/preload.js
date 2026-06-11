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
  getCatalogConfig: () => ipcRenderer.invoke('catalog:getConfig'),
  setCatalogUrl: (url) => ipcRenderer.invoke('catalog:setUrl', url),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  manage: {
    requestOtp: (email) => ipcRenderer.invoke('manage:requestOtp', email),
    verifyOtp: (email, otp) => ipcRenderer.invoke('manage:verifyOtp', email, otp),
    status: () => ipcRenderer.invoke('manage:status'),
    logout: () => ipcRenderer.invoke('manage:logout'),
    list: () => ipcRenderer.invoke('manage:list'),
    create: (entry) => ipcRenderer.invoke('manage:create', entry),
    update: (id, entry) => ipcRenderer.invoke('manage:update', id, entry),
    delete: (id) => ipcRenderer.invoke('manage:delete', id),
  },
});
