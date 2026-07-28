const { codedError, validateProfileId, validateProviderRequest } = require('./ipc-validation')

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

function normalizeEndpoint(value) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw codedError('invalid_endpoint', 'Provider endpoint is invalid')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw codedError('invalid_endpoint', 'Provider endpoint cannot contain credentials, query parameters, or fragments')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw codedError('invalid_endpoint', 'Provider endpoint must use HTTPS or unauthenticated loopback HTTP')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function requestUrl(base, protocol) {
  const suffix = protocol === 'chat' ? '/chat/completions' : '/responses'
  const url = new URL(base.toString())
  url.pathname = `${url.pathname}${suffix}`.replace(/\/+/g, '/')
  return url
}

function responseText(payload, protocol) {
  if (protocol === 'chat') return String(payload?.choices?.[0]?.message?.content || '')
  if (typeof payload?.output_text === 'string') return payload.output_text
  const parts = []
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('\n')
}

function sanitizeUsage(value) {
  if (!value || typeof value !== 'object') return null
  const output = {}
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'prompt_tokens', 'completion_tokens']) {
    const number = Number(value[key])
    if (Number.isFinite(number) && number >= 0) output[key] = Math.floor(number)
  }
  return Object.keys(output).length ? output : null
}

class ProviderBroker {
  constructor({ credentialStore, fetchImpl = globalThis.fetch }) {
    this.credentialStore = credentialStore
    this.fetch = fetchImpl
  }

  async generate(profileId, rawRequest) {
    const id = validateProfileId(profileId)
    const request = validateProviderRequest(rawRequest)
    const { profile, credential } = await this.credentialStore.resolveForBroker(id)
    const base = normalizeEndpoint(profile.endpoint)
    if (base.protocol !== 'https:' && credential) {
      throw codedError('plaintext_credentials_forbidden', 'Credentials cannot be sent over plaintext HTTP')
    }
    const protocols = profile.protocol === 'auto' ? ['responses', 'chat'] : [profile.protocol]
    let lastError
    for (const protocol of protocols) {
      try {
        return await this.#request(profile, credential, base, protocol, request.request)
      } catch (error) {
        lastError = error
        if (profile.protocol !== 'auto' || !['unsupported_route', 'request_rejected'].includes(error.code)) throw error
      }
    }
    throw lastError || codedError('provider_unavailable', 'Provider request failed')
  }

  async test(profileId) {
    const result = await this.generate(profileId, {
      capability: 'text.generate',
      request: {
        instructions: 'Reply with OK.',
        input: { purpose: 'connection-test' },
        maxCharacters: 80
      }
    })
    return {
      protocol: result.protocol,
      endpoint: result.endpoint,
      model: result.modelId
    }
  }

  async #request(profile, credential, base, protocol, request) {
    const endpoint = requestUrl(base, protocol)
    if (endpoint.origin !== base.origin) throw codedError('origin_mismatch', 'Provider request origin changed')
    const prompt = JSON.stringify(request.input)
    const body = protocol === 'chat'
      ? {
          model: profile.model,
          messages: [
            ...(request.instructions ? [{ role: 'system', content: request.instructions }] : []),
            { role: 'user', content: prompt }
          ],
          max_completion_tokens: profile.maxCompletionTokens
        }
      : {
          model: profile.model,
          instructions: request.instructions || undefined,
          input: prompt,
          max_output_tokens: profile.maxCompletionTokens
        }
    if (profile.temperature !== null) body.temperature = profile.temperature
    if (profile.reasoningEffort !== 'provider') body.reasoning = { effort: profile.reasoningEffort }

    const headers = { 'content-type': 'application/json' }
    if (credential) headers.authorization = `Bearer ${credential}`
    if (profile.organization) headers['openai-organization'] = profile.organization
    if (profile.project) headers['openai-project'] = profile.project

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('timeout'), profile.timeoutMs)
    let response
    try {
      response = await this.fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) throw codedError('timeout', 'Provider request timed out')
      throw codedError('provider_unavailable', 'Provider request could not reach the endpoint')
    } finally {
      clearTimeout(timeout)
    }
    if (response.status >= 300 && response.status < 400) throw codedError('redirect_blocked', 'Provider redirects are blocked')
    if ([404, 405].includes(response.status)) throw codedError('unsupported_route', 'Provider protocol route is unavailable')
    if (!response.ok) {
      const code = response.status === 401 ? 'auth_invalid'
        : response.status === 403 ? 'forbidden'
          : response.status === 429 ? 'rate_limited'
            : response.status >= 500 ? 'provider_unavailable'
              : 'request_rejected'
      throw codedError(code, `Provider rejected the request with HTTP ${response.status}`)
    }
    const declaredLength = Number(response.headers?.get?.('content-length')) || 0
    if (declaredLength > MAX_RESPONSE_BYTES) throw codedError('invalid_response', 'Provider response is too large')
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw codedError('invalid_response', 'Provider response is too large')
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw codedError('invalid_response', 'Provider response is not valid JSON')
    }
    const generated = responseText(payload, protocol).replace(/\s+/g, ' ').trim()
    if (!generated) throw codedError('invalid_response', 'Provider returned no readable text')
    return {
      text: generated.slice(0, request.maxCharacters),
      modelId: String(payload.model || profile.model).slice(0, 120),
      protocol,
      endpoint: endpoint.toString(),
      endpointReached: true,
      authenticationAccepted: true,
      modelAccepted: true,
      usage: sanitizeUsage(payload.usage)
    }
  }
}

module.exports = { MAX_RESPONSE_BYTES, ProviderBroker, normalizeEndpoint, requestUrl }
