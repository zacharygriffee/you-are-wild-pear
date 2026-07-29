const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { DistributionPreferences } = require('../electron/distribution-preferences')

test('distribution preferences default to updates on and peer contribution off', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaw-distribution-preferences-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const preferences = new DistributionPreferences({ directory })
  assert.deepEqual(await preferences.initialize(), {
    updatesEnabled: true,
    peerAvailabilityEnabled: false
  })
  await preferences.setPeerAvailabilityEnabled(true)
  await preferences.setUpdatesEnabled(false)
  const restarted = new DistributionPreferences({ directory })
  assert.deepEqual(await restarted.initialize(), {
    updatesEnabled: false,
    peerAvailabilityEnabled: true
  })
  const mode = (await fs.stat(path.join(directory, 'distribution-preferences-v1.json'))).mode & 0o777
  assert.equal(mode, 0o600)
})

test('game preload cannot mutate update or peer-availability settings', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8')
  for (const forbidden of [
    'setUpdatesEnabled',
    'setPeerAvailabilityEnabled',
    'applyUpdate',
    'pear seed',
    'child_process'
  ]) {
    assert.equal(source.includes(forbidden), false, `game preload contains forbidden distribution control: ${forbidden}`)
  }
  assert.match(source, /openSettings:\s*\(\)\s*=>\s*invoke\('yaw:app:open-settings'\)/)
})

test('trusted host settings describe opt-in best-effort availability rather than authoritative seeding', () => {
  const html = require('node:fs').readFileSync(path.join(__dirname, '..', 'trusted', 'host-settings.html'), 'utf8')
  assert.match(html, /Help keep this release available while the app is open/)
  assert.match(html, /opt-in/)
  assert.match(html, /not a replacement for an always-online operator running <code>pear seed<\/code>/)
})

test('release commands use the fixed package release line and an output tree outside source', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'scripts', 'pear-release.js'), 'utf8')
  assert.match(source, /const upgrade = String\(packageJson\.upgrade \|\| ''\)/)
  assert.match(source, /path\.resolve\(root, '\.\.', `\$\{packageJson\.name\}-deploy-/)
  assert.match(source, /target === root \|\| target\.startsWith/)
  assert.match(source, /`\$\{packageJson\.productName\}\.AppImage`/)
  assert.match(source, /fs\.copyFileSync\(appImage, pearAppImage\)/)
  assert.match(source, /\['seed', upgrade, '--no-tty'\]/)
  assert.doesNotMatch(source, /process\.argv\[3\]/)
})

test('worker leaves release discovery when both update and availability roles are off', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'workers', 'main.js'), 'utf8')
  assert.match(source, /if \(!updatesEnabled && !peerAvailabilityEnabled\) \{/)
  assert.match(source, /await discovery\?\.destroy\(\)/)
  assert.match(source, /discovery = null/)
})
