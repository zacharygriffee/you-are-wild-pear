const fs = require('fs/promises')
const path = require('path')

const { MAX_SAVE_BYTES, codedError, validateExportOptions, validateSaveEnvelope } = require('./ipc-validation')

function createFileService({ dialog, fsApi = fs }) {
  return {
    async exportSave(parentWindow, rawOptions) {
      const options = validateExportOptions(rawOptions)
      const result = await dialog.showSaveDialog(parentWindow, {
        title: 'Export You Are Wild save',
        defaultPath: options.suggestedName,
        filters: [{ name: 'You Are Wild save', extensions: ['yawsave'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (result.canceled || !result.filePath) return { ok: true, canceled: true }
      const destination = result.filePath.endsWith('.yawsave') ? result.filePath : `${result.filePath}.yawsave`
      const serialized = `${JSON.stringify(options.envelope, null, 2)}\n`
      if (Buffer.byteLength(serialized) > MAX_SAVE_BYTES * 2) throw codedError('invalid_save', 'Save envelope is too large')
      await fsApi.writeFile(destination, serialized, { encoding: 'utf8', mode: 0o600 })
      return { ok: true, canceled: false, name: path.basename(destination) }
    },

    async importSave(parentWindow) {
      const result = await dialog.showOpenDialog(parentWindow, {
        title: 'Import You Are Wild save',
        filters: [{ name: 'You Are Wild save', extensions: ['yawsave'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length !== 1) return { ok: true, canceled: true }
      const source = result.filePaths[0]
      if (path.extname(source).toLowerCase() !== '.yawsave') throw codedError('invalid_save', 'Save file must use the .yawsave extension')
      const stats = await fsApi.stat(source)
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_SAVE_BYTES * 2) {
        throw codedError('invalid_save', 'Save file size is invalid')
      }
      const envelope = validateSaveEnvelope(JSON.parse(await fsApi.readFile(source, 'utf8')))
      return { ok: true, canceled: false, name: path.basename(source), envelope }
    }
  }
}

module.exports = { createFileService }
