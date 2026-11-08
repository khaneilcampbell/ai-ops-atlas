#!/usr/bin/env bash
# CI only: re-signs the built app with Atlas's self-signed certificate, so every build has
# the same code identity and the Keychain's "Always Allow" survives self-updates. Tauri
# only signs with identities macOS trusts, so it builds ad-hoc and this replaces that
# signature. If an updater archive exists it is rebuilt and re-signed to match.
# Env: MACOS_SIGNING_CERT (base64 .p12), MACOS_SIGNING_CERT_PASSWORD,
#      TAURI_SIGNING_PRIVATE_KEY (only when an updater archive is present).
set -euo pipefail
umask 077
dir=src-tauri/target/release/bundle/macos
app="$dir/Atlas.app"
tmp=$(mktemp -d)
keychain="$tmp/signing.keychain-db"
kc_pass=$(openssl rand -hex 16)
old_list=$(security list-keychains -d user | tr -d '"')
cleanup() {
  # shellcheck disable=SC2086
  security list-keychains -d user -s $old_list >/dev/null 2>&1 || true
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

echo "$MACOS_SIGNING_CERT" | base64 --decode > "$tmp/cert.p12"
security create-keychain -p "$kc_pass" "$keychain"
security set-keychain-settings "$keychain"
security unlock-keychain -p "$kc_pass" "$keychain"
# codesign only looks in keychains on the search list.
# shellcheck disable=SC2086
security list-keychains -d user -s "$keychain" $old_list
security import "$tmp/cert.p12" -k "$keychain" -P "$MACOS_SIGNING_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$kc_pass" "$keychain" >/dev/null
# Untrusted identities are still listed (just not as "valid"); sign by hash.
hash=$(security find-identity -p codesigning "$keychain" | awk '/AI Ops Atlas Signing/ {print $2; exit}')
[ -n "$hash" ] || { echo "Signing identity not found in the certificate"; exit 1; }

codesign --force --deep --options runtime --timestamp=none --keychain "$keychain" --sign "$hash" "$app"
codesign --verify --strict "$app"
codesign -d -r- "$app" 2>&1 | grep designated

archive="$dir/Atlas.app.tar.gz"
if [ -f "$archive" ]; then
  rm -f "$archive" "$archive.sig"
  tar -czf "$archive" -C "$dir" "Atlas.app"
  npx tauri signer sign "$archive" >/dev/null
  [ -f "$archive.sig" ]
fi
