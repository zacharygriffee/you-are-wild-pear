#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = JSON.parse(fs.readFileSync(path.join(root, 'yaw-source.json'), 'utf8'))
const vendorRoot = path.join(root, 'renderer', 'vendor', 'yaw')
const manifestPath = path.join(vendorRoot, 'yaw-renderer-manifest.json')

if (!fs.existsSync(manifestPath)) throw new Error('YAW renderer manifest is missing; run npm run sync:yaw')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest.schema !== 'yaw-renderer-manifest-v1') throw new Error('YAW renderer manifest schema is invalid')
if (manifest.commit !== source.ref) throw new Error('YAW renderer commit does not match yaw-source.json')
if (manifest.version !== source.expectedVersion) throw new Error('YAW renderer version does not match yaw-source.json')

for (const [relative, expected] of Object.entries(manifest.files || {})) {
  if (!/^(?:index\.html|assets\/[a-z0-9._-]+)$/i.test(relative)) throw new Error(`Unexpected renderer path: ${relative}`)
  const file = path.join(vendorRoot, relative)
  if (!fs.existsSync(file)) throw new Error(`Missing renderer file: ${relative}`)
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (actualHash !== expected.sha256) throw new Error(`Renderer hash drift: ${relative}`)
  if (fs.statSync(file).size !== expected.bytes) throw new Error(`Renderer size drift: ${relative}`)
}

const expectedFiles = ['index.html', 'assets/basic-tileset-v1.png', 'assets/basic-tileset-overlays-v1.png', 'assets/terrain-sand-seamless-v1.png']
for (const relative of expectedFiles) {
  if (!manifest.files?.[relative]) throw new Error(`Renderer manifest omits required file: ${relative}`)
}

console.log(`Verified You Are Wild ${manifest.version} renderer at ${manifest.commit}`)
