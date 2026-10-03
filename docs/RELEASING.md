# Releasing and updates

Job Hunt OS updates itself from this repository's GitHub Releases, and **the repository can stay private**. Installed apps never talk to
GitHub: they ask your own API (`/v1/desktop/update`, signed in like everything else). The API reads the latest release with a GitHub
token kept in your database and returns the update; the download is a short-lived signed link from GitHub. The app checks shortly after
launch and every few hours, and **Settings → About → Check for updates** checks on demand. **Get update** downloads the build, verifies its
signature against the public key built into the app, installs it and restarts.

### One-time: let your API read the private releases

1. GitHub → Settings → Developer settings → Fine-grained personal access tokens → **Generate new token**.
   Resource owner: you. Repository access: **Only select repositories → jobhuntOS**. Permissions: **Contents: Read-only** (Metadata is added automatically). Nothing else.
2. Put it in your repo's `.env.local` (gitignored) as `GITHUB_TOKEN=...`, then run `npx tsx apps/api/scripts/store-secrets.ts`. It is stored in the database; you can delete the line afterwards.
3. Deploy the API (`npm run build:vercel -w @job-hunt-os/api`, then `cd deploy/vercel-api && npx vercel deploy --prod`).

## One-time setup

Add these as repository secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/jobhuntos-updater.key` (the update-signing key) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | contents of `~/.tauri/jobhuntos-updater.password` |
| `APPLE_CERTIFICATE` | your *Developer ID Application* certificate exported as .p12, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the password you chose when exporting the .p12 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Charles Adu Boakye (H3TAHA3LL7)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | `H3TAHA3LL7` |

**Never lose or leak the update-signing key.** Anyone holding it can publish an update that installed apps will trust. If you lose it,
installed apps can no longer be updated automatically (they would need a manual reinstall with a new key). Back it up somewhere private.

## Shipping a new version

1. Change the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/package.json`
   (all three, same number, higher than the last release).
2. Commit, then tag and push: `git tag v1.0.1 && git push origin main v1.0.1`
3. The **Release** workflow builds a universal (Apple Silicon + Intel) app, signs and notarizes it, and publishes the release with
   `latest.json` (it appears under Releases in your private repo). The tag must equal the version in `tauri.conf.json` or the workflow stops.

Anyone signed in on an older build sees "Version X is available" and can click **Get update**.

## Building locally instead

`APPLE_ID=… APPLE_PASSWORD=… APPLE_TEAM_ID=H3TAHA3LL7 ./scripts/release-mac.sh` builds, signs, notarizes and verifies on your Mac (it reads the update-signing
key from `~/.tauri/`). Upload the resulting files to a GitHub release yourself if you go this way; the workflow above is easier.

## Note on private-repo CI cost

GitHub bills macOS runner minutes at 10x on private repositories (the free plan includes 2,000 minutes, roughly 200 macOS minutes).
A universal build with notarization takes about 15–25 minutes, so expect around 8–10 releases per month on the free plan.
Local builds with `scripts/release-mac.sh` cost nothing.
