#!/usr/bin/env bash
# One-time setup on the Mac: makes Atlas's signing certificate, keeps a backup in
# ~/.tauri/atlas-signing, and saves it in the protected signing environment.
# Needs the gh CLI signed in to an account that can manage the repo's secrets.
set -euo pipefail
policy=team
case "${1:-}" in
  --solo) policy=solo ;;
  "") ;;
  *) echo "Usage: $0 [--solo]" >&2; exit 2 ;;
esac
repo=khaneilcampbell/ai-ops-atlas
dir="$HOME/.tauri/atlas-signing"
umask 077
# Fail before creating/uploading keys unless the environment is already protected.
python3 "$(dirname "$0")/../ops/security/audit.py" --repo "$repo" --require-signing-environment --signing-policy "$policy"
if [ -f "$dir/atlas-signing.p12" ]; then
  echo "Reusing the certificate already in $dir"
else
  "$(dirname "$0")/macos-signing-cert.sh" "$dir"
fi
base64 < "$dir/atlas-signing.p12" | tr -d '\n' | gh secret set MACOS_SIGNING_CERT --repo "$repo" --env macos-signing
gh secret set MACOS_SIGNING_CERT_PASSWORD --repo "$repo" --env macos-signing < "$dir/atlas-signing.password"
echo "Saved MACOS_SIGNING_CERT and MACOS_SIGNING_CERT_PASSWORD in $repo environment macos-signing."
