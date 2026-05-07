# ReelMagic

Desktop video editor: load an `.mp4`, define clips, zoom and slow each independently, arrange them into a sequence, export individual clips or the full sequence as `.mp4`.

## Develop

```
npm install
npm run dev
```

## Test

```
npm test                  # unit tests
npm run test:integration  # integration tests (uses ffmpeg)
```

## Package

```
npm run package           # produces installer in dist-app/
```

## Release

Releases are published to GitHub via the `Release` workflow. Pushing a `vX.Y.Z`
tag triggers a Windows build and uploads `ReelMagic-Setup-X.Y.Z.exe`,
`latest.yml`, and the blockmap as a **draft** release. Installed copies of the
app auto-update from the latest non-draft release on next launch.

**Windows-only for now.** macOS builds are not produced. Adding them is
straightforward (`macos-latest` job + `.icns` icon) but not worth doing until we
enrol in the Apple Developer Program ($99/yr) — without code signing **and**
notarization, macOS auto-update does not work and Gatekeeper blocks the app on
first launch. See "Adding macOS later" below.

1. Bump `version` in `package.json` (and run `npm install` so the lockfile updates).
2. Commit on `master` and push.
3. Tag and push:
   ```
   git tag v0.1.3
   git push origin v0.1.3
   ```
4. Wait for the workflow to finish (`gh run watch` or check the Actions tab).
5. Publish the draft release — `electron-updater` ignores drafts:
   ```
   gh release edit v0.1.3 --repo codescribler/reelmagicpro --draft=false
   ```

### Notes

- **Tag must match `package.json` version.** electron-builder reads the
  version from `package.json`, not the tag — a mismatch produces an installer
  whose version doesn't match its tag and breaks the auto-updater.
- **All electron-builder config lives in `electron-builder.yml`.** Do not add
  a `build` field to `package.json` — it silently overrides the yml.
- **Auto-update only works from a non-draft release.** Drafts are invisible
  to `electron-updater`.
- **Local dry-run** (uploads a draft straight from your machine — useful before
  the first release of a new branch):
  ```
  $env:GH_TOKEN = "<PAT with repo scope>"
  npm run release
  ```

### Adding macOS later

When ready, you'll need:

- Apple Developer Program enrolment ($99/yr).
- A "Developer ID Application" certificate exported as `.p12`, stored as
  `MAC_CERTS` (base64) and `MAC_CERTS_PASSWORD` repo secrets.
- An app-specific password from appleid.apple.com, plus your Apple ID email and
  Team ID, stored as `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- A `build/icon.icns` (1024×1024 multi-resolution). Generate from the existing
  PNG with `iconutil` on a Mac, or `electron-icon-builder` cross-platform.
- A `macos-latest` job in `.github/workflows/release.yml` that runs the same
  `npm run release` with those env vars set.

Without notarization, users see a Gatekeeper warning ("Apple cannot check it
for malicious software") on first launch, and `electron-updater` refuses to
apply updates. Sign-without-notarize is all pain and no gain — go straight to
notarized when you do this.

See `docs/superpowers/specs/2026-04-28-reelmagic-video-editor-design.md` for the design.
