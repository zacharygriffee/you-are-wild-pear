# Credential boundary demonstration

Run the Electron-backed proof from the host repository:

```sh
npm run demo:credential-boundary
```

The command creates a random throwaway provider credential and temporary
credential directory. It then:

1. starts a sandboxed Electron renderer with the production preload;
2. submits the credential through the same bounded setup method used by the
   core provider UI;
3. persists it with the real Electron `safeStorage` backend;
4. destroys the entire setup renderer;
5. starts a fresh renderer that represents executable module code;
6. recursively inspects the public bridge and attempts the known secret/raw
   IPC/file escape-hatch names;
7. confirms Node, Electron, and raw IPC globals are absent;
8. confirms profile snapshots and renderer storage contain no credential;
9. confirms neither host file contains the plaintext credential;
10. creates a fresh main-process credential-store instance and proves that only
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

After setup, executable code in the YAW renderer can see only:

- an opaque profile ID;
- display-safe provider metadata;
- `credentialPresent` and secure-storage status;
- bounded provider test/generate operations and sanitized results.

It cannot retrieve the plaintext credential, encrypted credential record,
credential file, Electron object, raw IPC primitive, or Node filesystem API.
Electron main can decrypt the credential solely for the provider broker.

## Honest limit

This is a post-save custody proof, not a hostile-code-complete renderer
sandbox. During an explicit core-owned setup or replacement action, the player
types a credential into the renderer and passes it transiently over the bounded
bridge. Executable module code running at that exact moment may be able to
inspect renderer values or UI events.

The current policy therefore treats installed modules as trusted-local code and
does not expose any credential-management method through `MODS`. A later
hardening milestone can move credential entry into a dedicated trusted window
that never loads YAW or module code. That is required before claiming protection
from a deliberately malicious module during credential entry.
