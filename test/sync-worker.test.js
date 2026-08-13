const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { WorkerStatus } = require('../electron/worker-status')

const root = path.resolve(__dirname, '..')
const packageJson = require('../package.json')

test('desktop package metadata satisfies the Pear distributable checklist', () => {
  for (const field of ['name', 'productName', 'description', 'author', 'license']) {
    assert.equal(typeof packageJson[field], 'string')
    assert.notEqual(packageJson[field].trim(), '')
  }
})

test('Pear distribution uses a real stage release line without pretending to have production multisig', () => {
  assert.match(packageJson.upgrade, /^pear:\/\/[a-z0-9]+$/)
  assert.equal(fs.existsSync(path.join(root, 'pear.json')), false)
})

test('pinned YAW renderer manifest verifies', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-yaw.js'], { cwd: root, encoding: 'utf8' })
  assert.match(output, /Verified You Are Wild 0\.19\.0 renderer/)
})

test('Pear worker startup reports configured OTA and consent-aware peer availability', async () => {
  const fake = new EventEmitter()
  fake.stderr = new EventEmitter()
  fake.destroy = () => {}
  const worker = new WorkerStatus({
    storagePath: '/tmp/yaw-worker-test',
    version: packageJson.version,
    upgrade: packageJson.upgrade,
    name: 'You Are Wild.AppImage',
    appPath: '/tmp/You Are Wild.AppImage',
    frame: stream => stream,
    run(specifier, args) {
      assert.equal(specifier, path.join(root, 'workers', 'main.js'))
      assert.deepEqual(args, [
        'true',
        packageJson.version,
        packageJson.upgrade,
        'You Are Wild.AppImage',
        '/tmp/yaw-worker-test',
        '/tmp/You Are Wild.AppImage',
        'false'
      ])
      queueMicrotask(() => fake.emit('data', Buffer.from(JSON.stringify({
        type: 'yaw:worker-status',
        reason: 'ready',
        available: true,
        bareVersion: 'test-bare',
        distribution: {
          configured: true,
          appVersion: packageJson.version,
          updatesEnabled: true,
          peerAvailabilityEnabled: false,
          peers: 0,
          phase: 'ready',
          updateReady: false
        }
      }))))
      return fake
    }
  })
  const status = await worker.start()
  assert.equal(status.available, true)
  assert.equal(status.runtime, 'pear')
  assert.equal(status.bareVersion, 'test-bare')
  assert.equal(status.distribution.mode, 'pear-ota')
  assert.equal(status.distribution.configured, true)
  assert.equal(status.distribution.peerAvailabilityEnabled, false)
  assert.equal(status.distribution.peers, 0)
  worker.stop()
})

test('Forge keeps and prunes the native prebuilds required by Pear Runtime', () => {
  const forge = require('../forge.config')
  assert.deepEqual(forge.plugins.map(plugin => plugin.name), [
    'electron-forge-plugin-universal-prebuilds',
    'electron-forge-plugin-prune-prebuilds'
  ])
  assert.equal(forge.packagerConfig.executableName, undefined)
  assert.equal(packageJson.dependencies['framed-stream'], '1.0.1')
  assert.equal(packageJson.dependencies.corestore, '7.12.0')
  assert.equal(packageJson.dependencies.hyperswarm, '4.17.0')
  assert.equal(packageJson.dependencies['pear-runtime'], '1.3.1')
})
