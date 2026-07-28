const assert = require('node:assert/strict')
const test = require('node:test')

const { createFileService } = require('../electron/files')
const {
  validateProfileInput,
  validateProviderRequest,
  validateSaveEnvelope,
  validateSender
} = require('../electron/ipc-validation')

function envelope(bytes = Buffer.from('save-data')) {
  return {
    schema: 'yaw-native-save-v1',
    gameVersion: '0.17.0',
    slotName: 'slot2',
    savedAt: 123,
    dataBase64: bytes.toString('base64')
  }
}

test('IPC rejects unknown senders and malformed requests', () => {
  const rendererFile = '/tmp/renderer/index.html'
  const mainFrame = { url: 'file:///tmp/renderer/index.html' }
  assert.equal(validateSender({ senderFrame: mainFrame, sender: { mainFrame } }, rendererFile), true)
  assert.throws(
    () => validateSender({ senderFrame: { url: 'file:///tmp/evil.html' }, sender: { mainFrame } }, rendererFile),
    error => error.code === 'invalid_sender'
  )
  assert.throws(
    () => validateProfileInput({ name: 'Bad', endpoint: 'https://example.test', model: 'm', protocol: 'raw-ipc' }),
    error => error.code === 'invalid_request'
  )
  assert.throws(
    () => validateProviderRequest({ capability: 'filesystem.read', request: { input: {} } }),
    error => error.code === 'unsupported_capability'
  )
})

test('save envelope size, extension, and schema validation are bounded', async () => {
  assert.deepEqual(validateSaveEnvelope(envelope()).slotName, 'slot2')
  assert.throws(() => validateSaveEnvelope({ ...envelope(), schema: 'other' }), /schema/i)
  assert.throws(() => validateSaveEnvelope({ ...envelope(), slotName: '../../secret' }), /slot/i)

  const writes = []
  const fileService = createFileService({
    dialog: {
      async showSaveDialog() { return { canceled: false, filePath: '/tmp/yaw-export' } },
      async showOpenDialog() { return { canceled: false, filePaths: ['/tmp/not-a-save.txt'] } }
    },
    fsApi: {
      async writeFile(file, data) { writes.push({ file, data }) },
      async stat() { return { isFile: () => true, size: 10 } },
      async readFile() { return JSON.stringify(envelope()) }
    }
  })
  const exported = await fileService.exportSave(null, { envelope: envelope(), suggestedName: 'safe' })
  assert.equal(exported.name, 'yaw-export.yawsave')
  assert.equal(writes[0].file.endsWith('.yawsave'), true)
  assert.equal(writes[0].data.includes('providerCredential'), false)
  await assert.rejects(() => fileService.importSave(null), /extension/i)
})
