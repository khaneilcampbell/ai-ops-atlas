# CI signing and release permissions

Ordinary pull-request checks and manual app builds use read-only tokens and no signing secrets. The app is compiled on a runner without signing keys. A separate, fresh signing runner downloads only that workflow run's artifact, after frontend, Rust and dependency-audit jobs succeed. Signing is restricted to pushes to main in the canonical repository.

The `macos-signing` environment must restrict deployments to the main branch, disable administrator bypass, and omit required reviewers for the owner's explicit solo configuration. Required checks and pull requests protect main; rolling updates remain automatic. This does not provide independent approval. Restrict workflow changes through review whenever a collaborator becomes available.

Store these three keys only in that environment:

- `MACOS_SIGNING_CERT`
- `MACOS_SIGNING_CERT_PASSWORD`
- `TAURI_SIGNING_PRIVATE_KEY`

Migrate the existing keys without generating new identities. Changing the updater key would strand installed clients. Verify the environment secret names exist, then remove all three repository-level copies as part of activating this workflow. `scripts/setup-macos-signing.sh` now targets the protected environment; it does not rotate the updater key.

The signing job installs the pinned lockfile's CLI with lifecycle scripts disabled before keys enter the environment. It does not restore build caches, compile repository code or receive a write token. Keys are exposed only to the signing step; the temporary keychain is removed on exit. This still trusts the reviewed main commit, the signing tool, pinned actions and GitHub-hosted runner. Environment approval and workflow review remain essential.

Only a fresh publishing job gets `contents: write`. It has no source checkout, does not install dependencies or execute the application, and publishes signed files downloaded from the same run. A version check rejects an older/equal rolling update if approval order differs from build order. The rolling `main-build` release must already exist; lookup and asset download errors fail closed.

Version-tag releases also build with read-only credentials and publish on a separate runner. The tagged commit must be reachable from main. Their existing universal bundle format remains unchanged; they do not receive rolling-updater signing keys.

Workflow security tests enforce the key job boundaries, action pins, validation dependencies and checkout credential settings. Real macOS signing must still be exercised by a main build after merge and environment approval. Fork pull requests and branch dispatches must never request this environment.
