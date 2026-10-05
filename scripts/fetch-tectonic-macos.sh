#!/usr/bin/env bash
set -euo pipefail

# Tectonic 0.17.0, MIT licensed. Run before `tauri build` on each macOS architecture.
# The release binary is deliberately fetched during packaging, not committed to Git.
version="0.17.0"
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/apps/desktop/src-tauri/binaries"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$dest"
fetch() {
  local target="$1" out="$2" url="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/tectonic-${version}-${target}.tar.gz"
  local folder="$tmp/$target"; mkdir -p "$folder"
  curl --fail --location --silent --show-error "$url" -o "$folder/tectonic.tar.gz"
  tar -xzf "$folder/tectonic.tar.gz" -C "$folder"
  local bin="$(find "$folder" -type f -name tectonic -perm -u+x | head -1)"; test -n "$bin"
  cp "$bin" "$out"; chmod 755 "$out"
}
if [ "${UNIVERSAL:-0}" = "1" ]; then
  fetch aarch64-apple-darwin "$tmp/tectonic-arm64"
  fetch x86_64-apple-darwin "$tmp/tectonic-x64"
  lipo -create "$tmp/tectonic-arm64" "$tmp/tectonic-x64" -output "$dest/tectonic"
else
  case "$(uname -m)" in arm64) target=aarch64-apple-darwin ;; x86_64) target=x86_64-apple-darwin ;; *) echo "Unsupported macOS architecture" >&2; exit 1 ;; esac
  fetch "$target" "$dest/tectonic"
fi
echo "Bundled Tectonic ${version} at $dest/tectonic"
