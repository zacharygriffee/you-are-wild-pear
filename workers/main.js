const FramedStream = require('framed-stream')

const IPC = new FramedStream(Bare.IPC)
const message = {
  type: 'yaw:worker-ready',
  runtime: 'pear',
  bareVersion: String(Bare.version || ''),
  distribution: { mode: 'not-configured' }
}

IPC.write(JSON.stringify(message))

Bare.on('beforeExit', () => {
  IPC.end()
})
