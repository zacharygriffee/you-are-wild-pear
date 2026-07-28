# Pear API and repository audit

Audit date: 2026-07-28

Official template:
[`holepunchto/hello-pear-electron`](https://github.com/holepunchto/hello-pear-electron)
at `ad23048ae2a02ee9a0961c280e795da66a08d77d`.
The template `main` ref and the live Pear v3 documentation were rechecked on
the audit date. The workstation Pear platform reported 3.0.1, the standalone
Bare CLI and spawned status worker reported 1.30.3, and Node.js reported
24.14.1.

## Current phase mapping

| Official contract | You Are Wild Pear |
| --- | --- |
| Electron main starts Bare work with `PearRuntime.run()` | `electron/worker-status.js` starts `workers/main.js` |
| The returned worker endpoint is a byte duplex | Both ends use `framed-stream` for the bounded JSON status write |
| First host argument is `Bare.argv[2]` | Main passes the application user-data Pear directory as the first argument |
| Peer, storage, and native P2P code stays out of the renderer | The renderer exposes only the bounded `window.yawHost` preload contract |
| Renderer remains sandboxed | `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` |
| Electron Forge creates the Linux distributable | `npm run make` uses the official Pear AppImage maker |
| Native runtime prebuilds are packaged then platform-pruned | Forge uses the official universal-prebuild and prune-prebuild plugins |
| `package-lock.json` fixes the resolved runtime graph | Pear Runtime 1.3.1, Electron 40.10.1, Forge 7.11.2, AppImage maker 2.0.0 |

## Deliberate minimal-runtime boundary

The current worker proves that the embedded Bare runtime starts and reports
non-seeding status. This is the minimal static `PearRuntime.run()` form
documented by Pear. It is sufficient for this phase because no Corestore,
Hyperswarm, seeding, or OTA update lifecycle is enabled.

A production Pear release adds a worker-owned `new PearRuntime({ ... })`
instance with a real `package.json` `upgrade` link, application path, version,
storage directory, and updater lifecycle. Adding a fake link would make the
repository look deployable without creating an actual writable release line,
so that work is intentionally deferred.

The current official template now delegates that full worker implementation to
the published `hello-pear-worker` module. This repository intentionally does
not depend on that module yet: it would also introduce Corestore, Hyperswarm,
and the OTA updater that this phase lists as non-goals. The main-process
`PearRuntime.run()` placement, framed IPC stream, Bare entrypoint, and Forge
prebuild handling still follow the same current template contracts.

## Configuration placement

Current Pear CLI application configuration lives in `package.json`, including
the future `upgrade` and `pear.stage` fields. `pear.json` is the configuration
file for future multisig public keys, namespace, and quorum. It is therefore
absent until multisig is designed.

The application's `{ mode: "not-configured" }` response is runtime status, not
Pear CLI configuration.

## Remaining release gates

- Select a canonical square application icon and configure the Forge packager
  and AppImage maker.
- Create a real Pear release line before adding `package.json` `upgrade`.
- Move update ownership into the Bare worker when OTA updates enter scope.
- Build the deployment directory outside the repository.
- Test the AppImage on a clean Linux VM and document the validated environment.
- Keep staging, provisioning, multisig, and seeding independent of Omega or
  another optional sidecar.

## Sources

- [Pear desktop application architecture](https://docs.pears.com/explanation/pear-desktop-architecture/)
- [Workers](https://docs.pears.com/explanation/workers/)
- [Pear Runtime](https://docs.pears.com/reference/pear/runtime/)
- [Configuration](https://docs.pears.com/reference/pear/configuration/)
- [Build desktop distributables](https://docs.pears.com/how-to/operate-an-app/build-and-package/build-desktop-distributables/)
