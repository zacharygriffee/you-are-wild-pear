const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { CredentialStore } = require('../electron/credentials')

function safeStorage(backend = 'kwallet6') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptString: value => Buffer.from(String(value).replace(/^encrypted:/, ''), 'base64').toString()
  }
}

function profile() {
  return {
    name: 'Test provider',
    endpoint: 'https://api.example.test/v1',
    model: 'test-model',
    protocol: 'responses',
    timeoutMs: 5000,
    maxCompletionTokens: 1024,
    reasoningEffort: 'provider',
    temperature: null,
    organization: '',
    project: ''
  }
}

test('credential store persists only encrypted material and returns redacted snapshots', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaw-credentials-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new CredentialStore({
    safeStorage: safeStorage(),
    userDataPath: directory,
    platform: 'linux'
  })
  const created = await store.createProfile(profile())
  const secret = 'sk-test-secret-value'
  const snapshot = await store.replaceCredential(created.id, secret, { persist: true })
  assert.equal(snapshot.credentialPresent, true)
  assert.equal(snapshot.secureStorage, true)
  assert.equal(JSON.stringify(snapshot).includes(secret), false)
  assert.equal(JSON.stringify(await store.listProfiles()).includes(secret), false)
  const credentialFile = await fs.readFile(path.join(directory, 'provider-credentials-v1.json'), 'utf8')
  const profileFile = await fs.readFile(path.join(directory, 'provider-profiles-v1.json'), 'utf8')
  assert.equal(credentialFile.includes(secret), false)
  assert.equal(profileFile.includes(secret), false)
  const brokerRecord = await store.resolveForBroker(created.id)
  assert.equal(brokerRecord.credential, secret)

  const restartedStore = new CredentialStore({
    safeStorage: safeStorage(),
    userDataPath: directory,
    platform: 'linux'
  })
  await restartedStore.initialize()
  assert.equal(JSON.stringify(await restartedStore.listProfiles()).includes(secret), false)
  assert.equal((await restartedStore.resolveForBroker(created.id)).credential, secret)

  await store.forgetCredential(created.id)
  assert.equal((await store.listProfiles())[0].credentialPresent, false)
})

test('Linux basic_text fallback rejects persistent credentials but allows explicit session use', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaw-basic-text-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new CredentialStore({
    safeStorage: safeStorage('basic_text'),
    userDataPath: directory,
    platform: 'linux'
  })
  const created = await store.createProfile(profile())
  await assert.rejects(
    () => store.replaceCredential(created.id, 'session-secret', { persist: true }),
    error => error.code === 'insecure_storage'
  )
  const session = await store.replaceCredential(created.id, 'session-secret', { persist: false })
  assert.equal(session.credentialPresent, true)
  assert.equal(session.secureStorage, false)
  assert.equal((await store.resolveForBroker(created.id)).credential, 'session-secret')
})

test('profile edits retain credentials except when endpoint changes, and removal deletes both records', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaw-profile-lifecycle-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new CredentialStore({
    safeStorage: safeStorage(),
    userDataPath: directory,
    platform: 'linux'
  })
  const created = await store.createProfile(profile())
  await store.replaceCredential(created.id, 'sk-lifecycle-secret', { persist: true })

  const modelUpdate = await store.updateProfile(created.id, {
    ...profile(),
    name: 'Renamed provider',
    model: 'new-model',
    protocol: 'chat'
  })
  assert.equal(modelUpdate.credentialInvalidated, false)
  assert.equal(modelUpdate.profile.model, 'new-model')
  assert.equal(modelUpdate.profile.protocol, 'chat')
  assert.equal((await store.resolveForBroker(created.id)).credential, 'sk-lifecycle-secret')

  const endpointUpdate = await store.updateProfile(created.id, {
    ...profile(),
    endpoint: 'https://other.example.test/v1',
    model: 'new-model'
  })
  assert.equal(endpointUpdate.credentialInvalidated, true)
  assert.equal(endpointUpdate.profile.credentialPresent, false)
  assert.equal((await store.resolveForBroker(created.id)).credential, '')
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'provider-credentials-v1.json'), 'utf8')).length,
    0
  )

  await store.replaceCredential(created.id, 'sk-replacement-secret', { persist: true })
  const removed = await store.removeProfile(created.id)
  assert.deepEqual(removed, { id: created.id, removed: true, credentialDeleted: true })
  assert.deepEqual(await store.listProfiles(), [])
  await assert.rejects(
    () => store.resolveForBroker(created.id),
    error => error.code === 'profile_unavailable'
  )
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'provider-profiles-v1.json'), 'utf8')).length,
    0
  )
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'provider-credentials-v1.json'), 'utf8')).length,
    0
  )
})
