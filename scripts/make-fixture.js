const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'tests', 'fixtures', 'test-pattern.mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) {
  console.log('Fixture exists, skipping.');
  process.exit(0);
}
const args = [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=5:size=320x240:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k',
  '-shortest',
  out,
];
const child = spawn(ffmpeg, args, { stdio: 'inherit' });
child.on('close', code => process.exit(code));
