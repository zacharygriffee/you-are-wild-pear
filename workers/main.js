const message = {
  type: 'yaw:worker-ready',
  runtime: 'pear',
  bareVersion: String(Bare.version || ''),
  distribution: { mode: 'not-configured' }
}

Bare.IPC.write(JSON.stringify(message))

Bare.on('beforeExit', () => {
  Bare.IPC?.end()
})
