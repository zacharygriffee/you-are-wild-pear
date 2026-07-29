const path = require('path')
const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron')

const { CredentialStore } = require('./credentials')
const { CredentialWindow } = require('./credential-window')
const { createFileService } = require('./files')
const {
  publicError,
  validateProfileId,
  validateProfileInput,
  validateProviderRequest,
  validateSender
} = require('./ipc-validation')
const { ProviderBroker } = require('./provider-broker')
const { WorkerStatus } = require('./worker-status')

const rendererFile = path.join(__dirname, '..', 'renderer', 'vendor', 'yaw', 'index.html')
let mainWindow = null
let credentials = null
let credentialWindow = null
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
      'files.export_save': true,
      'files.import_save': true,
      'providers.session_transport': true,
      'providers.secure_transport': true,
      'providers.persistent_credentials': secure.persistentAllowed,
      'distribution.read_status': true
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
    workerStatus = new WorkerStatus({
      storagePath: path.join(app.getPath('userData'), 'pear')
    })
    registerIpc()
    await workerStatus.start()
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
    credentialWindow?.destroy()
    credentials?.clearSession()
    workerStatus?.stop()
  })
}
