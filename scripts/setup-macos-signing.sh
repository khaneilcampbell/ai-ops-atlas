#!/usr/bin/env bash
# One-time setup on the Mac: makes Atlas's signing certificate, keeps a backup in
# ~/.tauri/atlas-signing, and saves it as the two repository secrets CI signs with.
# Needs the gh CLI signed in to an account that can manage the repo's secrets.
set -euo pipefail
repo=khaneilcampbell/ai-ops-atlas
dir="$HOME/.tauri/atlas-signing"
if [ -f "$dir/atlas-signing.p12" ]; then
  echo "Reusing the certificate already in $dir"
else
  "$(dirname "$0")/macos-signing-cert.sh" "$dir"
fi
base64 < "$dir/atlas-signing.p12" | tr -d '\n' | gh secret set MACOS_SIGNING_CERT --repo "$repo"
gh secret set MACOS_SIGNING_CERT_PASSWORD --repo "$repo" < "$dir/atlas-signing.password"
echo "Saved MACOS_SIGNING_CERT and MACOS_SIGNING_CERT_PASSWORD on $repo."
