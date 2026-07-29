# You Are Wild Pear

This repository is the Linux native host for [You Are Wild](https://github.com/zacharygriffee/you-are-wild). The canonical game stays in the adjacent `you-are-wild` repository. This host adds a sandboxed Electron window, an embedded Pear/Bare worker, native save dialogs, main-process provider networking, and OS-backed credential storage.

It is based on the current official
[`holepunchto/hello-pear-electron`](https://github.com/holepunchto/hello-pear-electron)
desktop process model at commit
`ad23048ae2a02ee9a0961c280e795da66a08d77d`, cross-checked against the
official Pear desktop, worker, runtime, configuration, and distributable
documentation on 2026-07-28.

## Process architecture

```text
You Are Wild module
    -> MODS.ai.generate()
        -> YAW provider manager
            -> host-backed provider adapter
                -> bounded preload method
                    -> Electron main provider broker
                        -> safeStorage credential
                        -> approved provider origin

Sandboxed Electron renderer
    -> semantic window.yawHost methods only
        -> sender-validated Electron main handlers
            -> native save dialogs
            -> credential store
            -> provider broker
            -> Pear worker status

Core provider UI
    -> configureCredential(opaque profile ID)
        -> Electron main opens fixed local trusted modal
            -> dedicated credential preload accepts key
                -> main-process credential store
                    -> safeStorage or session-only memory

Electron main
    -> PearRuntime.run(workers/main.js)
        -> Bare worker
            -> PearRuntime updater
            -> release-drive Corestore
            -> Hyperswarm discovery
                -> receive updates (default on)
                -> serve cached release blocks (explicit opt-in)
```

The Electron process starts the documented `PearRuntime.run()` Bare worker.
That worker owns the updater, Corestore, and Hyperswarm lifecycle for the
configured Pear release line. Structured status and a small fixed command set
cross `Bare.IPC`; neither the game renderer nor mods receive a swarm, Corestore,
Pear Runtime, or generic IPC object.

Responsibilities:

- Electron main owns native dialogs, filesystem writes, provider HTTP authentication, credential encryption, navigation restrictions, and worker lifecycle.
- The game preload exposes only documented semantic methods. Credential setup accepts an opaque profile ID but no secret, and there is no raw IPC, Electron, shell, arbitrary file, or secret-reading API.
- A separate fixed local credential-entry page and preload expose only redacted context, submit, and cancel operations. The profile ID remains in main, and a unique non-persistent session partition isolates this window from the game renderer.
- Both renderers use `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`; the game renderer contains the pinned hosted YAW build while the trusted window loads no game or module code.
- The game renderer can read redacted distribution status and ask main to open
  the trusted Pear Desktop settings window. It cannot mutate update or peer
  settings itself.
- The separate host-settings window controls update preference, explicit
  opt-in peer availability, refresh, and application of a ready update. It
  loads neither YAW nor executable mods and has a unique non-persistent
  partition.
- The worker joins the release discovery key as an update client when updates
  are enabled and as a serving peer only after the player opts in. Serving is
  best-effort while the app is open; an operator-run `pear seed` remains the
  availability anchor.

## Selected versions

| Component | Version |
| --- | --- |
| Official Pear Electron template | `ad23048ae2a02ee9a0961c280e795da66a08d77d` |
| Electron | `40.10.1` |
| Pear Runtime | `1.3.1` |
| Corestore | `7.12.0` |
| Hyperswarm | `4.17.0` |
| Electron Forge | `7.11.2` |
| Pear AppImage maker | `2.0.0` |
| Framed Stream | `1.0.1` |
| Forge universal/prune prebuild plugins | `1.0.0` / `1.0.1` |
| Pear CLI platform validated on this workstation | `3.0.1` |
| Node validated on this workstation | `24.14.1` |
| Global and worker Bare validated on this workstation | `1.30.3` |
| Pinned YAW commit | See `yaw-source.json` |

`package-lock.json` is authoritative for the installed dependency graph.
The four Pear/Electron packaging versions above exactly match the current
official template lock at the recorded template commit.

## Prerequisites

- Linux x64 or another architecture supported by the selected Electron and Pear packages.
- Node.js and npm (validated here with Node.js 24.14.1 and npm 11.16.0).
- A graphical desktop capable of running Electron.
- For persistent credentials: an Electron-supported Linux secret service/keyring. GNOME Keyring, KWallet, or another compatible libsecret backend must be unlocked and available.

Only the current Pop!_OS fallback workstation is validated in this phase. Other distributions and desktop/keyring combinations are not yet claimed as supported.

## Install and develop

```sh
npm install
YAW_CORE_PATH=../you-are-wild npm run sync:yaw
npm run check
npm start
```

`npm start` synchronizes YAW before launching. `npm run start:no-sync` is available only when the checked renderer manifest is already current.

Runtime logs are written to the terminal that launched `npm start`. The provider broker never logs authorization headers or credentials. Pear worker stderr is sanitized and prefixed with `Pear worker:`.

The normal development command passes `--no-updates`, so local code is not
replaced while it is being edited. To exercise the configured release line in
a packaged build, use the AppImage produced by `npm run make`.

## Deterministic YAW synchronization

`yaw-source.json` pins the exact canonical game commit and expected version.

```sh
YAW_CORE_PATH=../you-are-wild npm run sync:yaw
npm run verify:yaw
```

Synchronization:

1. requires the exact pinned commit and a clean YAW tree;
2. runs the hosted renderer build;
3. copies only the generated HTML and three external atlas assets;
4. records byte sizes and SHA-256 hashes;
5. fails verification on version, commit, path, size, or hash drift.

The generated `renderer/vendor/yaw/` directory is ignored. It is recreated before development and packaging rather than maintained as an uncontrolled source copy.

## Native saves

The renderer supplies a bounded `.yawsave` envelope containing the existing binary YAW save. Electron main validates the schema, slot, canonical base64 encoding, size, extension, and selected dialog result before writing. Import returns content and a display filename, never a native path. YAW then validates the binary through `Binary.loadGame()` before storage.

Provider credentials are outside YAW save state and cannot enter save exports.

## Secure credentials

Provider metadata is stored separately from encrypted credentials. The game
renderer requests configuration with only an opaque profile ID. Electron main
then opens a modal, fixed local credential-entry window in a unique
non-persistent session partition. The key travels only across that window's
sender-bound preload IPC to main and is never sent through the game preload.
Persistent secrets use Electron `safeStorage` only when encryption is
available and the selected backend is not `basic_text`.

Provider profiles can be renamed and their model, protocol, timeout, token
ceiling, reasoning, temperature, organization, or project settings can be
edited without returning the credential to the renderer. Changing an endpoint
first deletes its session or encrypted credential, preventing an existing key
from being redirected to a new origin. Removing a profile permanently deletes
both its metadata and associated credential record. A trusted credential window
is also bound to the exact profile settings it displayed; if those settings
change while the window is open, submission is rejected and the player must
review the current endpoint in a newly opened window.

If secure persistence is unavailable, the host rejects “remember securely.” The player can:

- uncheck it and use the credential for the current process session;
- configure and unlock a compatible keyring/secret service;
- use an unauthenticated local loopback endpoint.

Plaintext authenticated endpoints are rejected. HTTPS remote endpoints are fixed-origin, redirects are blocked, request timeouts and response sizes are bounded, and only sanitized text/model/usage diagnostics return to the renderer.

### Demonstrate the credential boundary

With a compatible Linux keyring unlocked, run:

```sh
npm run demo:credential-boundary
```

This launches the real sandboxed game renderer and the separate trusted
credential-entry renderer. It saves a random throwaway credential through the
trusted window while the game renderer remains alive, verifies that the two
windows use different renderer processes, then probes the game surface as
module code could. It proves that the game renderer never receives the key,
that only redacted state returns, that plaintext is absent from renderer
storage and host files, and that a restarted main-process store can still
decrypt it for broker use.

The sanitized attestation is written to
`out/security/credential-boundary-demo.json`. It contains no credential,
credential hash, ciphertext, or credential path. See
[`docs/credential-boundary-demonstration.md`](docs/credential-boundary-demonstration.md)
for the precise claim and threat boundary.

## Tests

```sh
npm test
npm run verify:yaw
npm run check
```

The suite covers both exact preload allowlists, trusted-window sender and
profile-ID isolation, negative secret/IPC/file surfaces, sender validation,
profile update/removal lifecycle, endpoint-change credential invalidation and
trusted-window profile-change rejection,
save bounds, encrypted credential custody, Linux `basic_text` refusal,
provider URL and redirect rules, response sanitization, renderer security
flags, renderer hashes, and worker startup.

## Linux package

Build the unpacked application:

```sh
npm run package
```

Build the AppImage:

```sh
npm run make
```

Forge writes build output under `out/`. The AppImage maker places the distributable below `out/make/`.

This phase does not include code signing. Test the AppImage on a clean Linux VM before broader distribution.

## Pear deployment and seeding

`package.json#upgrade` contains the project’s current staging release line:

```text
pear://xppppuik8h7kyn7qbf5mukh38s9n3tx1scx4p1r5sqxaio9zjz8o
```

This is a developer-team stage line created with `pear touch`, not a
production provisioned multisig release. `pear.json` therefore remains absent;
production quorum and key custody are a separate milestone.

Build, inspect, stage, and seed with:

```sh
npm run make
npm run pear:build
npm run pear:stage:dry
npm run pear:stage
npm run pear:info
npm run pear:seed
```

`pear:build` copies the versioned Forge artifact to the exact
`You Are Wild.AppImage` input name required by Pear v3, then writes a
deterministic deployment tree outside the source repository at
`../you-are-wild-pear-deploy-0.1.1`. Override it only with an explicit
outside-repository path:

```sh
YAW_PEAR_DEPLOY_PATH=/absolute/outside/path npm run pear:build
```

`pear:stage:dry` shows the intended release-drive delta without publishing.
`pear:stage` appends that tree to the configured release drive. `pear:seed`
is a foreground operator process; keep at least one trusted, always-online
instance running for dependable availability. More seeders improve
availability.

Version `0.1.1` is staged at length `5`. Cross-machine installation was
validated from the Pop!_OS seeder to a Fedora 41 x64 host running Pear `3.0.1`:
the remote discovered one peer, downloaded the AppImage from this release
link, and installed the exact `0.1.1` artifact. Its SHA-256 matched the local
build. A preliminary same-host install had timed out, so cross-machine
validation remains the meaningful distribution check.

In the application, **Settings → AI & Integrations → Pear Desktop** opens the
trusted host-owned window:

- **Receive peer-to-peer updates** follows the configured release line after
  the next restart.
- **Help keep this release available while the app is open** is off by default
  and explicitly opts the app into announcing and serving locally cached
  release blocks.
- **Connected peers** is a live count from the Bare worker, not a promise that
  every release block is locally available.

The in-app setting stops when the app closes and is not a replacement for the
operator seeder. No Pear command execution, arbitrary release key, or swarm
control is exposed to the game renderer.

The current development AppImage still uses default Electron branding because
a canonical square You Are Wild application icon has not been selected. Before
public distribution, add the final Linux icon under `build/`, configure it in
Forge and the AppImage maker, and rerun the clean-VM launch check.

To remove a development checkout, close the app and remove this repository and its generated `out/` directory. Electron user data is stored under the platform application-data directory for `You Are Wild`; remove that directory separately only if you also intend to delete local profiles and encrypted credentials.

## Current non-goals

Not implemented:

- unattended background seeding while the application is closed;
- production Pear provisioning, multisig release quorum, or code signing;
- Hypercore/Corestore application data;
- Omega or other mesh sidecars;
- cloud saves, marketplace services, payments, entitlements, or multiplayer;
- Windows, macOS, Android, code signing, or generalized native plugins;
- a hostile-code-complete mod sandbox.

The next recommended milestone is production Pear provisioning and multisig
release governance, followed by clean-VM installation/update validation. It
remains independent of Omega or any mesh bridge.

## Official Pear references

- [Pear desktop application architecture](https://docs.pears.com/explanation/pear-desktop-architecture/)
- [Workers and the Bare IPC contract](https://docs.pears.com/explanation/workers/)
- [Pear Runtime API](https://docs.pears.com/reference/pear/runtime/)
- [Pear CLI](https://docs.pears.com/reference/pear/cli/)
- [Pear application configuration](https://docs.pears.com/reference/pear/configuration/)
- [Build desktop distributables](https://docs.pears.com/how-to/operate-an-app/build-and-package/build-desktop-distributables/)
- [Manual deployment](https://docs.pears.com/how-to/operate-an-app/manual-deployment/deployment/)
- [Storage and distribution](https://docs.pears.com/explanation/storage-and-distribution/)
