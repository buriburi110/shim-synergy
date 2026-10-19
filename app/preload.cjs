const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['state:get','settings:save','pair:open','pair:discover','pair:connect','pair:respond','engine:start','engine:stop','peer:forget','address:update','clipboard:copy','system:settings','logs:open']);
contextBridge.exposeInMainWorld('synergy', {
  invoke: (channel, ...args) => { if (!allowed.has(channel)) throw new Error('지원하지 않는 작업입니다.'); return ipcRenderer.invoke(channel, ...args); },
  onState: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); }
});
