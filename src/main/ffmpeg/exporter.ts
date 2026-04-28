import { runFfmpeg } from './runner';
import { buildClipFfmpegArgs } from './command';
import { buildConcatFfmpegArgs, buildConcatListContents } from './concatList';
import type { Clip, SourceMeta, ExportProgress, ExportResult, SequenceEntry } from '../../shared/types';
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

function partOutputDurationMs(clip: Clip): number {
  return clipDurationMs(clip);
}

export async function exportSequence(opts: {
  runId: string;
  clips: Clip[];
  sequence: SequenceEntry[];
  source: SourceMeta;
  outputPath: string;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clips, sequence, source, outputPath, onProgress, signal } = opts;

  if (sequence.length === 0) {
    return { ok: false, error: 'Sequence is empty' };
  }

  const clipById = new Map(clips.map(c => [c.id, c]));
  const items = sequence.map((entry, idx) => {
    const clip = clipById.get(entry.clipId);
    if (!clip) throw new Error(`Sequence references missing clip ${entry.clipId}`);
    return { index: idx, clip };
  });

  const tempDir = path.join(os.tmpdir(), `reelmagic-export-${runId}`);
  await fs.mkdir(tempDir, { recursive: true });

  const partPaths: string[] = [];

  try {
    const totalItems = items.length + 1; // +1 for concat phase
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) {
        return { ok: false, error: 'Cancelled' };
      }
      const { clip } = items[i]!;
      const partPath = path.join(tempDir, `part-${i}.mp4`);
      partPaths.push(partPath);
      const args = buildClipFfmpegArgs(clip, source, partPath);
      const r = await runFfmpeg({
        args,
        totalDurationMs: partOutputDurationMs(clip),
        signal,
        onProgress: (percent) => onProgress?.({
          runId, phase: 'rendering-part',
          currentItem: i + 1, totalItems,
          percent,
        }),
      });
      if (!r.ok) {
        return { ok: false, error: r.stderrTail || `Part ${i + 1} failed (exit ${r.exitCode})` };
      }
    }

    if (signal?.aborted) return { ok: false, error: 'Cancelled' };

    const listPath = path.join(tempDir, 'list.txt');
    await fs.writeFile(listPath, buildConcatListContents(partPaths), 'utf8');

    const concatArgs = buildConcatFfmpegArgs(listPath, outputPath);
    const totalConcatMs = items.reduce((acc, it) => acc + partOutputDurationMs(it.clip), 0);

    const r = await runFfmpeg({
      args: concatArgs,
      totalDurationMs: totalConcatMs,
      signal,
      onProgress: (percent) => onProgress?.({
        runId, phase: 'concatenating',
        currentItem: totalItems, totalItems,
        percent,
      }),
    });

    if (!r.ok) {
      try { await fs.unlink(outputPath); } catch {}
      return { ok: false, error: r.stderrTail || `Concat failed (exit ${r.exitCode})` };
    }

    onProgress?.({ runId, phase: 'done', currentItem: totalItems, totalItems, percent: 100 });
    return { ok: true, outputPath };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
