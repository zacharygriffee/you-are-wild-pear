const path = require('path')
const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron')

const { CredentialStore } = require('./credentials')
const { CredentialWindow } = require('./credential-window')
const { DistributionPreferences } = require('./distribution-preferences')
const { createFileService } = require('./files')
const { HostSettingsWindow } = require('./host-settings-window')
const {
  publicError,
  validateProfileId,
  validateProfileInput,
  validateProviderRequest,
  validateSender
} = require('./ipc-validation')
const { ProviderBroker } = require('./provider-broker')
const { WorkerStatus } = require('./worker-status')
const packageJson = require('../package.json')

const rendererFile = path.join(__dirname, '..', 'renderer', 'vendor', 'yaw', 'index.html')
let mainWindow = null
let credentials = null
let credentialWindow = null
let distributionPreferences = null
let hostSettingsWindow = null
let workerStatus = null

function hostCapabilities() {
  const secure = credentials.storageStatus()
  return {
    schema: 'yaw-host-capabilities-v1',
    hostId: 'pear-electron',
    kind: 'native',
    native: true,
    origin: 'app',
    capabilities: {
      'app.host_settings': true,
      'files.export_save': true,
      'files.import_save': true,
      'providers.session_transport': true,
      'providers.secure_transport': true,
      'providers.persistent_credentials': secure.persistentAllowed,
      'distribution.read_status': true,
      'distribution.peer_availability': true
    },
    credentialStorage: secure
  }
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      validateSender(event, rendererFile)
      return await handler(...args)
    } catch (error) {
      return { ok: false, error: publicError(error) }
    }
  })
}

function registerIpc() {
  const files = createFileService({ dialog })
  const broker = new ProviderBroker({ credentialStore: credentials })
  registerHandler('yaw:capabilities', async () => hostCapabilities())
  registerHandler('yaw:app:open-settings', async () => hostSettingsWindow.open(mainWindow))
  registerHandler('yaw:app:platform', async () => ({
    ok: true,
    hostId: 'pear-electron',
    platform: process.platform,
    architecture: process.arch,
    appVersion: app.getVersion()
  }))
  registerHandler('yaw:distribution:status', async () => ({ ok: true, ...workerStatus.status() }))
  registerHandler('yaw:files:export-save', options => files.exportSave(mainWindow, options))
  registerHandler('yaw:files:import-save', () => files.importSave(mainWindow))
  registerHandler('yaw:providers:list-profiles', async () => ({ ok: true, profiles: await credentials.listProfiles() }))
  registerHandler('yaw:providers:create-profile', async input => ({
    ok: true,
    profile: await credentials.createProfile(validateProfileInput(input))
  }))
  registerHandler('yaw:providers:update-profile', async (profileId, input) => ({
    ok: true,
    ...await credentials.updateProfile(validateProfileId(profileId), validateProfileInput(input))
  }))
  registerHandler('yaw:providers:remove-profile', async profileId => ({
    ok: true,
    ...await credentials.removeProfile(validateProfileId(profileId))
  }))
  registerHandler('yaw:providers:configure-credential', profileId => (
    credentialWindow.open(mainWindow, validateProfileId(profileId))
  ))
  registerHandler('yaw:providers:forget-credential', async profileId => ({
    ok: true,
    profile: await credentials.forgetCredential(validateProfileId(profileId))
  }))
  registerHandler('yaw:providers:test', async profileId => ({
    ok: true,
    test: await broker.test(validateProfileId(profileId))
  }))
  registerHandler('yaw:providers:generate', async (profileId, request) => ({
    ok: true,
    result: await broker.generate(validateProfileId(profileId), validateProviderRequest(request))
  }))
}

function getAppPath() {
  if (!app.isPackaged) return ''
  if (process.platform === 'linux' && process.env.APPIMAGE) return process.env.APPIMAGE
  if (process.platform === 'win32') return process.execPath
  if (process.platform === 'darwin') return path.join(process.resourcesPath, '..', '..')
  return process.execPath
}

function getPackagedAppName() {
  const name = packageJson.productName || packageJson.name
  if (process.platform === 'linux') return `${name}.AppImage`
  if (process.platform === 'win32') return `${name}.msix`
  if (process.platform === 'darwin') return `${name}.app`
  return name
}

function relaunchAfterUpdate() {
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv.slice(1).filter(argument => argument !== '--appimage-extract-and-run')
      ]
    })
  } else if (process.platform !== 'win32') {
    app.relaunch()
  }
  app.quit()
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    let allowed = false
    try {
      allowed = path.resolve(require('url').fileURLToPath(target)) === path.resolve(rendererFile)
    } catch {}
    if (!allowed) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#101513',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  hardenWindow(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  await mainWindow.loadFile(rendererFile)
}

const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    credentials = new CredentialStore({
      safeStorage,
      userDataPath: path.join(app.getPath('userData'), 'host-secrets')
    })
    await credentials.initialize()
    credentialWindow = new CredentialWindow({
      BrowserWindow,
      ipcMain,
      credentialStore: credentials
    })
    distributionPreferences = new DistributionPreferences({
      directory: path.join(app.getPath('userData'), 'pear')
    })
    const preferences = await distributionPreferences.initialize()
    workerStatus = new WorkerStatus({
      storagePath: path.join(app.getPath('userData'), 'pear'),
      version: packageJson.version,
      upgrade: packageJson.upgrade,
      name: getPackagedAppName(),
      appPath: getAppPath(),
      updatesEnabled: preferences.updatesEnabled && !process.argv.includes('--no-updates'),
      peerAvailabilityEnabled: preferences.peerAvailabilityEnabled
    })
    await workerStatus.start()
    hostSettingsWindow = new HostSettingsWindow({
      BrowserWindow,
      ipcMain,
      preferences: distributionPreferences,
      workerStatus,
      appInfo: {
        version: packageJson.version,
        platform: process.platform,
        architecture: process.arch,
        packaged: app.isPackaged,
        releaseLineConfigured: /^pear:\/\/[a-z0-9]+$/i.test(String(packageJson.upgrade || ''))
      },
      afterUpdate: relaunchAfterUpdate
    })
    registerIpc()
    await createWindow()
  }).catch(error => {
    console.error('You Are Wild native host failed to start:', publicError(error).message)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => app.quit())
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    hostSettingsWindow?.destroy()
    credentialWindow?.destroy()
    credentials?.clearSession()
    workerStatus?.stop()
  })
}
