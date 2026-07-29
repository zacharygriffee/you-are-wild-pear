const crypto = require('node:crypto')
const path = require('node:path')

const { publicError, validateSender } = require('./ipc-validation')

const CHANNELS = Object.freeze({
  context: 'yaw:host-settings:context',
  setUpdates: 'yaw:host-settings:set-updates',
  setPeerAvailability: 'yaw:host-settings:set-peer-availability',
  refresh: 'yaw:host-settings:refresh',
  applyUpdate: 'yaw:host-settings:apply-update',
  close: 'yaw:host-settings:close'
})

class HostSettingsWindow {
  constructor({
    BrowserWindow,
    ipcMain,
    preferences,
    workerStatus,
    appInfo,
    afterUpdate,
    rendererFile = path.join(__dirname, '..', 'trusted', 'host-settings.html'),
    preloadFile = path.join(__dirname, 'host-settings-preload.js')
  }) {
    this.BrowserWindow = BrowserWindow
    this.ipcMain = ipcMain
    this.preferences = preferences
    this.workerStatus = workerStatus
    this.appInfo = appInfo
    this.afterUpdate = afterUpdate
    this.rendererFile = rendererFile
    this.preloadFile = preloadFile
    this.window = null
    this.#register()
  }

  #register() {
    this.ipcMain.handle(CHANNELS.context, event => this.#handle(event, () => this.#context()))
    this.ipcMain.handle(CHANNELS.refresh, event => this.#handle(event, async () => {
      await this.workerStatus.refresh()
      return this.#context()
    }))
    this.ipcMain.handle(CHANNELS.setUpdates, (event, enabled) => this.#handle(event, async () => {
      if (typeof enabled !== 'boolean') throw this.#invalid('Update preference must be a boolean')
      const preferences = await this.preferences.setUpdatesEnabled(enabled)
      this.workerStatus.setUpdatesPreference(preferences.updatesEnabled)
      return this.#context()
    }))
    this.ipcMain.handle(CHANNELS.setPeerAvailability, (event, enabled) => this.#handle(event, async () => {
      if (typeof enabled !== 'boolean') throw this.#invalid('Peer availability preference must be a boolean')
      await this.workerStatus.setPeerAvailability(enabled)
      await this.preferences.setPeerAvailabilityEnabled(enabled)
      return this.#context()
    }))
    this.ipcMain.handle(CHANNELS.applyUpdate, event => this.#handle(event, async () => {
      const result = await this.workerStatus.applyUpdate()
      if (result?.applied) setImmediate(() => this.afterUpdate())
      return { ok: true, applied: result?.applied === true }
    }))
    this.ipcMain.handle(CHANNELS.close, event => this.#handle(event, () => {
      setImmediate(() => this.close())
      return { ok: true }
    }))
  }

  async #handle(event, operation) {
    try {
      this.#validateTrustedSender(event)
      const result = await operation()
      return result?.ok === true ? result : { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: publicError(error) }
    }
  }

  #context() {
    return {
      app: { ...this.appInfo },
      preferences: this.preferences.snapshot(),
      runtime: this.workerStatus.status()
    }
  }

  #validateTrustedSender(event) {
    validateSender(event, this.rendererFile)
    if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents) {
      const error = new Error('Host settings IPC sender is not the active trusted window')
      error.code = 'invalid_sender'
      throw error
    }
    return true
  }

  #invalid(message) {
    const error = new Error(message)
    error.code = 'invalid_request'
    return error
  }

  async open(parent) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus()
      return { ok: true, alreadyOpen: true }
    }
    const window = new this.BrowserWindow({
      parent,
      modal: Boolean(parent),
      show: false,
      width: 620,
      height: 760,
      minWidth: 520,
      minHeight: 620,
      maxWidth: 760,
      maxHeight: 920,
      resizable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      backgroundColor: '#101513',
      title: 'Pear Desktop Settings — You Are Wild',
      webPreferences: {
        preload: this.preloadFile,
        partition: `yaw-trusted-host-settings-${crypto.randomUUID()}`,
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
      this.window = null
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    try {
      await window.loadFile(this.rendererFile)
      return { ok: true, alreadyOpen: false }
    } catch (error) {
      this.close()
      throw error
    }
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  destroy() {
    this.close()
    for (const channel of Object.values(CHANNELS)) this.ipcMain.removeHandler(channel)
  }
}

module.exports = { CHANNELS, HostSettingsWindow }
