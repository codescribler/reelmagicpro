const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

// Renders a synthetic test pattern at the given size + audio frequency to
// the given path. Used to give the integration tests a second, visually
// distinguishable fixture for multi-source export tests.
function renderFixture({ outPath, size, freq, duration = 5, rate = 30 }) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(outPath)) {
      console.log(`Fixture exists, skipping: ${path.basename(outPath)}`);
      resolve();
      return;
    }
    const args = [
      '-y',
      '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=${size}:rate=${rate}`,
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${duration}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest',
      outPath,
    ];
    const child = spawn(ffmpeg, args, { stdio: 'inherit' });
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });
}

async function main() {
  const dir = path.join(__dirname, '..', 'tests', 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  // Primary fixture — used by every integration test that needs source video.
  await renderFixture({
    outPath: path.join(dir, 'test-pattern.mp4'),
    size: '320x240', freq: 440,
  });
  // Secondary fixture for the multi-source export test. Different size +
  // tone makes the concatenated output visually and aurally verifiable
  // (and the concat normalisation has to rescale this part).
  await renderFixture({
    outPath: path.join(dir, 'test-pattern-b.mp4'),
    size: '480x270', freq: 660,
  });
}
main().catch(e => { console.error(e); process.exit(1); });
