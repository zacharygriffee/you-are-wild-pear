# Credential boundary demonstration

Run the Electron-backed proof from the host repository:

```sh
npm run demo:credential-boundary
```

The command creates a random throwaway provider credential and temporary
credential directory. It then:

1. starts the sandboxed game renderer with the production preload;
2. creates only non-secret provider metadata from that renderer;
3. asks Electron main to open the dedicated trusted credential window using an
   opaque profile ID;
4. enters the key only in that separate renderer process;
5. persists it with the real Electron `safeStorage` backend;
6. keeps the original game renderer alive and probes it as executable module
   code could;
7. confirms the two windows use different renderer process IDs;
8. recursively inspects the public game bridge and attempts the known secret/raw
   IPC/file escape-hatch names;
9. confirms Node, Electron, and raw IPC globals are absent;
10. confirms profile snapshots and game-renderer storage contain no credential;
11. confirms neither host file contains the plaintext credential;
12. creates a fresh main-process credential-store instance and proves that only
    the broker-side resolver can decrypt the saved credential.

On success it prints a redacted attestation and writes the same data to:

```text
out/security/credential-boundary-demo.json
```

The report contains backend/runtime names and pass/fail facts. It contains no
credential, credential hash, encrypted blob, or temporary credential path. The
temporary credential directory is deleted before the process exits.

On Linux the proof intentionally fails if Electron reports no encryption or
selects `basic_text`. That is the required safe failure: this host must not
claim secure persistence without an OS-backed secret service such as
GNOME/libsecret or KWallet.

## What this proves

Before, during, and after setup, executable code in the YAW renderer can see
only:

- an opaque profile ID;
- display-safe provider metadata;
- `credentialPresent` and secure-storage status;
- bounded provider test/generate operations and sanitized results.

It cannot retrieve the plaintext credential, encrypted credential record,
credential file, Electron object, raw IPC primitive, or Node filesystem API.
Electron main can decrypt the credential solely for the provider broker.

## Trusted entry window

The credential entry renderer loads three fixed local assets and a separate
preload. It has an in-memory session partition, no game or module scripts, no
Node integration, no DevTools, denied permissions and navigation, and only
three bridge methods: read redacted context, submit a credential, or cancel.
The profile ID remains in Electron main and is not exposed to this renderer.

This closes the setup-time observation gap for game modules. It does not attempt
to defend against a compromised Electron main process, operating system,
keylogger, debugger, or malicious replacement of the packaged application.
