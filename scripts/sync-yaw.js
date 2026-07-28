#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const sourceConfig = JSON.parse(fs.readFileSync(path.join(root, 'yaw-source.json'), 'utf8'))
const sourceRoot = path.resolve(process.env.YAW_CORE_PATH || path.join(root, '..', 'you-are-wild'))
const vendorRoot = path.join(root, 'renderer', 'vendor', 'yaw')
const assetsRoot = path.join(vendorRoot, 'assets')

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

if (!fs.existsSync(path.join(sourceRoot, 'app', 'package.json'))) {
  throw new Error(`YAW source is unavailable at ${sourceRoot}`)
}

const commit = run('git', ['rev-parse', 'HEAD'], sourceRoot)
if (commit !== sourceConfig.ref) {
  throw new Error(`YAW source commit drift: expected ${sourceConfig.ref}, received ${commit}`)
}
if (run('git', ['status', '--porcelain'], sourceRoot)) {
  throw new Error('YAW source must have a clean working tree before renderer synchronization')
}

const release = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'app', 'release.json'), 'utf8'))
if (release.version !== sourceConfig.expectedVersion) {
  throw new Error(`YAW version drift: expected ${sourceConfig.expectedVersion}, received ${release.version}`)
}

execFileSync('npm', ['--prefix', 'app', 'run', 'build:hosted'], {
  cwd: sourceRoot,
  stdio: 'inherit'
})

fs.rmSync(vendorRoot, { recursive: true, force: true })
fs.mkdirSync(assetsRoot, { recursive: true })

const files = [
  ['dist/you-are-wild.hosted.html', 'index.html'],
  ['media/basic-tileset-v1.png', 'assets/basic-tileset-v1.png'],
  ['media/basic-tileset-overlays-v1.png', 'assets/basic-tileset-overlays-v1.png'],
  ['media/terrain-sand-seamless-v1.png', 'assets/terrain-sand-seamless-v1.png']
]

for (const [source, destination] of files) {
  copyFile(path.join(sourceRoot, source), path.join(vendorRoot, destination))
}

const manifest = {
  schema: 'yaw-renderer-manifest-v1',
  repository: sourceConfig.repository,
  commit,
  version: release.version,
  generatedAt: new Date().toISOString(),
  files: Object.fromEntries(files.map(([, destination]) => [
    destination,
    {
      bytes: fs.statSync(path.join(vendorRoot, destination)).size,
      sha256: sha256(path.join(vendorRoot, destination))
    }
  ]))
}

fs.writeFileSync(path.join(vendorRoot, 'yaw-renderer-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Synchronized You Are Wild ${release.version} at ${commit}`)
