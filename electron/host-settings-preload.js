const { contextBridge, ipcRenderer } = require('electron')

const api = Object.freeze({
  context: () => ipcRenderer.invoke('yaw:host-settings:context'),
  setUpdatesEnabled: enabled => ipcRenderer.invoke('yaw:host-settings:set-updates', enabled),
  setPeerAvailabilityEnabled: enabled => ipcRenderer.invoke('yaw:host-settings:set-peer-availability', enabled),
  refresh: () => ipcRenderer.invoke('yaw:host-settings:refresh'),
  applyUpdate: () => ipcRenderer.invoke('yaw:host-settings:apply-update'),
  close: () => ipcRenderer.invoke('yaw:host-settings:close')
})

contextBridge.exposeInMainWorld('yawDesktopSettings', api)
