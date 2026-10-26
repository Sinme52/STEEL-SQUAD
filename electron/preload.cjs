const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  quit: () => ipcRenderer.send('quit'),
  setFullscreen: (on) => ipcRenderer.send('set-fullscreen', on),
  achievement: (id) => ipcRenderer.send('achievement', id),
});
