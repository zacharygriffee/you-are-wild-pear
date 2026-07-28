const { access, symlink, unlink } = require('node:fs/promises')
const path = require('node:path')

const EXECUTABLE_NAME = 'you-are-wild'
const PRODUCT_NAME = 'You Are Wild'

module.exports = {
  packagerConfig: {
    executableName: EXECUTABLE_NAME,
    derefSymlinks: true
  },
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'linux') return

      // pear-electron-forge-maker-appimage@2.0.0 substitutes appName rather than
      // packagerConfig.executableName into AppRun. Keep the lowercase binary for
      // the desktop entry and provide the product-name alias AppRun expects.
      for (const outputPath of packageResult.outputPaths) {
        const executablePath = path.join(outputPath, EXECUTABLE_NAME)
        const productAliasPath = path.join(outputPath, PRODUCT_NAME)
        await access(executablePath)
        await unlink(productAliasPath).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
        await symlink(EXECUTABLE_NAME, productAliasPath)
      }
    }
  },
  makers: [
    {
      name: 'pear-electron-forge-maker-appimage',
      platforms: ['linux'],
      config: {}
    }
  ],
  plugins: [
    {
      name: 'electron-forge-plugin-universal-prebuilds',
      config: {}
    },
    {
      name: 'electron-forge-plugin-prune-prebuilds',
      config: {}
    }
  ]
}
