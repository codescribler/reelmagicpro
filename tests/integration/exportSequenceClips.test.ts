import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportSequenceClips } from '../../src/main/ffmpeg/exportSequenceClips';
import { probeVideo } from '../../src/main/ffmpeg/probe';
import type { Clip, SourceVideo, ExportProgress } from '../../src/shared/types';

const ffmpeg = require('ffmpeg-static') as string;
jest.setTimeout(60000);
let dir: string;
let sources: SourceVideo[];
let clips: Clip[];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-individual-'));
  sources = [];
  for (const [id, size, color] of [['a', '320x240', 'red'], ['b', '288x160', 'blue']]) {
    const input = path.join(dir, `${id}.mp4`);
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:r=30:d=0.5`,
      '-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=48000', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    sources.push({ id, ...await probeVideo(input) });
  }
  clips = sources.map(source => ({ id: source.id, sourceId: source.id, name: 'Same: clip?',
    in: 0, out: 0.3, speed: 1, focusMarkers: [],
    zoom: { x: 0, y: 0, width: source.width, height: source.height } }));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const args = () => ({ runId: `batch-${Date.now()}`, clips, sources,
  sequence: [{ clipId: 'b' }, { clipId: 'a' }, { clipId: 'b' }],
  directory: dir, sequenceName: 'CON', format: 'both' as const });

test('exports both formats in sequence order with distinct names and each clip source', async () => {
  const progress: ExportProgress[] = [];
  const result = await exportSequenceClips({ ...args(), onProgress: p => progress.push(p) });
  expect(result.ok).toBe(true);
  expect(path.basename(result.outputDirectory!)).toBe('_CON');
  expect(result.outputPaths!.map(file => path.basename(file))).toEqual([
    '01 - Same_ clip__standard.mp4', '01 - Same_ clip__instagram.mp4',
    '02 - Same_ clip__standard.mp4', '02 - Same_ clip__instagram.mp4',
    '03 - Same_ clip__standard.mp4', '03 - Same_ clip__instagram.mp4',
  ]);
  const sizes = await Promise.all(result.outputPaths!.map(file => probeVideo(file)));
  expect(sizes.map(s => [s.width, s.height])).toEqual([
    [288, 160], [1080, 1920], [320, 240], [1080, 1920], [288, 160], [1080, 1920],
  ]);
  expect(progress.every(p => Number.isFinite(p.percent))).toBe(true);
  expect(progress.every((p, i) => i === 0 || p.percent >= progress[i - 1].percent)).toBe(true);
  expect(progress.at(-1)).toMatchObject({ phase: 'done', percent: 100, totalItems: 6 });
});

test.each(['standard', 'instagram'] as const)('supports %s alone and a safe unique output folder', async format => {
  const existing = path.join(dir, 'Highlights');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'keep');
  const result = await exportSequenceClips({ ...args(), format, sequenceName: 'Highlights. ',
    sequence: [{ clipId: 'a' }] });
  expect(result.ok).toBe(true);
  expect(path.dirname(result.outputDirectory!)).toBe(dir);
  expect(result.outputDirectory).not.toBe(existing);
  expect(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8')).toBe('keep');
  expect(result.outputPaths).toHaveLength(1);
  const video = await probeVideo(result.outputPaths![0]);
  expect([video.width, video.height]).toEqual(format === 'standard' ? [320, 240] : [1080, 1920]);
});

test('cancelling stops subsequent files and retains completed exports', async () => {
  const ctrl = new AbortController();
  const result = await exportSequenceClips({ ...args(), format: 'standard', signal: ctrl.signal,
    onProgress: p => { if (p.percent >= 100 / 3) ctrl.abort(); } });
  expect(result).toMatchObject({ ok: false, error: 'Cancelled' });
  expect(result.outputPaths).toHaveLength(1);
  expect(fs.existsSync(result.outputPaths![0])).toBe(true);
  expect(fs.readdirSync(result.outputDirectory!)).toHaveLength(1);
});

test('failure identifies the clip and retains previously completed files', async () => {
  const result = await exportSequenceClips({ ...args(), format: 'standard',
    sources: [sources[0], { ...sources[1], path: path.join(dir, 'missing.mp4') }],
    sequence: [{ clipId: 'a' }, { clipId: 'b' }] });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('02 - Same_ clip_.mp4');
  expect(result.outputPaths).toHaveLength(1);
  expect(fs.existsSync(result.outputPaths![0])).toBe(true);
});

test('rejects invalid batches before creating any output folders', async () => {
  const before = fs.readdirSync(dir);
  for (const overrides of [{ sequence: [] }, { sequence: [{ clipId: 'missing' }] }, { sources: [] },
    { format: 'invalid' as 'standard' }]) {
    const result = await exportSequenceClips({ ...args(), ...overrides });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }
  expect(fs.readdirSync(dir)).toEqual(before);
});
