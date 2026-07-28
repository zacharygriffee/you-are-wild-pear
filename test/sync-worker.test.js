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

test('Pear distribution configuration stays absent until a release line exists', () => {
  assert.equal(Object.hasOwn(packageJson, 'upgrade'), false)
  assert.equal(fs.existsSync(path.join(root, 'pear.json')), false)
})

test('pinned YAW renderer manifest verifies', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-yaw.js'], { cwd: root, encoding: 'utf8' })
  assert.match(output, /Verified You Are Wild 0\.17\.0 renderer/)
})

test('Pear worker startup reports a non-seeding runtime status', async () => {
  const fake = new EventEmitter()
  fake.stderr = new EventEmitter()
  fake.destroy = () => {}
  const worker = new WorkerStatus({
    storagePath: '/tmp/yaw-worker-test',
    run(specifier, args) {
      assert.equal(specifier, path.join(root, 'workers', 'main.js'))
      assert.deepEqual(args, ['/tmp/yaw-worker-test'])
      queueMicrotask(() => fake.emit('data', Buffer.from(JSON.stringify({
        type: 'yaw:worker-ready',
        bareVersion: 'test-bare'
      }))))
      return fake
    }
  })
  const status = await worker.start()
  assert.equal(status.available, true)
  assert.equal(status.runtime, 'pear')
  assert.equal(status.bareVersion, 'test-bare')
  assert.deepEqual(status.distribution, { mode: 'not-configured' })
  worker.stop()
})
