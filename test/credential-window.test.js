const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const {
  CONTEXT_CHANNEL,
  CredentialWindow,
  SUBMIT_CHANNEL
} = require('../electron/credential-window')

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.destroyed = false
    this.webContents = new EventEmitter()
    this.webContents.session = {
      setPermissionRequestHandler: handler => { this.permissionRequestHandler = handler },
      setPermissionCheckHandler: handler => { this.permissionCheckHandler = handler }
    }
    this.webContents.setWindowOpenHandler = handler => { this.windowOpenHandler = handler }
    this.webContents.mainFrame = null
  }

  async loadFile(file) {
    this.loadedFile = file
    this.webContents.mainFrame = { url: pathToFileURL(file).href }
    this.emit('ready-to-show')
  }

  show() {
    this.shown = true
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('closed')
  }

  isDestroyed() {
    return this.destroyed
  }
}

function eventFor(window) {
  return {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame
  }
}

test('trusted credential window binds the secret submission to its own sender and hidden profile ID', async () => {
  const handlers = new Map()
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: channel => handlers.delete(channel)
  }
  const replacements = []
  const credentialStore = {
    storageStatus: () => ({ available: true, backend: 'kwallet5', secure: true, persistentAllowed: true }),
    listProfiles: async () => [{
      id: 'native-profile',
      name: 'Trusted test',
      endpoint: 'https://api.example.test/v1',
      model: 'test-model',
      credentialPresent: false
    }],
    replaceCredential: async (profileId, credential, options) => {
      replacements.push({ profileId, credential, options })
      return { id: profileId, credentialPresent: true, secureStorage: true }
    }
  }
  const service = new CredentialWindow({
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    credentialStore
  })
  const openResult = service.open(null, 'native-profile')
  await new Promise(resolve => setImmediate(resolve))
  const window = service.window
  assert(window)
  assert.equal(window.options.webPreferences.partition.startsWith('yaw-trusted-credential-'), true)
  assert.equal(window.options.webPreferences.devTools, false)

  const context = await handlers.get(CONTEXT_CHANNEL)(eventFor(window))
  assert.equal(context.ok, true)
  assert.equal(context.profile.name, 'Trusted test')
  assert.equal(Object.hasOwn(context.profile, 'id'), false)

  const rejected = await handlers.get(SUBMIT_CHANNEL)({
    sender: new EventEmitter(),
    senderFrame: { url: pathToFileURL(path.join(__dirname, 'fixtures', 'credential-boundary-renderer.html')).href }
  }, 'should-not-land', { persist: true })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'invalid_sender')
  assert.equal(replacements.length, 0)

  const submitted = await handlers.get(SUBMIT_CHANNEL)(eventFor(window), 'trusted-secret', { persist: true })
  assert.equal(submitted.ok, true)
  assert.deepEqual(replacements, [{
    profileId: 'native-profile',
    credential: 'trusted-secret',
    options: { persist: true }
  }])
  assert.equal((await openResult).ok, true)
  service.destroy()
})
