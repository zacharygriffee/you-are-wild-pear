const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function loadBridge() {
  let exposed
  const calls = []
  const source = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8')
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, 'yawHost')
            exposed = api
          }
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            calls.push({ channel, args })
            return Promise.resolve({ ok: true })
          }
        }
      }
    },
    Object
  })
  return { exposed, calls }
}

function publicPaths(value, prefix = '') {
  const result = []
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key
    result.push(current)
    if (child && typeof child === 'object') result.push(...publicPaths(child, current))
  }
  return result
}

test('preload exposes only the approved bounded methods', async () => {
  const { exposed, calls } = loadBridge()
  assert.deepEqual(publicPaths(exposed), [
    'capabilities',
    'app',
    'app.openSettings',
    'app.platform',
    'distribution',
    'distribution.status',
    'files',
    'files.exportSave',
    'files.importSave',
    'providers',
    'providers.listProfiles',
    'providers.createProfile',
    'providers.updateProfile',
    'providers.removeProfile',
    'providers.configureCredential',
    'providers.forgetCredential',
    'providers.test',
    'providers.generate'
  ])
  const names = publicPaths(exposed).map(value => value.split('.').at(-1).toLowerCase())
  for (const forbidden of [
    'getapikey',
    'getcredential',
    'replacecredential',
    'readsecret',
    'decryptsecret',
    'rawipc',
    'invoke',
    'readarbitraryfile',
    'writearbitraryfile',
    'electron'
  ]) {
    assert.equal(names.includes(forbidden), false, `public bridge contains forbidden surface ${forbidden}`)
  }
  await exposed.providers.generate('native-profile', { capability: 'text.generate', request: { input: {} } })
  assert.equal(calls.at(-1).channel, 'yaw:providers:generate')
  await exposed.providers.updateProfile('native-profile', { name: 'Updated' })
  assert.equal(calls.at(-1).channel, 'yaw:providers:update-profile')
  await exposed.providers.removeProfile('native-profile')
  assert.equal(calls.at(-1).channel, 'yaw:providers:remove-profile')
  await exposed.app.openSettings()
  assert.equal(calls.at(-1).channel, 'yaw:app:open-settings')
  assert.equal(Object.isFrozen(exposed), true)
  assert.equal(Object.isFrozen(exposed.providers), true)
})

test('trusted credential preload exposes only its one-purpose methods', async () => {
  let exposed
  const calls = []
  const source = fs.readFileSync(path.join(root, 'electron', 'credential-preload.js'), 'utf8')
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, 'yawCredential')
            exposed = api
          }
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            calls.push({ channel, args })
            return Promise.resolve({ ok: true })
          }
        }
      }
    },
    Object
  })
  assert.deepEqual(publicPaths(exposed), ['context', 'submit', 'cancel'])
  await exposed.submit('transient-secret', { persist: true })
  assert.equal(calls.at(-1).channel, 'yaw:credential-window:submit')
  assert.equal(Object.isFrozen(exposed), true)
})

test('trusted Pear Desktop settings preload owns bounded distribution mutations', async () => {
  let exposed
  const calls = []
  const source = fs.readFileSync(path.join(root, 'electron', 'host-settings-preload.js'), 'utf8')
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, 'yawDesktopSettings')
            exposed = api
          }
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            calls.push({ channel, args })
            return Promise.resolve({ ok: true })
          }
        }
      }
    },
    Object
  })
  assert.deepEqual(publicPaths(exposed), [
    'context',
    'setUpdatesEnabled',
    'setPeerAvailabilityEnabled',
    'refresh',
    'applyUpdate',
    'close'
  ])
  await exposed.setPeerAvailabilityEnabled(true)
  assert.equal(calls.at(-1).channel, 'yaw:host-settings:set-peer-availability')
  assert.deepEqual(calls.at(-1).args, [true])
  assert.equal(Object.isFrozen(exposed), true)
})

test('Electron renderer configuration stays sandboxed without Node integration', () => {
  const source = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8')
  assert.match(source, /contextIsolation:\s*true/)
  assert.match(source, /sandbox:\s*true/)
  assert.match(source, /nodeIntegration:\s*false/)
  assert.match(source, /webSecurity:\s*true/)
  assert.match(source, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'/)
  assert.match(source, /will-navigate/)
  assert.match(source, /will-attach-webview/)
  const credentialSource = fs.readFileSync(path.join(root, 'electron', 'credential-window.js'), 'utf8')
  assert.match(credentialSource, /contextIsolation:\s*true/)
  assert.match(credentialSource, /sandbox:\s*true/)
  assert.match(credentialSource, /nodeIntegration:\s*false/)
  assert.match(credentialSource, /devTools:\s*false/)
  assert.match(credentialSource, /partition:\s*`yaw-trusted-credential-/)
  const settingsSource = fs.readFileSync(path.join(root, 'electron', 'host-settings-window.js'), 'utf8')
  assert.match(settingsSource, /contextIsolation:\s*true/)
  assert.match(settingsSource, /sandbox:\s*true/)
  assert.match(settingsSource, /nodeIntegration:\s*false/)
  assert.match(settingsSource, /devTools:\s*false/)
  assert.match(settingsSource, /partition:\s*`yaw-trusted-host-settings-/)
})
