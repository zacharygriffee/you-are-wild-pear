const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('credential boundary demonstration uses production custody and preload code', () => {
  const packageJson = require('../package.json')
  const source = fs.readFileSync(path.join(__dirname, 'credential-boundary-demo.js'), 'utf8')
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'credential-boundary-renderer.html'), 'utf8')

  assert.equal(packageJson.scripts['demo:credential-boundary'], 'electron test/credential-boundary-demo.js')
  assert.match(source, /require\('\.\.\/electron\/credentials'\)/)
  assert.match(source, /require\('\.\.\/electron\/ipc-validation'\)/)
  assert.match(source, /electron', 'preload\.js'/)
  assert.match(source, /contextIsolation:\s*true/)
  assert.match(source, /sandbox:\s*true/)
  assert.match(source, /nodeIntegration:\s*false/)
  assert.match(source, /setupWindow\.destroy\(\)/)
  assert.match(source, /restartedStore\.resolveForBroker/)
  assert.match(fixture, /default-src 'none'/)
})
