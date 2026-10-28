#!/usr/bin/env bash
# Makes the self-signed code-signing certificate that CI signs Atlas with, so every
# self-update keeps the same identity and the Keychain's "Always Allow" sticks.
# Writes <out>/atlas-signing.p12 and <out>/atlas-signing.password. Nothing is uploaded here.
#   scripts/macos-signing-cert.sh <out-dir>
set -euo pipefail
out=${1:?usage: macos-signing-cert.sh <out-dir>}
mkdir -p "$out"
umask 077
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/cert.cnf" <<'CNF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = AI Ops Atlas Signing
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
  -config "$tmp/cert.cnf" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
openssl rand -hex 24 > "$out/atlas-signing.password"
# 3DES/SHA1 packaging, the only kind macOS `security import` reads.
openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "AI Ops Atlas Signing" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout "file:$out/atlas-signing.password" -out "$out/atlas-signing.p12"
echo "Wrote $out/atlas-signing.p12"
