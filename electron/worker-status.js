const path = require('path')
const FramedStream = require('framed-stream')
const PearRuntime = require('pear-runtime')
const PEAR_RUNTIME_VERSION = require('../package.json').dependencies['pear-runtime']

class WorkerStatus {
  constructor({
    run = PearRuntime.run,
    frame = worker => new FramedStream(worker),
    workerPath = path.join(__dirname, '..', 'workers', 'main.js'),
    storagePath
  }) {
    this.run = run
    this.frame = frame
    this.workerPath = workerPath
    this.storagePath = storagePath
    this.worker = null
    this.pipe = null
    this.snapshot = {
      available: false,
      runtime: 'pear',
      version: PEAR_RUNTIME_VERSION,
      distribution: { mode: 'not-configured' }
    }
  }

  async start() {
    if (this.worker) return this.status()
    return new Promise((resolve, reject) => {
      const worker = this.run(this.workerPath, [this.storagePath])
      const pipe = this.frame(worker)
      this.worker = worker
      this.pipe = pipe
      const timeout = setTimeout(() => {
        this.stop()
        reject(new Error('Pear worker startup timed out'))
      }, 10000)
      const onData = data => {
        try {
          const message = JSON.parse(Buffer.from(data).toString('utf8'))
          if (message?.type !== 'yaw:worker-ready') return
          clearTimeout(timeout)
          this.snapshot = {
            available: true,
            runtime: 'pear',
            version: PEAR_RUNTIME_VERSION,
            bareVersion: String(message.bareVersion || ''),
            distribution: { mode: 'not-configured' }
          }
          resolve(this.status())
        } catch {}
      }
      pipe.on('data', onData)
      worker.once('exit', code => {
        clearTimeout(timeout)
        this.worker = null
        this.pipe = null
        this.snapshot = {
          ...this.snapshot,
          available: false,
          error: `Pear worker exited with code ${code}`
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

  stop() {
    this.pipe?.destroy()
    if (!this.pipe) this.worker?.destroy()
    this.pipe = null
    this.worker = null
  }
}

module.exports = { WorkerStatus }
