const fs = require('node:fs/promises')
const path = require('node:path')

const DEFAULTS = Object.freeze({
  updatesEnabled: true,
  peerAvailabilityEnabled: false
})

class DistributionPreferences {
  constructor({ directory, fsApi = fs }) {
    this.fs = fsApi
    this.directory = directory
    this.file = path.join(directory, 'distribution-preferences-v1.json')
    this.values = { ...DEFAULTS }
    this.initialized = false
  }

  async initialize() {
    if (this.initialized) return this.snapshot()
    await this.fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.file, 'utf8'))
      this.values = this.#normalize(parsed)
    } catch (error) {
      if (error?.code !== 'ENOENT') this.values = { ...DEFAULTS }
    }
    this.initialized = true
    return this.snapshot()
  }

  snapshot() {
    return { ...this.values }
  }

  async setUpdatesEnabled(enabled) {
    await this.initialize()
    this.values.updatesEnabled = enabled === true
    await this.#persist()
    return this.snapshot()
  }

  async setPeerAvailabilityEnabled(enabled) {
    await this.initialize()
    this.values.peerAvailabilityEnabled = enabled === true
    await this.#persist()
    return this.snapshot()
  }

  #normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULTS }
    return {
      updatesEnabled: value.updatesEnabled !== false,
      peerAvailabilityEnabled: value.peerAvailabilityEnabled === true
    }
  }

  async #persist() {
    const temporary = `${this.file}.tmp`
    await this.fs.writeFile(temporary, `${JSON.stringify(this.values, null, 2)}\n`, { mode: 0o600 })
    await this.fs.rename(temporary, this.file)
  }
}

module.exports = { DEFAULTS, DistributionPreferences }
