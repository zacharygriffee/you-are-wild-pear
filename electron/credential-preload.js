const { contextBridge, ipcRenderer } = require('electron')

const api = Object.freeze({
  context: () => ipcRenderer.invoke('yaw:credential-window:context'),
  submit: (credential, options) => ipcRenderer.invoke('yaw:credential-window:submit', credential, options),
  cancel: () => ipcRenderer.invoke('yaw:credential-window:cancel')
})

contextBridge.exposeInMainWorld('yawCredential', api)
