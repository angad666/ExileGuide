'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guide', {
  // overlay
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  resize: (h) => ipcRenderer.send('overlay:resize', h),
  action: (name) => ipcRenderer.send('overlay:action', name),
  ready: () => ipcRenderer.send('overlay:ready'),
  copy: (text) => ipcRenderer.send('overlay:copy', text),
  // F3 search menu
  onMenu: (cb) => ipcRenderer.on('menu', (_e, m) => cb(m)),
  menuPick: (i) => ipcRenderer.send('menu:pick', i),
  menuClose: () => ipcRenderer.send('menu:close'),
  menuResize: (h) => ipcRenderer.send('menu:resize', h),
  // settings window
  get: () => ipcRenderer.invoke('settings:get'),
  gemNames: () => ipcRenderer.invoke('settings:gemNames'),
  quests: () => ipcRenderer.invoke('settings:quests'),
  areas: () => ipcRenderer.invoke('settings:areas'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  selectBuild: (file) => ipcRenderer.invoke('settings:selectBuild', file),
  previewBuild: (json) => ipcRenderer.invoke('settings:previewBuild', json),
  saveBuild: (file, json) => ipcRenderer.invoke('settings:saveBuild', { file, json }),
  deleteBuild: (file) => ipcRenderer.invoke('settings:deleteBuild', file),
  importPob: (input) => ipcRenderer.invoke('settings:importPob', input),
  jump: (i) => ipcRenderer.invoke('settings:jump', i),
  setLevel: (l) => ipcRenderer.invoke('settings:setLevel', l),
  reset: () => ipcRenderer.invoke('settings:reset'),
  timerReset: () => ipcRenderer.invoke('settings:timerReset'),
  browseLog: () => ipcRenderer.invoke('settings:browseLog'),
  openBuildsFolder: () => ipcRenderer.invoke('settings:openBuildsFolder'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onTab: (cb) => ipcRenderer.on('tab', (_e, t) => cb(t)),
});
