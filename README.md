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

Electron main
    -> PearRuntime.run(workers/main.js)
        -> Bare worker
            -> runtime ready/status only in this phase
```

This phase deliberately uses the documented minimal static
`PearRuntime.run()` worker API. The worker receives its host-selected storage
directory as `Bare.argv[2]` and sends one small status message through
`Bare.IPC`. It does not yet construct a worker-owned `new PearRuntime(...)`
instance because there is no application release-line `upgrade` link and OTA
updates are out of scope. The full constructor/updater shape belongs to the
later distribution milestone.

Responsibilities:

- Electron main owns native dialogs, filesystem writes, provider HTTP authentication, credential encryption, navigation restrictions, and worker lifecycle.
- Preload exposes only the documented semantic methods. It has no raw IPC, Electron, shell, arbitrary file, or secret-reading API.
- The renderer is the pinned hosted YAW build with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- The Bare worker reports Pear availability. Seeding and replication are deliberately not configured.

## Selected versions

| Component | Version |
| --- | --- |
| Official Pear Electron template | `ad23048ae2a02ee9a0961c280e795da66a08d77d` |
| Electron | `40.10.1` |
| Pear Runtime | `1.3.1` |
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

Provider metadata is stored separately from encrypted credentials. Persistent secrets use Electron `safeStorage` only when encryption is available and the selected backend is not `basic_text`.

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

This launches a real sandboxed Electron renderer, saves a random throwaway
credential through the production preload and `CredentialStore`, destroys that
setup renderer, and launches a fresh renderer that probes the public surface as
module code could. It proves that the renderer receives only redacted state,
that the credential is absent from both renderer storage and plaintext host
files, and that a restarted main-process store can still decrypt it for broker
use.

The sanitized attestation is written to
`out/security/credential-boundary-demo.json`. It contains no credential,
credential hash, ciphertext, or credential path. See
[`docs/credential-boundary-demonstration.md`](docs/credential-boundary-demonstration.md)
for the precise claim and its honest setup-time limitation.

## Tests

```sh
npm test
npm run verify:yaw
npm run check
```

The suite covers the preload allowlist, negative secret/IPC/file surfaces, sender validation, save bounds, encrypted credential custody, Linux `basic_text` refusal, provider URL and redirect rules, response sanitization, renderer security flags, renderer hashes, and worker startup.

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

The repository intentionally has no `package.json` `upgrade` field yet.
Current Pear configuration stores application staging fields in `package.json`;
`pear.json` is reserved for a future multisig quorum configuration. Do not add
a placeholder release link or a custom distribution-status object there.
Runtime status remains the bounded
`{ mode: "not-configured" }` worker response until a real release line is
created.

The current development AppImage still uses default Electron branding because
a canonical square You Are Wild application icon has not been selected. Before
public distribution, add the final Linux icon under `build/`, configure it in
Forge and the AppImage maker, and rerun the clean-VM launch check.

To remove a development checkout, close the app and remove this repository and its generated `out/` directory. Electron user data is stored under the platform application-data directory for `You Are Wild`; remove that directory separately only if you also intend to delete local profiles and encrypted credentials.

## Current non-goals

Not implemented:

- Pear staging, provisioning, seeding, swarm joins, or background replication;
- Hypercore/Corestore application data;
- Omega or other mesh sidecars;
- cloud saves, marketplace services, payments, entitlements, or multiplayer;
- Windows, macOS, Android, code signing, or generalized native plugins;
- a hostile-code-complete mod sandbox.

The next recommended milestone is consent-aware Pear application staging and seeding, independent of Omega or any mesh bridge.

## Official Pear references

- [Pear desktop application architecture](https://docs.pears.com/explanation/pear-desktop-architecture/)
- [Workers and the Bare IPC contract](https://docs.pears.com/explanation/workers/)
- [Pear Runtime API](https://docs.pears.com/reference/pear/runtime/)
- [Pear application configuration](https://docs.pears.com/reference/pear/configuration/)
- [Build desktop distributables](https://docs.pears.com/how-to/operate-an-app/build-and-package/build-desktop-distributables/)
