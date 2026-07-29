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
| The returned worker endpoint is a byte duplex | Both ends use `framed-stream` for bounded JSON status and fixed commands |
| Worker arguments begin at `Bare.argv[2]` | Main passes update preference, version, release link, package name, storage, app path, and peer opt-in |
| Pear OTA is embedded instead of using removed `pear run` | The Bare worker owns `new PearRuntime(...)` and updater events |
| Release discovery is Corestore/Hyperswarm-backed | The worker owns both objects and joins only the configured release discovery key |
| Peer, storage, and native P2P code stays out of the renderer | The renderer exposes only the bounded `window.yawHost` preload contract |
| Renderer remains sandboxed | `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` |
| Secrets stay outside the game renderer | A fixed local trusted modal uses a separate preload and unique non-persistent session partition |
| Host-only distribution controls stay outside game/mod code | A second trusted local window owns update and explicit peer-availability settings |
| Electron Forge creates the Linux distributable | `npm run make` uses the official Pear AppImage maker |
| Native runtime prebuilds are packaged then platform-pruned | Forge uses the official universal-prebuild and prune-prebuild plugins |
| `pear build` assembles a sibling deployment tree | The fixed release helper supplies `You Are Wild.AppImage` and refuses an in-source target |
| `pear stage` and `pear seed` operate on the pinned line | Package scripts accept no arbitrary release link |
| `package-lock.json` fixes the resolved runtime graph | Pear Runtime 1.3.1, Corestore 7.12.0, Hyperswarm 4.17.0, Electron 40.10.1 |

## Runtime and consent boundary

The worker is now the Pear OTA owner. It constructs `PearRuntime` with the
real stage link and fixed package identity, listens to bounded updater events,
and uses a worker-owned Corestore and Hyperswarm. The main process receives
only sanitized runtime state and fixed command results.

Receiving releases defaults on in packaged builds. The development start
command supplies `--no-updates` so local source is never replaced. Serving
cached release blocks defaults off and requires an explicit player opt-in in
the trusted Pear Desktop window. When both roles are off, the worker destroys
its discovery session.

The game preload exposes only a redacted distribution snapshot and the ability
to request that main open the trusted settings window. It exposes no update
mutation, release key, seeding command, swarm, Corestore, Pear Runtime, or
generic IPC API. Executable mods therefore cannot opt the player into peer
participation.

## Configuration placement

Current Pear CLI application configuration lives in `package.json`, including
the stage `upgrade` link. `pear.json` is the configuration file for future
multisig public keys, namespace, and quorum. It remains absent until production
signer governance is designed.

The application reports `mode: "pear-ota"` with configured state, effective
update role, peer role, peer count, update phase, and normalized error.

## Deployment validation

The current AppImage was assembled into the documented
`by-arch/linux-x64/app/You Are Wild.AppImage` tree and staged to:

```text
pear://0.3.xppppuik8h7kyn7qbf5mukh38s9n3tx1scx4p1r5sqxaio9zjz8o
```

`pear info` reported version `0.1.0`, release length `3`, and blob byte length
`153062844`. A foreground `pear seed` announced the release and reported
`firewalled false`. A same-host isolated install timed out without discovering
the seeder, so a second-machine/network install remains a release gate.

## Remaining release gates

- Select a canonical square application icon and configure the Forge packager
  and AppImage maker.
- Test the AppImage on a clean Linux VM and document the validated environment.
- Validate `pear install` and OTA replacement from a second machine/network.
- Choose production maintainers and quorum, then use provisioning and multisig
  rather than treating the stage writer as a production signer.
- Run redundant always-online operator seeders.
- Keep production distribution independent of Omega or another optional
  sidecar.

## Sources

- [Pear desktop application architecture](https://docs.pears.com/explanation/pear-desktop-architecture/)
- [Workers](https://docs.pears.com/explanation/workers/)
- [Pear Runtime](https://docs.pears.com/reference/pear/runtime/)
- [Pear CLI](https://docs.pears.com/reference/pear/cli/)
- [Configuration](https://docs.pears.com/reference/pear/configuration/)
- [Build desktop distributables](https://docs.pears.com/how-to/operate-an-app/build-and-package/build-desktop-distributables/)
- [Manual deployment](https://docs.pears.com/how-to/operate-an-app/manual-deployment/deployment/)
- [Storage and distribution](https://docs.pears.com/explanation/storage-and-distribution/)
