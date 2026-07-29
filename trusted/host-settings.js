const updatesField = document.getElementById('updates-enabled')
const availabilityField = document.getElementById('peer-availability-enabled')
const applyButton = document.getElementById('apply-update')
const refreshButton = document.getElementById('refresh')
const closeButton = document.getElementById('close')
const message = document.getElementById('message')
let latestContext = null

function setBusy(busy) {
  updatesField.disabled = busy
  availabilityField.disabled = busy || latestContext?.runtime?.distribution?.configured !== true
  refreshButton.disabled = busy
  closeButton.disabled = busy
  applyButton.disabled = busy || latestContext?.runtime?.distribution?.updateReady !== true
}

function safeText(value, fallback = 'Unavailable') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function render(context) {
  latestContext = context
  const distribution = context.runtime?.distribution || {}
  document.getElementById('app-version').textContent = safeText(context.app?.version)
  document.getElementById('pear-version').textContent = safeText(context.runtime?.version)
  document.getElementById('bare-version').textContent = safeText(context.runtime?.bareVersion)
  document.getElementById('release-status').textContent = distribution.configured
    ? 'Configured'
    : 'Not configured'
  document.getElementById('update-state').textContent = safeText(distribution.phase, 'Unknown')
  document.getElementById('peer-count').textContent = String(Math.max(0, Number(distribution.peers) || 0))
  updatesField.checked = context.preferences?.updatesEnabled === true
  availabilityField.checked = context.preferences?.peerAvailabilityEnabled === true
  updatesField.disabled = false
  availabilityField.disabled = distribution.configured !== true
  applyButton.disabled = distribution.updateReady !== true
  message.textContent = distribution.restartRequired
    ? 'Restart You Are Wild to apply the update preference.'
    : safeText(distribution.error, '')
}

async function perform(operation, failureMessage) {
  setBusy(true)
  message.textContent = ''
  try {
    const result = await operation()
    if (!result?.ok) throw new Error(result?.error?.message || failureMessage)
    render(result)
    return result
  } catch (error) {
    message.textContent = error?.message || failureMessage
    return null
  } finally {
    setBusy(false)
  }
}

updatesField.addEventListener('change', () => {
  const enabled = updatesField.checked
  perform(() => window.yawDesktopSettings.setUpdatesEnabled(enabled), 'Update preference could not be saved.')
})

availabilityField.addEventListener('change', () => {
  const enabled = availabilityField.checked
  perform(() => window.yawDesktopSettings.setPeerAvailabilityEnabled(enabled), 'Peer availability could not be changed.')
})

refreshButton.addEventListener('click', () => {
  perform(() => window.yawDesktopSettings.refresh(), 'Pear status could not be refreshed.')
})

applyButton.addEventListener('click', () => {
  perform(() => window.yawDesktopSettings.applyUpdate(), 'The downloaded update could not be applied.')
})

closeButton.addEventListener('click', () => {
  setBusy(true)
  window.yawDesktopSettings.close()
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !closeButton.disabled) closeButton.click()
})

perform(() => window.yawDesktopSettings.context(), 'Pear Desktop settings could not start.')
