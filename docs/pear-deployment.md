# Pear deployment and peer availability

## Release model

You Are Wild Pear currently uses this staging release line:

```text
pear://xppppuik8h7kyn7qbf5mukh38s9n3tx1scx4p1r5sqxaio9zjz8o
```

It was created with `pear touch`. This is appropriate for development and
pre-production testing. It is not a production multisig release: the
repository intentionally has no `pear.json` until the project selects
maintainers, quorum, and key-custody procedures.

## Build and stage

From the host repository:

```sh
YAW_CORE_PATH=../you-are-wild npm run make
npm run pear:build
npm run pear:stage:dry
npm run pear:stage
npm run pear:info
```

The steps are intentionally separate:

1. Forge creates the Linux AppImage under `out/make/`.
2. The release helper copies Forge's versioned artifact to Pear's required
   `You Are Wild.AppImage` input name, then `pear build` creates a deployment
   tree outside the source repository.
3. The dry run displays the exact staging delta.
4. `pear stage` appends the release to its Hypercore-backed release drive.
5. `pear info` displays the current staged release metadata.

The release helper accepts no link from the command line. It always reads the
pinned `package.json#upgrade`, and it refuses to put deployment output inside
the source tree.

The Linux AppImage must preserve the product-name basename throughout Forge
packaging. Pear installation expects both `You Are Wild.AppImage` and
`You Are Wild.desktop`; overriding Forge's executable name causes the desktop
entry basename to drift and makes `pear install` reject the otherwise valid
download.

## Operator seeding

Run:

```sh
npm run pear:seed
```

This is a foreground service. Keep it running on at least one trusted,
always-online machine. A developer smoke test that starts and then stops the
command proves only that the seeder can announce the release; it does not
provide ongoing availability.

Never copy stage-writer or future production signer material onto a public
seeding machine. The seed command needs the public release link, not a signing
secret.

### Current validation result

On 2026-07-28, version `0.1.1` was staged at:

```text
pear://0.5.xppppuik8h7kyn7qbf5mukh38s9n3tx1scx4p1r5sqxaio9zjz8o
```

A Fedora 41 x64 host running Pear `3.0.1` installed it from the unversioned
release link while the Pop!_OS build host seeded. Pear reported one peer,
version `0.1.1`, and the versioned link above. The installed AppImage had the
same SHA-256 as the build artifact:

```text
1e825f2ab5b68ff05641a6b21c2951f23d3fafb5f39f708233eeac97e45bffd7
```

This confirms remote discovery, block transfer, and installation finalization.
An interactive GUI launch and OTA replacement from `0.1.1` to a later version
remain separate tests.

## Player-controlled peer availability

The packaged host provides a trusted **Pear Desktop** settings window. It is a
separate sandboxed renderer that contains no game or mod code.

Defaults:

```text
receive updates: enabled
help peer availability: disabled
```

When peer availability is enabled, the Bare worker joins the release-drive
discovery key as a server and serves blocks already present in its local
Corestore. If receiving updates is also enabled, the updater can populate that
cache. Participation stops when the application closes.

This deliberately does not:

- seed while the app is closed;
- expose Hyperswarm, Corestore, Pear Runtime, or command execution to YAW;
- let a mod toggle participation;
- accept an arbitrary discovery key;
- integrate application save data, Omega, or other mesh protocols.

## Security boundary

```text
YAW or executable mod
    -> read redacted status
    -> request trusted settings window

trusted host-settings renderer
    -> fixed sender-validated IPC
        -> Electron main preferences
        -> Bare worker fixed commands
            -> Pear updater and release-drive discovery
```

The game preload does not expose update, apply, seed, swarm, or peer mutation
methods. Preferences are stored with mode `0600`; peer contribution is an
explicit opt-in.

## Production follow-up

Before calling the release production-ready:

1. choose maintainers and signer quorum;
2. provision a production Pear application;
3. establish offline or otherwise protected signer-key custody;
4. run redundant always-online seeders;
5. test fresh installation and OTA replacement in clean supported Linux VMs;
6. add code signing and final application branding.
