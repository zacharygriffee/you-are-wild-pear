const form = document.getElementById('credential-form')
const credentialField = document.getElementById('credential')
const persistField = document.getElementById('persist')
const storageDetail = document.getElementById('storage-detail')
const message = document.getElementById('message')
const cancelButton = document.getElementById('cancel')
const submitButton = document.getElementById('submit')

function setBusy(busy) {
  credentialField.disabled = busy
  persistField.disabled = busy || persistField.dataset.available !== 'true'
  cancelButton.disabled = busy
  submitButton.disabled = busy
}

function safeText(value, fallback) {
  const text = String(value || '').trim()
  return text || fallback
}

async function initialize() {
  const context = await window.yawCredential.context()
  if (!context?.ok) {
    message.textContent = context?.error?.message || 'Credential configuration is unavailable.'
    setBusy(true)
    return
  }
  document.getElementById('profile-name').textContent = safeText(context.profile?.name, 'Unnamed connection')
  document.getElementById('profile-endpoint').textContent = safeText(context.profile?.endpoint, 'Not specified')
  document.getElementById('profile-model').textContent = safeText(context.profile?.model, 'Not specified')
  const persistentAllowed = context.storage?.persistentAllowed === true
  persistField.dataset.available = String(persistentAllowed)
  persistField.checked = persistentAllowed
  persistField.disabled = !persistentAllowed
  storageDetail.textContent = persistentAllowed
    ? `Protected by the ${safeText(context.storage?.backend, 'operating-system')} credential backend.`
    : `Secure persistence is unavailable (${safeText(context.storage?.backend, 'unknown')}). The credential can be used for this session only.`
  credentialField.focus()
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  let credential = credentialField.value
  credentialField.value = ''
  message.textContent = ''
  setBusy(true)
  const result = await window.yawCredential.submit(credential, {
    persist: persistField.checked && persistField.dataset.available === 'true'
  })
  credential = ''
  if (!result?.ok) {
    message.textContent = result?.error?.message || 'Credential storage failed.'
    setBusy(false)
  }
})

cancelButton.addEventListener('click', () => {
  credentialField.value = ''
  setBusy(true)
  window.yawCredential.cancel()
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !cancelButton.disabled) cancelButton.click()
})

initialize().catch(() => {
  message.textContent = 'Credential configuration could not start.'
  setBusy(true)
})
