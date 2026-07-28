const assert = require('node:assert/strict')
const test = require('node:test')

const { ProviderBroker, normalizeEndpoint } = require('../electron/provider-broker')

function store(profile, credential = '') {
  return {
    async resolveForBroker() {
      return { profile, credential }
    }
  }
}

function profile(endpoint = 'https://api.example.test/v1') {
  return {
    endpoint,
    model: 'test-model',
    protocol: 'responses',
    timeoutMs: 1000,
    maxCompletionTokens: 256,
    reasoningEffort: 'provider',
    temperature: null,
    organization: '',
    project: ''
  }
}

function request() {
  return {
    capability: 'text.generate',
    request: {
      instructions: 'Be concise.',
      input: { exchangeId: 'test' },
      maxCharacters: 100
    }
  }
}

test('provider broker rejects unsafe endpoints, redirects, and plaintext authentication', async () => {
  assert.throws(() => normalizeEndpoint('http://api.example.test/v1'), error => error.code === 'invalid_endpoint')
  assert.throws(() => normalizeEndpoint('https://user:pass@api.example.test/v1'), error => error.code === 'invalid_endpoint')
  await assert.rejects(
    () => new ProviderBroker({
      credentialStore: store(profile('http://127.0.0.1:11434/v1'), 'secret'),
      fetchImpl: async () => { throw new Error('must not fetch') }
    }).generate('native-profile', request()),
    error => error.code === 'plaintext_credentials_forbidden'
  )
  await assert.rejects(
    () => new ProviderBroker({
      credentialStore: store(profile(), 'secret'),
      fetchImpl: async () => ({ status: 302, ok: false, headers: { get: () => '0' }, text: async () => '' })
    }).generate('native-profile', request()),
    error => error.code === 'redirect_blocked'
  )
})

test('provider broker bounds and sanitizes successful output without returning credentials', async () => {
  const secret = 'credential-that-must-not-return'
  const calls = []
  const broker = new ProviderBroker({
    credentialStore: store(profile(), secret),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return {
        status: 200,
        ok: true,
        headers: { get: () => '200' },
        async text() {
          return JSON.stringify({
            model: 'safe-model',
            output_text: 'A bounded result.',
            usage: { input_tokens: 12, output_tokens: 4, internal_secret: secret }
          })
        }
      }
    }
  })
  const result = await broker.generate('native-profile', request())
  assert.equal(result.text, 'A bounded result.')
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4 })
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(calls[0].options.headers.authorization, `Bearer ${secret}`)
  assert.equal(calls[0].url, 'https://api.example.test/v1/responses')
})
