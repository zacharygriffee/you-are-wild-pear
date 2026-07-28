const path = require('path')
const { fileURLToPath } = require('url')

const MAX_SAVE_BYTES = 8 * 1024 * 1024
const MAX_PROVIDER_BODY_BYTES = 128 * 1024
const PROFILE_KEYS = [
  'endpoint',
  'maxCompletionTokens',
  'model',
  'name',
  'organization',
  'project',
  'protocol',
  'reasoningEffort',
  'temperature',
  'timeoutMs'
]

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function assertPlainObject(value, label, allowedKeys = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('invalid_request', `${label} must be an object`)
  }
  if (allowedKeys) {
    for (const key of Object.keys(value)) {
      if (!allowedKeys.includes(key)) throw codedError('invalid_request', `${label} contains unsupported field ${key}`)
    }
  }
  return value
}

function boundedString(value, label, maximum, options = {}) {
  if (value === undefined || value === null) return options.optional ? '' : (() => { throw codedError('invalid_request', `${label} is required`) })()
  if (typeof value !== 'string') throw codedError('invalid_request', `${label} must be text`)
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (!text && !options.optional) throw codedError('invalid_request', `${label} is required`)
  if (text.length > maximum) throw codedError('invalid_request', `${label} exceeds ${maximum} characters`)
  return text
}

function validateSender(event, rendererFile) {
  const frame = event?.senderFrame
  if (!frame || frame !== event.sender?.mainFrame) throw codedError('invalid_sender', 'IPC sender is not the main renderer frame')
  let sourcePath
  try {
    const url = new URL(frame.url)
    if (url.protocol !== 'file:') throw new Error('not file')
    sourcePath = path.resolve(fileURLToPath(url))
  } catch {
    throw codedError('invalid_sender', 'IPC sender URL is invalid')
  }
  if (sourcePath !== path.resolve(rendererFile)) throw codedError('invalid_sender', 'IPC sender is not the pinned You Are Wild renderer')
  return true
}

function validateSaveEnvelope(value) {
  const envelope = assertPlainObject(value, 'Save envelope', ['schema', 'gameVersion', 'slotName', 'savedAt', 'dataBase64'])
  if (envelope.schema !== 'yaw-native-save-v1') throw codedError('invalid_save', 'Save envelope schema is invalid')
  const slotName = boundedString(envelope.slotName, 'Save slot', 20)
  if (!/^slot[1-5]$/.test(slotName)) throw codedError('invalid_save', 'Save slot is invalid')
  const dataBase64 = boundedString(envelope.dataBase64, 'Save data', MAX_SAVE_BYTES * 2)
  if (!/^[a-z0-9+/]+={0,2}$/i.test(dataBase64)) throw codedError('invalid_save', 'Save data is not valid base64')
  const bytes = Buffer.from(dataBase64, 'base64')
  if (!bytes.length || bytes.length > MAX_SAVE_BYTES) throw codedError('invalid_save', 'Save data size is invalid')
  const normalizedBase64 = bytes.toString('base64')
  if (normalizedBase64.replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) {
    throw codedError('invalid_save', 'Save data has a non-canonical encoding')
  }
  return {
    schema: 'yaw-native-save-v1',
    gameVersion: boundedString(envelope.gameVersion, 'Game version', 40),
    slotName,
    savedAt: Math.max(0, Number(envelope.savedAt) || Date.now()),
    dataBase64: normalizedBase64
  }
}

function validateExportOptions(value) {
  const options = assertPlainObject(value, 'Save export options', ['envelope', 'suggestedName'])
  const envelope = validateSaveEnvelope(options.envelope)
  const suggestedName = boundedString(options.suggestedName || `you-are-wild-${envelope.slotName}.yawsave`, 'Save filename', 160)
    .replace(/[^a-z0-9._-]/gi, '-')
  return {
    envelope,
    suggestedName: suggestedName.endsWith('.yawsave') ? suggestedName : `${suggestedName}.yawsave`
  }
}

function validateProfileInput(value) {
  const input = assertPlainObject(value, 'Provider profile', PROFILE_KEYS)
  const protocol = boundedString(input.protocol || 'auto', 'Provider protocol', 20)
  if (!['auto', 'responses', 'chat'].includes(protocol)) throw codedError('invalid_request', 'Provider protocol is unsupported')
  const reasoningEffort = boundedString(input.reasoningEffort || 'provider', 'Reasoning effort', 20)
  if (!['provider', 'none', 'minimal', 'low', 'medium', 'high'].includes(reasoningEffort)) {
    throw codedError('invalid_request', 'Reasoning effort is unsupported')
  }
  const timeoutMs = Math.max(1000, Math.min(30000, Number(input.timeoutMs) || 12000))
  const maxCompletionTokens = Math.max(64, Math.min(32768, Number(input.maxCompletionTokens) || 8192))
  const temperature = input.temperature === '' || input.temperature === undefined
    ? null
    : Math.max(0, Math.min(2, Number(input.temperature)))
  return {
    name: boundedString(input.name, 'Provider name', 120),
    endpoint: boundedString(input.endpoint, 'Provider endpoint', 500),
    model: boundedString(input.model, 'Provider model', 200),
    protocol,
    timeoutMs,
    maxCompletionTokens,
    reasoningEffort,
    temperature: Number.isFinite(temperature) ? temperature : null,
    organization: boundedString(input.organization, 'Provider organization', 160, { optional: true }),
    project: boundedString(input.project, 'Provider project', 160, { optional: true })
  }
}

function validateProfileId(value) {
  const id = boundedString(value, 'Provider profile ID', 120)
  if (!/^[a-z0-9-]+$/i.test(id)) throw codedError('invalid_request', 'Provider profile ID is invalid')
  return id
}

function validateCredential(value) {
  const credential = boundedString(value, 'Provider credential', 500)
  if (/[\r\n]/.test(credential)) throw codedError('invalid_request', 'Provider credential contains invalid characters')
  return credential
}

function validateCredentialOptions(value = {}) {
  const options = assertPlainObject(value, 'Credential options', ['persist'])
  return { persist: options.persist === true }
}

function validateProviderRequest(value) {
  const request = assertPlainObject(value, 'Provider request', ['capability', 'request'])
  if (request.capability !== 'text.generate') throw codedError('unsupported_capability', 'Only text generation is available')
  const body = assertPlainObject(request.request, 'Provider request body', ['input', 'instructions', 'maxCharacters'])
  const copiedInput = JSON.parse(JSON.stringify(body.input))
  const serialized = JSON.stringify(copiedInput)
  if (!serialized || Buffer.byteLength(serialized) > MAX_PROVIDER_BODY_BYTES) {
    throw codedError('invalid_request', 'Provider input is empty or too large')
  }
  return {
    capability: 'text.generate',
    request: {
      instructions: boundedString(body.instructions, 'Provider instructions', 2000, { optional: true }),
      input: copiedInput,
      maxCharacters: Math.max(80, Math.min(12000, Number(body.maxCharacters) || 4000))
    }
  }
}

function publicError(error) {
  return {
    code: boundedString(String(error?.code || 'host_operation_failed'), 'Error code', 80, { optional: true })
      .replace(/[^a-z0-9_.-]/gi, '_')
      .toLowerCase() || 'host_operation_failed',
    message: String(error?.message || 'Host operation failed')
      .replace(/(?:bearer|basic)\s+\S+/gi, '[redacted]')
      .replace(/sk-(?:or-v1-)?[a-z0-9_-]{8,}/gi, '[redacted]')
      .slice(0, 500)
  }
}

module.exports = {
  MAX_SAVE_BYTES,
  codedError,
  publicError,
  validateCredential,
  validateCredentialOptions,
  validateExportOptions,
  validateProfileId,
  validateProfileInput,
  validateProviderRequest,
  validateSaveEnvelope,
  validateSender
}
