const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const { codedError, validateCredential, validateCredentialOptions, validateProfileId, validateProfileInput } = require('./ipc-validation')

class CredentialStore {
  constructor({ safeStorage, userDataPath, platform = process.platform, fsApi = fs }) {
    this.safeStorage = safeStorage
    this.userDataPath = userDataPath
    this.platform = platform
    this.fs = fsApi
    this.profileFile = path.join(userDataPath, 'provider-profiles-v1.json')
    this.credentialFile = path.join(userDataPath, 'provider-credentials-v1.json')
    this.profiles = new Map()
    this.encryptedCredentials = new Map()
    this.sessionCredentials = new Map()
    this.initialized = false
  }

  async initialize() {
    if (this.initialized) return
    await this.fs.mkdir(this.userDataPath, { recursive: true, mode: 0o700 })
    const [profiles, credentials] = await Promise.all([
      this.#readRecords(this.profileFile),
      this.#readRecords(this.credentialFile)
    ])
    for (const profile of profiles) {
      try {
        const normalized = validateProfileInput(profile)
        const id = validateProfileId(profile.id)
        this.profiles.set(id, { id, ...normalized })
      } catch {}
    }
    for (const record of credentials) {
      if (!record || typeof record !== 'object') continue
      try {
        const id = validateProfileId(record.id)
        const encrypted = String(record.encrypted || '')
        if (encrypted && /^[a-z0-9+/]+={0,2}$/i.test(encrypted)) this.encryptedCredentials.set(id, encrypted)
      } catch {}
    }
    this.initialized = true
  }

  async #readRecords(file) {
    try {
      const value = JSON.parse(await this.fs.readFile(file, 'utf8'))
      return Array.isArray(value) ? value : []
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async #atomicWrite(file, records) {
    const temporary = `${file}.tmp`
    await this.fs.writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
    await this.fs.rename(temporary, file)
  }

  storageStatus() {
    const available = this.safeStorage.isEncryptionAvailable() === true
    let backend = this.platform === 'linux' ? 'unknown' : 'os'
    if (this.platform === 'linux' && typeof this.safeStorage.getSelectedStorageBackend === 'function') {
      try {
        backend = String(this.safeStorage.getSelectedStorageBackend() || 'unknown')
      } catch {
        backend = 'unknown'
      }
    }
    const secure = available && backend !== 'basic_text'
    return {
      available,
      backend,
      secure,
      persistentAllowed: secure
    }
  }

  async createProfile(input) {
    await this.initialize()
    const normalized = validateProfileInput(input)
    const id = `native-${crypto.randomUUID()}`
    this.profiles.set(id, { id, ...normalized })
    await this.#persistProfiles()
    return this.#snapshot(this.profiles.get(id))
  }

  async listProfiles() {
    await this.initialize()
    return [...this.profiles.values()].map(profile => this.#snapshot(profile))
  }

  async replaceCredential(profileId, rawCredential, rawOptions = {}) {
    await this.initialize()
    const id = validateProfileId(profileId)
    if (!this.profiles.has(id)) throw codedError('profile_unavailable', 'Provider profile is unavailable')
    const credential = validateCredential(rawCredential)
    const options = validateCredentialOptions(rawOptions)
    if (options.persist) {
      const status = this.storageStatus()
      if (!status.persistentAllowed) {
        throw codedError('insecure_storage', `Secure credential storage is unavailable (${status.backend})`)
      }
      const encrypted = this.safeStorage.encryptString(credential).toString('base64')
      this.encryptedCredentials.set(id, encrypted)
      this.sessionCredentials.delete(id)
      await this.#persistCredentials()
    } else {
      this.sessionCredentials.set(id, credential)
      this.encryptedCredentials.delete(id)
      await this.#persistCredentials()
    }
    return this.#snapshot(this.profiles.get(id))
  }

  async forgetCredential(profileId) {
    await this.initialize()
    const id = validateProfileId(profileId)
    if (!this.profiles.has(id)) throw codedError('profile_unavailable', 'Provider profile is unavailable')
    this.sessionCredentials.delete(id)
    this.encryptedCredentials.delete(id)
    await this.#persistCredentials()
    return this.#snapshot(this.profiles.get(id))
  }

  async resolveForBroker(profileId) {
    await this.initialize()
    const id = validateProfileId(profileId)
    const profile = this.profiles.get(id)
    if (!profile) throw codedError('profile_unavailable', 'Provider profile is unavailable')
    if (this.sessionCredentials.has(id)) {
      return { profile: { ...profile }, credential: this.sessionCredentials.get(id) }
    }
    const encrypted = this.encryptedCredentials.get(id)
    if (!encrypted) return { profile: { ...profile }, credential: '' }
    if (!this.storageStatus().secure) throw codedError('insecure_storage', 'Secure credential backend is unavailable')
    try {
      return {
        profile: { ...profile },
        credential: this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      }
    } catch {
      throw codedError('credential_unavailable', 'Stored provider credential could not be decrypted')
    }
  }

  clearSession() {
    this.sessionCredentials.clear()
  }

  #snapshot(profile) {
    const status = this.storageStatus()
    return {
      id: profile.id,
      name: profile.name,
      endpoint: profile.endpoint,
      model: profile.model,
      protocol: profile.protocol,
      timeoutMs: profile.timeoutMs,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      temperature: profile.temperature,
      organization: profile.organization,
      project: profile.project,
      credentialPresent: this.sessionCredentials.has(profile.id) || this.encryptedCredentials.has(profile.id),
      secureStorage: this.encryptedCredentials.has(profile.id) && status.secure,
      storageBackend: status.backend
    }
  }

  #persistProfiles() {
    return this.#atomicWrite(this.profileFile, [...this.profiles.values()])
  }

  #persistCredentials() {
    return this.#atomicWrite(this.credentialFile, [...this.encryptedCredentials.entries()].map(([id, encrypted]) => ({ id, encrypted })))
  }
}

module.exports = { CredentialStore }
