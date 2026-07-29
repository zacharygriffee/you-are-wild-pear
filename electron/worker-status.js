const path = require('path')
const crypto = require('crypto')
const FramedStream = require('framed-stream')
const PearRuntime = require('pear-runtime')
const PEAR_RUNTIME_VERSION = require('../package.json').dependencies['pear-runtime']

class WorkerStatus {
  constructor({
    run = PearRuntime.run,
    frame = worker => new FramedStream(worker),
    workerPath = path.join(__dirname, '..', 'workers', 'main.js'),
    storagePath,
    version,
    upgrade,
    name,
    appPath = '',
    updatesEnabled = true,
    peerAvailabilityEnabled = false
  }) {
    this.run = run
    this.frame = frame
    this.workerPath = workerPath
    this.storagePath = storagePath
    this.config = {
      version: String(version || '0.0.0'),
      upgrade: String(upgrade || ''),
      name: String(name || 'You Are Wild'),
      appPath: String(appPath || ''),
      updatesEnabled: updatesEnabled === true,
      peerAvailabilityEnabled: peerAvailabilityEnabled === true
    }
    this.worker = null
    this.pipe = null
    this.pending = new Map()
    this.snapshot = {
      available: false,
      runtime: 'pear',
      version: PEAR_RUNTIME_VERSION,
      bareVersion: '',
      distribution: {
        mode: this.config.upgrade.startsWith('pear://') ? 'pear-ota' : 'not-configured',
        configured: this.config.upgrade.startsWith('pear://'),
        appVersion: this.config.version,
        updatesEnabled: this.config.updatesEnabled,
        peerAvailabilityEnabled: this.config.peerAvailabilityEnabled,
        peers: 0,
        phase: 'starting',
        updateReady: false,
        restartRequired: false
      }
    }
  }

  async start() {
    if (this.worker) return this.status()
    return new Promise((resolve, reject) => {
      const worker = this.run(this.workerPath, [
        String(this.config.updatesEnabled),
        this.config.version,
        this.config.upgrade,
        this.config.name,
        this.storagePath,
        this.config.appPath,
        String(this.config.peerAvailabilityEnabled)
      ])
      const pipe = this.frame(worker)
      this.worker = worker
      this.pipe = pipe
      const timeout = setTimeout(() => {
        this.stop()
        reject(new Error('Pear worker startup timed out'))
      }, 15000)
      const onData = data => {
        let message
        try {
          message = JSON.parse(Buffer.from(data).toString('utf8'))
        } catch {
          return
        }
        if (message?.type === 'yaw:worker-response') {
          const pending = this.pending.get(String(message.requestId || ''))
          if (!pending) return
          this.pending.delete(String(message.requestId))
          clearTimeout(pending.timeout)
          if (message.ok === false) {
            const error = new Error(String(message.error?.message || 'Pear worker operation failed'))
            error.code = String(message.error?.code || 'worker_operation_failed')
            pending.reject(error)
          } else {
            pending.resolve(message.result)
          }
          return
        }
        if (message?.type !== 'yaw:worker-status') return
        this.snapshot = {
          available: message.available === true,
          runtime: 'pear',
          version: PEAR_RUNTIME_VERSION,
          bareVersion: String(message.bareVersion || ''),
          distribution: {
            mode: message.distribution?.configured === true ? 'pear-ota' : 'not-configured',
            configured: message.distribution?.configured === true,
            appVersion: String(message.distribution?.appVersion || this.config.version),
            updatesEnabled: message.distribution?.updatesEnabled === true,
            peerAvailabilityEnabled: message.distribution?.peerAvailabilityEnabled === true,
            peers: Math.max(0, Number(message.distribution?.peers) || 0),
            phase: String(message.distribution?.phase || 'ready').slice(0, 80),
            updateReady: message.distribution?.updateReady === true,
            restartRequired: this.snapshot.distribution.restartRequired === true,
            error: String(message.distribution?.error || '').slice(0, 300)
          }
        }
        if (message.reason === 'ready') {
          clearTimeout(timeout)
          resolve(this.status())
        }
      }
      pipe.on('data', onData)
      worker.once('exit', code => {
        clearTimeout(timeout)
        this.#rejectPending(new Error(`Pear worker exited with code ${code}`))
        this.worker = null
        this.pipe = null
        this.snapshot = {
          ...this.snapshot,
          available: false,
          distribution: {
            ...this.snapshot.distribution,
            phase: 'stopped',
            error: `Pear worker exited with code ${code}`
          }
        }
      })
      worker.stderr?.on('data', data => {
        const message = String(data || '').replace(/(?:bearer|basic)\s+\S+/gi, '[redacted]').slice(0, 500)
        if (message) console.error('Pear worker:', message)
      })
    })
  }

  status() {
    return JSON.parse(JSON.stringify(this.snapshot))
  }

  setUpdatesPreference(enabled) {
    const value = enabled === true
    this.config.updatesEnabled = value
    this.snapshot.distribution.restartRequired = true
    return this.status()
  }

  async setPeerAvailability(enabled) {
    const value = enabled === true
    const result = await this.#command('yaw:distribution:set-peer-availability', { enabled: value })
    this.config.peerAvailabilityEnabled = value
    this.snapshot.distribution.peerAvailabilityEnabled = value
    if (result?.status) this.#mergeCommandStatus(result.status)
    return this.status()
  }

  async refresh() {
    const result = await this.#command('yaw:distribution:refresh')
    if (result?.status) this.#mergeCommandStatus(result.status)
    return this.status()
  }

  async applyUpdate() {
    const result = await this.#command('yaw:distribution:apply-update', {}, 60000)
    if (result?.status) this.#mergeCommandStatus(result.status)
    return result || { applied: true }
  }

  stop() {
    this.#rejectPending(new Error('Pear worker stopped'))
    this.pipe?.destroy()
    if (!this.pipe) this.worker?.destroy()
    this.pipe = null
    this.worker = null
  }

  #mergeCommandStatus(status) {
    this.snapshot = {
      ...this.snapshot,
      available: status.available !== false,
      bareVersion: String(status.bareVersion || this.snapshot.bareVersion || ''),
      distribution: {
        ...this.snapshot.distribution,
        ...JSON.parse(JSON.stringify(status.distribution || {})),
        restartRequired: this.snapshot.distribution.restartRequired === true
      }
    }
  }

  #command(type, payload = {}, timeoutMs = 10000) {
    if (!this.pipe) return Promise.reject(new Error('Pear worker is unavailable'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Pear worker operation timed out'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      this.pipe.write(JSON.stringify({ type, requestId, ...payload }))
    })
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

module.exports = { WorkerStatus }
