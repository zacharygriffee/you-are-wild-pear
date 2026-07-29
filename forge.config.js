module.exports = {
  packagerConfig: {
    derefSymlinks: true
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
