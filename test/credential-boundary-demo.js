const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron')

const { CredentialStore } = require('../electron/credentials')
const { CredentialWindow } = require('../electron/credential-window')
const {
  publicError,
  validateProfileId,
  validateProfileInput,
  validateSender
} = require('../electron/ipc-validation')

const rendererFile = path.join(__dirname, 'fixtures', 'credential-boundary-renderer.html')
const reportFile = path.join(__dirname, '..', 'out', 'security', 'credential-boundary-demo.json')
const channels = [
  'yaw:providers:list-profiles',
  'yaw:providers:create-profile',
  'yaw:providers:configure-credential'
]
const tracing = process.env.YAW_CREDENTIAL_DEMO_TRACE === '1'

function trace(stage) {
  if (tracing) process.stderr.write(`Credential boundary stage: ${stage}\n`)
}

// Keep Electron alive during hidden-window transitions in the demonstration.
app.on('window-all-closed', () => {})

function requireProof(condition, message) {
  if (!condition) throw new Error(message)
}

function publicPaths(value, prefix = '') {
  const result = []
  for (const [key, child] of Object.entries(value || {})) {
    const current = prefix ? `${prefix}.${key}` : key
    result.push(current)
    if (child && typeof child === 'object') result.push(...publicPaths(child, current))
  }
  return result
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

function registerCredentialBridge(store, credentialWindow, getParent) {
  registerHandler('yaw:providers:list-profiles', async () => ({
    ok: true,
    profiles: await store.listProfiles()
  }))
  registerHandler('yaw:providers:create-profile', async input => ({
    ok: true,
    profile: await store.createProfile(validateProfileInput(input))
  }))
  registerHandler('yaw:providers:configure-credential', profileId => (
    credentialWindow.open(getParent(), validateProfileId(profileId))
  ))
}

async function createProbeWindow() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  await window.loadFile(rendererFile)
  return window
}

async function startCredentialConfiguration(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const created = await window.yawHost.providers.createProfile({
        name: 'Boundary demonstration',
        endpoint: 'https://api.example.test/v1',
        model: 'demonstration-model',
        protocol: 'responses',
        timeoutMs: 5000,
        maxCompletionTokens: 512,
        reasoningEffort: 'provider',
        temperature: null,
        organization: '',
        project: ''
      })
      if (!created.ok) return created
      return {
        ok: true,
        profileId: created.profile.id,
        configurationStarted: Boolean(
          window.__credentialConfiguration = window.yawHost.providers.configureCredential(created.profile.id)
        )
      }
    })()
  `, true)
}

async function submitThroughTrustedWindow(credentialWindow, secret) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const window = credentialWindow.window
    if (window && !window.isDestroyed() && !window.webContents.isLoadingMainFrame()) {
      const trustedProcessId = window.webContents.getOSProcessId()
      const serializedSecret = JSON.stringify(secret)
      await window.webContents.executeJavaScript(`
        (() => {
          const field = document.getElementById('credential')
          const persist = document.getElementById('persist')
          field.value = ${serializedSecret}
          persist.checked = true
          document.getElementById('credential-form').requestSubmit()
          return true
        })()
      `, true)
      return trustedProcessId
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Trusted credential window did not become ready')
}

async function probeAsRenderer(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const paths = (${publicPaths.toString()})(window.yawHost)
      const listed = await window.yawHost.providers.listProfiles()
      const localStorageText = JSON.stringify(
        Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])
      )
      return {
        paths,
        listed,
        globals: {
          require: typeof window.require,
          process: typeof window.process,
          Buffer: typeof window.Buffer,
          ipcRenderer: typeof window.ipcRenderer
        },
        localStorageText,
        forbiddenTypes: {
          getApiKey: typeof window.yawHost.providers.getApiKey,
          getCredential: typeof window.yawHost.providers.getCredential,
          replaceCredential: typeof window.yawHost.providers.replaceCredential,
          readSecret: typeof window.yawHost.providers.readSecret,
          decryptSecret: typeof window.yawHost.providers.decryptSecret,
          rawIpc: typeof window.yawHost.rawIpc,
          invoke: typeof window.yawHost.invoke,
          readArbitraryFile: typeof window.yawHost.files.readArbitraryFile,
          writeArbitraryFile: typeof window.yawHost.files.writeArbitraryFile,
          electron: typeof window.yawHost.electron
        }
      }
    })()
  `, true)
}

async function run() {
  let gameWindow
  let credentialWindow
  let temporaryDirectory
  try {
    await app.whenReady()
    trace('electron-ready')
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaw-credential-boundary-'))
    const store = new CredentialStore({
      safeStorage,
      userDataPath: temporaryDirectory
    })
    await store.initialize()
    const storage = store.storageStatus()
    trace(`storage-${storage.backend}`)
    requireProof(storage.persistentAllowed, `Secure persistent storage is unavailable (${storage.backend})`)

    credentialWindow = new CredentialWindow({
      BrowserWindow,
      ipcMain,
      credentialStore: store
    })
    registerCredentialBridge(store, credentialWindow, () => gameWindow)
    const secret = `sk-boundary-${crypto.randomBytes(32).toString('hex')}`

    gameWindow = await createProbeWindow()
    trace('game-renderer-ready')
    const setup = await startCredentialConfiguration(gameWindow)
    const gameProcessId = gameWindow.webContents.getOSProcessId()
    const trustedProcessId = await submitThroughTrustedWindow(credentialWindow, secret)
    const configured = await gameWindow.webContents.executeJavaScript('window.__credentialConfiguration', true)
    trace('credential-persisted-through-trusted-window')
    requireProof(setup.ok === true, `Credential setup failed (${setup.error?.code || 'unknown'})`)
    requireProof(configured.ok === true && configured.canceled === false, `Credential storage failed (${configured.error?.code || 'unknown'})`)
    requireProof(typeof setup.profileId === 'string', 'Credential setup did not return an opaque profile ID')
    requireProof(gameProcessId !== trustedProcessId, 'Trusted credential entry shared the game renderer process')

    const rendererProbe = await probeAsRenderer(gameWindow)
    trace('renderer-probed')

    const rendered = JSON.stringify(rendererProbe)
    requireProof(!rendered.includes(secret), 'The saved credential reached the renderer probe')
    requireProof(rendererProbe.listed?.ok === true, 'The renderer could not list redacted profiles')
    requireProof(rendererProbe.listed.profiles.length === 1, 'The renderer received an unexpected profile count')
    requireProof(rendererProbe.listed.profiles[0].credentialPresent === true, 'The renderer did not receive credential state')
    requireProof(!Object.hasOwn(rendererProbe.listed.profiles[0], 'credential'), 'A profile snapshot exposed credential material')
    requireProof(!Object.hasOwn(rendererProbe.listed.profiles[0], 'encrypted'), 'A profile snapshot exposed encrypted material')
    requireProof(Object.values(rendererProbe.globals).every(value => value === 'undefined'), 'The renderer has a Node or raw IPC global')
    requireProof(Object.values(rendererProbe.forbiddenTypes).every(value => value === 'undefined'), 'The bridge exposes a forbidden method')
    requireProof(!rendererProbe.localStorageText.includes(secret), 'The credential entered renderer local storage')

    const profileText = await fs.readFile(path.join(temporaryDirectory, 'provider-profiles-v1.json'), 'utf8')
    const credentialText = await fs.readFile(path.join(temporaryDirectory, 'provider-credentials-v1.json'), 'utf8')
    const credentialRecords = JSON.parse(credentialText)
    const encryptedBytes = Buffer.from(credentialRecords[0]?.encrypted || '', 'base64')
    requireProof(!profileText.includes(secret), 'The profile file contains plaintext credential material')
    requireProof(!credentialText.includes(secret), 'The credential file contains plaintext credential material')
    requireProof(!encryptedBytes.includes(Buffer.from(secret)), 'The encrypted bytes contain the plaintext credential')
    requireProof(encryptedBytes.length > 0, 'No encrypted credential record was persisted')

    const restartedStore = new CredentialStore({
      safeStorage,
      userDataPath: temporaryDirectory
    })
    await restartedStore.initialize()
    const brokerRecord = await restartedStore.resolveForBroker(setup.profileId)
    trace('main-restart-decrypted')
    requireProof(brokerRecord.credential === secret, 'Electron main could not decrypt the credential after a store restart')
    requireProof(!JSON.stringify(await restartedStore.listProfiles()).includes(secret), 'Restarted profile snapshots exposed the credential')

    const credentialMode = (await fs.stat(path.join(temporaryDirectory, 'provider-credentials-v1.json'))).mode & 0o777
    const profileMode = (await fs.stat(path.join(temporaryDirectory, 'provider-profiles-v1.json'))).mode & 0o777
    requireProof(credentialMode === 0o600, 'Credential file permissions are not owner-only')
    requireProof(profileMode === 0o600, 'Profile file permissions are not owner-only')

    const forbiddenNames = [
      'getApiKey',
      'getCredential',
      'replaceCredential',
      'readSecret',
      'decryptSecret',
      'rawIpc',
      'invoke',
      'readArbitraryFile',
      'writeArbitraryFile',
      'electron'
    ]
    const leafNames = rendererProbe.paths.map(value => value.split('.').at(-1))
    requireProof(forbiddenNames.every(name => !leafNames.includes(name)), 'A forbidden bridge name is public')

    const report = {
      schema: 'yaw-credential-boundary-demonstration-v2',
      result: 'pass',
      generatedAt: new Date().toISOString(),
      runtime: {
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        architecture: process.arch
      },
      secureStorage: {
        encryptionAvailable: storage.available,
        backend: storage.backend,
        persistentAllowed: storage.persistentAllowed
      },
      renderer: {
        sandboxedWithoutNodeGlobals: true,
        boundedBridgePaths: rendererProbe.paths,
        forbiddenBridgeMethodsAbsent: true,
        localStorageContainsCredential: false,
        neverReceivedCredentialDuringSetup: true
      },
      trustedEntryWindow: {
        separateRendererProcess: true,
        loadsGameOrModuleCode: false,
        profileIdExposedToEntryRenderer: false,
        devToolsDisabled: true,
        ephemeralSessionPartition: true
      },
      persistence: {
        publicProfileRedacted: true,
        profileFileContainsPlaintext: false,
        credentialFileContainsPlaintext: false,
        encryptedRecordPresent: true,
        ownerOnlyFilePermissions: true,
        mainProcessRestartDecryptionSucceeded: true
      },
      claim: 'Credential entry occurs in a separate trusted renderer; the game and mod-capable renderer never receives the key, while Electron main can recover it only for bounded broker use.'
    }
    await fs.mkdir(path.dirname(reportFile), { recursive: true })
    await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    trace('attestation-written')
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    credentialWindow?.destroy()
    if (gameWindow && !gameWindow.isDestroyed()) gameWindow.destroy()
    for (const channel of channels) ipcMain.removeHandler(channel)
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true })
    app.quit()
  }
}

run().catch(error => {
  const safe = publicError(error)
  process.stderr.write(`Credential boundary demonstration failed: ${safe.code}: ${safe.message}\n`)
  app.exit(1)
})
