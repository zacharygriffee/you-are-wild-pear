const crypto = require('node:crypto')
const path = require('node:path')

const {
  publicError,
  validateCredential,
  validateCredentialOptions,
  validateProfileId,
  validateSender
} = require('./ipc-validation')

const CONTEXT_CHANNEL = 'yaw:credential-window:context'
const SUBMIT_CHANNEL = 'yaw:credential-window:submit'
const CANCEL_CHANNEL = 'yaw:credential-window:cancel'
const CHANNELS = [CONTEXT_CHANNEL, SUBMIT_CHANNEL, CANCEL_CHANNEL]

class CredentialWindow {
  constructor({
    BrowserWindow,
    ipcMain,
    credentialStore,
    rendererFile = path.join(__dirname, '..', 'trusted', 'credential-entry.html'),
    preloadFile = path.join(__dirname, 'credential-preload.js')
  }) {
    this.BrowserWindow = BrowserWindow
    this.ipcMain = ipcMain
    this.credentialStore = credentialStore
    this.rendererFile = rendererFile
    this.preloadFile = preloadFile
    this.window = null
    this.pending = null
    this.#register()
  }

  #register() {
    this.ipcMain.handle(CONTEXT_CHANNEL, async event => {
      try {
        this.#validateTrustedSender(event)
        return {
          ok: true,
          profile: { ...this.pending.profile },
          storage: this.credentialStore.storageStatus()
        }
      } catch (error) {
        return { ok: false, error: publicError(error) }
      }
    })
    this.ipcMain.handle(SUBMIT_CHANNEL, async (event, credential, options) => {
      try {
        this.#validateTrustedSender(event)
        const profile = await this.credentialStore.replaceCredential(
          this.pending.profileId,
          validateCredential(credential),
          validateCredentialOptions(options)
        )
        const result = { ok: true, canceled: false, profile }
        this.#settle(result)
        setImmediate(() => this.close())
        return result
      } catch (error) {
        return { ok: false, error: publicError(error) }
      }
    })
    this.ipcMain.handle(CANCEL_CHANNEL, async event => {
      try {
        this.#validateTrustedSender(event)
        const result = { ok: true, canceled: true }
        this.#settle(result)
        setImmediate(() => this.close())
        return result
      } catch (error) {
        return { ok: false, error: publicError(error) }
      }
    })
  }

  #validateTrustedSender(event) {
    validateSender(event, this.rendererFile)
    if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents) {
      const error = new Error('Credential IPC sender is not the active trusted window')
      error.code = 'invalid_sender'
      throw error
    }
    return true
  }

  #settle(result) {
    if (!this.pending || this.pending.settled) return false
    this.pending.settled = true
    this.pending.resolve(result)
    return true
  }

  async open(parent, rawProfileId) {
    if (this.window && !this.window.isDestroyed()) {
      const error = new Error('Credential configuration is already open')
      error.code = 'credential_window_busy'
      throw error
    }
    const profileId = validateProfileId(rawProfileId)
    const profiles = await this.credentialStore.listProfiles()
    const profile = profiles.find(candidate => candidate.id === profileId)
    if (!profile) {
      const error = new Error('Provider profile is unavailable')
      error.code = 'profile_unavailable'
      throw error
    }

    const result = new Promise(resolve => {
      this.pending = {
        profileId,
        profile: {
          name: profile.name,
          endpoint: profile.endpoint,
          model: profile.model,
          credentialPresent: profile.credentialPresent === true
        },
        resolve,
        settled: false
      }
    })

    const window = new this.BrowserWindow({
      parent,
      modal: Boolean(parent),
      show: false,
      width: 520,
      height: 480,
      minWidth: 460,
      minHeight: 430,
      maxWidth: 640,
      maxHeight: 620,
      resizable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      backgroundColor: '#101513',
      title: 'Provider Credential — You Are Wild',
      webPreferences: {
        preload: this.preloadFile,
        partition: `yaw-trusted-credential-${crypto.randomUUID()}`,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        webviewTag: false
      }
    })
    this.window = window
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, target) => {
      let allowed = false
      try {
        allowed = path.resolve(require('node:url').fileURLToPath(target)) === path.resolve(this.rendererFile)
      } catch {}
      if (!allowed) event.preventDefault()
    })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.on('closed', () => {
      this.#settle({ ok: true, canceled: true })
      this.window = null
      this.pending = null
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })

    try {
      await window.loadFile(this.rendererFile)
    } catch (error) {
      this.#settle({ ok: false, error: publicError(error) })
      this.close()
      throw error
    }
    return result
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  destroy() {
    this.close()
    this.#settle({ ok: true, canceled: true })
    this.pending = null
    for (const channel of CHANNELS) this.ipcMain.removeHandler(channel)
  }
}

module.exports = {
  CANCEL_CHANNEL,
  CHANNELS,
  CONTEXT_CHANNEL,
  CredentialWindow,
  SUBMIT_CHANNEL
}
