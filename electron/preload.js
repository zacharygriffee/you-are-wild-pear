const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const api = {
  capabilities: () => invoke('yaw:capabilities'),
  app: {
    openSettings: () => invoke('yaw:app:open-settings'),
    platform: () => invoke('yaw:app:platform')
  },
  distribution: {
    status: () => invoke('yaw:distribution:status')
  },
  files: {
    exportSave: options => invoke('yaw:files:export-save', options),
    importSave: options => invoke('yaw:files:import-save', options)
  },
  providers: {
    listProfiles: () => invoke('yaw:providers:list-profiles'),
    createProfile: input => invoke('yaw:providers:create-profile', input),
    updateProfile: (profileId, input) => invoke('yaw:providers:update-profile', profileId, input),
    removeProfile: profileId => invoke('yaw:providers:remove-profile', profileId),
    configureCredential: profileId => invoke('yaw:providers:configure-credential', profileId),
    forgetCredential: profileId => invoke('yaw:providers:forget-credential', profileId),
    test: profileId => invoke('yaw:providers:test', profileId),
    generate: (profileId, request) => invoke('yaw:providers:generate', profileId, request)
  }
}

for (const section of ['app', 'distribution', 'files', 'providers']) Object.freeze(api[section])
contextBridge.exposeInMainWorld('yawHost', Object.freeze(api))
