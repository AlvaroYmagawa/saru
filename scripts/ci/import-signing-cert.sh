#!/usr/bin/env bash
# Puts Saru's release signing certificate (a self-signed code-signing certificate, the same one for
# every release) into a temporary keychain, and exports its identity as SARU_SIGN_IDENTITY.
# One certificate for every release keeps macOS's Accessibility grant across updates.
#   SARU_CERT_P12       base64 of the .p12
#   SARU_CERT_PASSWORD  its password
set -euo pipefail

: "${SARU_CERT_P12:?set SARU_CERT_P12}"
: "${SARU_CERT_PASSWORD:?set SARU_CERT_PASSWORD}"
dir="${RUNNER_TEMP:-$(mktemp -d)}"
keychain="$dir/saru-signing.keychain-db"
kc_pass="$(openssl rand -hex 16)"

printf '%s' "$SARU_CERT_P12" | base64 --decode > "$dir/saru-signing.p12"
security create-keychain -p "$kc_pass" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$kc_pass" "$keychain"
security import "$dir/saru-signing.p12" -k "$keychain" -P "$SARU_CERT_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kc_pass" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
rm "$dir/saru-signing.p12"

# Self-signed, so not "valid" for the system: pick it by hash, not with -v.
identity="$(security find-identity -p codesigning "$keychain" | awk '/Saru Release Signing/ {print $2; exit}')"
[[ -n "$identity" ]] || { echo "Saru Release Signing identity not found" >&2; exit 1; }
echo "SARU_SIGN_IDENTITY=$identity" >> "${GITHUB_ENV:-/dev/stdout}"
echo "SARU_SIGN_KEYCHAIN=$keychain" >> "${GITHUB_ENV:-/dev/stdout}"
