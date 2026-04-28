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

See `docs/superpowers/specs/2026-04-28-reelmagic-video-editor-design.md` for the design.
