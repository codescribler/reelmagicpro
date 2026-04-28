import { spawn } from 'child_process';
import ffprobeStatic from 'ffprobe-static';
import type { SourceMeta } from '../../shared/types';

export async function probeVideo(filePath: string): Promise<SourceMeta> {
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration:format=duration',
    '-of', 'json',
    filePath,
  ];
  const out = await runProbe(ffprobeStatic.path, args);
  const data = JSON.parse(out);
  const stream = data.streams?.[0];
  if (!stream) throw new Error('No video stream found');
  const [num, den] = String(stream.r_frame_rate).split('/').map(Number);
  const fps = num && den ? num / den : 30;
  const duration = parseFloat(stream.duration ?? data.format?.duration ?? '0');
  if (!duration) throw new Error('Could not determine duration');
  return {
    path: filePath,
    width: stream.width,
    height: stream.height,
    fps,
    duration,
  };
}

function runProbe(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exit ${code}: ${stderr}`));
    });
  });
}
