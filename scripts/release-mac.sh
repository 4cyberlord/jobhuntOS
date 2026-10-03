#!/usr/bin/env bash
# Builds, signs, notarizes and verifies the macOS release.
#   APPLE_ID=you@icloud.com APPLE_PASSWORD=abcd-efgh-ijkl-mnop APPLE_TEAM_ID=H3TAHA3LL7 ./scripts/release-mac.sh
# APPLE_PASSWORD is an app-specific password from appleid.apple.com (never your Apple ID password).
# UNIVERSAL=0 builds for this Mac's chip only (faster); the default is a universal app (Apple Silicon + Intel).
set -euo pipefail
cd "$(dirname "$0")/.."

for v in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || { echo "Missing $v. Set it in this terminal first (see the header of this script)."; exit 1; }
done
security find-identity -v -p codesigning | grep -q "Developer ID Application" || { echo "No 'Developer ID Application' certificate in your keychain."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes: commit first so the build can be reproduced."; exit 1; }

echo "→ checks"
npm run typecheck -w @job-hunt-os/desktop
npm run test -w @job-hunt-os/api

TARGET=()
[ "${UNIVERSAL:-1}" = "1" ] && TARGET=(--target universal-apple-darwin)
echo "→ build, sign, notarize (notarization waits on Apple and can take several minutes)"
npm --workspace @job-hunt-os/desktop exec tauri build -- ${TARGET[@]+"${TARGET[@]}"}

OUT="apps/desktop/src-tauri/target/${TARGET:+universal-apple-darwin/}release/bundle"
APP=$(ls -d "$OUT"/macos/*.app | head -1); DMG=$(ls "$OUT"/dmg/*.dmg | head -1)
echo "→ verify"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=2 "$APP"
xcrun stapler validate "$APP"
echo; echo "Release ready:"; echo "  $APP"; echo "  $DMG"
