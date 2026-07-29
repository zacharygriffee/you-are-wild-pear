#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const packageFile = path.join(root, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
const action = String(process.argv[2] || '')
const upgrade = String(packageJson.upgrade || '')
const appImage = path.join(root, 'out', 'make', `${packageJson.productName}-${packageJson.version}-x64.AppImage`)
const pearInputDirectory = path.join(root, 'out', 'pear-input')
const pearAppImage = path.join(pearInputDirectory, `${packageJson.productName}.AppImage`)
const defaultTarget = path.resolve(root, '..', `${packageJson.name}-deploy-${packageJson.version}`)
const target = path.resolve(process.env.YAW_PEAR_DEPLOY_PATH || defaultTarget)

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(args, options = {}) {
  const result = spawnSync('pear', args, {
    cwd: options.cwd || path.dirname(root),
    encoding: 'utf8',
    stdio: options.stdio || 'inherit'
  })
  if (result.error) fail(`Pear CLI failed to start: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status || 1)
}

if (!/^pear:\/\/[a-z0-9]+$/i.test(upgrade)) fail('package.json does not contain a valid Pear upgrade link')
if (target === root || target.startsWith(`${root}${path.sep}`)) {
  fail('Pear deployment output must be outside the application source tree')
}

if (action === 'build') {
  if (!fs.existsSync(appImage)) fail(`Linux AppImage is missing: ${appImage}`)
  fs.mkdirSync(pearInputDirectory, { recursive: true })
  fs.copyFileSync(appImage, pearAppImage)
  run([
    'build',
    '--package', packageFile,
    '--linux-x64-app', pearAppImage,
    '--target', target
  ])
  console.log(`Pear deployment directory: ${target}`)
} else if (action === 'stage-dry' || action === 'stage') {
  if (!fs.existsSync(path.join(target, 'package.json'))) {
    fail(`Pear deployment directory is missing; run npm run pear:build first: ${target}`)
  }
  const args = ['stage', upgrade, target]
  if (action === 'stage-dry') args.push('--dry-run')
  run(args)
} else if (action === 'seed') {
  run(['seed', upgrade, '--no-tty'], { cwd: root })
} else if (action === 'info') {
  run(['info', upgrade])
} else {
  fail('Usage: node scripts/pear-release.js <build|stage-dry|stage|seed|info>')
}
