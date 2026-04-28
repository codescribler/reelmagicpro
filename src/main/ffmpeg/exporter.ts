import { runFfmpeg } from './runner';
import { buildClipFfmpegArgs } from './command';
import { buildConcatFfmpegArgs, buildConcatListContents } from './concatList';
import type { Clip, SourceMeta, ExportProgress, ExportResult } from '../../shared/types';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export type ProgressCb = (p: ExportProgress) => void;

function clipDurationMs(clip: Clip): number {
  const range = clip.out - clip.in;
  return Math.max(1, Math.round((range / clip.speed) * 1000));
}

export async function exportClip(opts: {
  runId: string;
  clip: Clip;
  source: SourceMeta;
  outputPath: string;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clip, source, outputPath, onProgress, signal } = opts;
  const totalDurationMs = clipDurationMs(clip);
  const args = buildClipFfmpegArgs(clip, source, outputPath);

  const r = await runFfmpeg({
    args,
    totalDurationMs,
    signal,
    onProgress: (percent) => onProgress?.({
      runId, phase: 'rendering-part', currentItem: 1, totalItems: 1, percent,
    }),
  });

  if (!r.ok) {
    try { await fs.unlink(outputPath); } catch {}
    return { ok: false, error: r.stderrTail || `ffmpeg exited with code ${r.exitCode}` };
  }
  onProgress?.({ runId, phase: 'done', currentItem: 1, totalItems: 1, percent: 100 });
  return { ok: true, outputPath };
}

export { buildConcatFfmpegArgs, buildConcatListContents };
