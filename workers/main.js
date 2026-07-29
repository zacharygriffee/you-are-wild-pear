const path = require('bare-path')
const Corestore = require('corestore')
const FramedStream = require('framed-stream')
const Hyperswarm = require('hyperswarm')
const PearRuntime = require('pear-runtime')

const IPC = new FramedStream(Bare.IPC)
const updatesEnabled = Bare.argv[2] !== 'false'
const version = String(Bare.argv[3] || '0.0.0')
const upgrade = String(Bare.argv[4] || '')
const name = String(Bare.argv[5] || 'You Are Wild')
const directory = String(Bare.argv[6] || '')
const appPath = String(Bare.argv[7] || '') || null
let peerAvailabilityEnabled = Bare.argv[8] === 'true'
const configured = /^pear:\/\/[a-z0-9]+$/i.test(upgrade)
const store = configured ? new Corestore(path.join(directory, 'pear-runtime', 'corestore')) : null
const swarm = configured ? new Hyperswarm() : null
const pear = configured
  ? new PearRuntime({
      app: appPath,
      dir: directory,
      name,
      store,
      swarm,
      updates: updatesEnabled,
      upgrade,
      version
    })
  : null
let discovery = null
let phase = configured ? 'starting' : 'not-configured'
let updateReady = false
let lastError = ''

function snapshot() {
  return {
    available: true,
    bareVersion: String(Bare.version || ''),
    distribution: {
      configured,
      appVersion: version,
      updatesEnabled,
      peerAvailabilityEnabled,
      peers: swarm?.connections?.size || 0,
      phase,
      updateReady,
      error: lastError
    }
  }
}

function write(message) {
  IPC.write(JSON.stringify(message))
}

function sendStatus(reason = 'changed') {
  write({ type: 'yaw:worker-status', reason, ...snapshot() })
}

function respond(requestId, result) {
  write({ type: 'yaw:worker-response', requestId, ok: true, result })
}

function reject(requestId, error) {
  write({
    type: 'yaw:worker-response',
    requestId,
    ok: false,
    error: {
      code: String(error?.code || 'worker_operation_failed').slice(0, 80),
      message: String(error?.message || 'Pear worker operation failed').slice(0, 300)
    }
  })
}

async function refreshDiscovery() {
  if (!configured) return
  if (!updatesEnabled && !peerAvailabilityEnabled) {
    await discovery?.destroy()
    discovery = null
    return
  }
  if (!discovery) {
    discovery = swarm.join(pear.updater.drive.core.discoveryKey, {
      client: updatesEnabled,
      server: peerAvailabilityEnabled
    })
  } else {
    await discovery.refresh({
      client: updatesEnabled,
      server: peerAvailabilityEnabled
    })
  }
  await discovery.flushed()
}

async function initialize() {
  if (!configured) {
    sendStatus('ready')
    return
  }
  swarm.on('connection', connection => {
    store.replicate(connection)
    sendStatus('peer-connected')
    connection.once('close', () => sendStatus('peer-disconnected'))
  })
  pear.updater.on('error', error => {
    phase = 'error'
    lastError = String(error?.message || error || 'Pear update error').slice(0, 300)
    sendStatus('error')
  })
  pear.updater.on('updating', () => {
    phase = 'updating'
    lastError = ''
    sendStatus('updating')
  })
  pear.updater.on('updated', () => {
    phase = 'update-ready'
    updateReady = true
    sendStatus('updated')
  })
  await pear.ready()
  await refreshDiscovery()
  phase = 'ready'
  sendStatus('ready')
}

IPC.on('data', async data => {
  let message
  try {
    message = JSON.parse(Buffer.from(data).toString('utf8'))
    const requestId = String(message?.requestId || '')
    if (!requestId) return
    if (message.type === 'yaw:distribution:set-peer-availability') {
      peerAvailabilityEnabled = message.enabled === true
      await refreshDiscovery()
      sendStatus('availability-changed')
      respond(requestId, { status: snapshot() })
      return
    }
    if (message.type === 'yaw:distribution:refresh') {
      await refreshDiscovery()
      sendStatus('refreshed')
      respond(requestId, { status: snapshot() })
      return
    }
    if (message.type === 'yaw:distribution:apply-update') {
      if (!configured || !updateReady) {
        const error = new Error('No Pear update is ready to apply')
        error.code = 'update_unavailable'
        throw error
      }
      phase = 'applying'
      sendStatus('applying')
      await pear.updater.applyUpdate()
      updateReady = false
      phase = 'applied'
      respond(requestId, { applied: true, status: snapshot() })
      return
    }
    const error = new Error('Unknown Pear worker operation')
    error.code = 'unknown_operation'
    throw error
  } catch (error) {
    reject(String(message?.requestId || ''), error)
  }
})

Bare.on('beforeExit', async () => {
  try {
    await discovery?.destroy()
    await swarm?.destroy()
    await pear?.close()
    await store?.close()
  } catch {}
  IPC.end()
})

initialize().catch(error => {
  phase = 'error'
  lastError = String(error?.message || error || 'Pear startup failed').slice(0, 300)
  sendStatus('ready')
})
