// Copies src/main/assets → dist-electron/main/assets so the compiled main
// process can resolve bundled non-TS files (fonts, etc) via paths relative
// to __dirname. tsc only emits .js files; without this, ffmpeg's drawtext
// has no font to load in dev or in the packaged build.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'src', 'main', 'assets');
const dest = path.resolve(__dirname, '..', 'dist-electron', 'main', 'assets');

if (!fs.existsSync(src)) process.exit(0);
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
