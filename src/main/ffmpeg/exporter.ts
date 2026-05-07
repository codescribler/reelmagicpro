import { runFfmpeg } from './runner';
import { buildClipFfmpegArgs, buildOutroFfmpegArgs } from './command';
import {
  buildConcatFfmpegArgs, buildConcatListContents, buildFilterConcatFfmpegArgs,
} from './concatList';
import { probeVideo, probeHasAudio } from './probe';
import type {
  Clip, SourceMeta, ExportProgress, ExportResult, SequenceEntry, OutroSpec,
} from '../../shared/types';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export type ProgressCb = (p: ExportProgress) => void;

function clipDurationMs(clip: Clip): number {
  const range = clip.out - clip.in;
  return Math.max(1, Math.round((range / clip.speed) * 1000));
}

// If the -filter_complex argument is too long for the OS argv limit (Windows
// hits ENAMETOOLONG around 32KB), spill it to a temp file and use ffmpeg's
// -filter_complex_script flag instead. Returns the (possibly modified) args
// and a cleanup function that the caller MUST run when the process exits.
const FILTER_INLINE_MAX = 4000;
async function spillLongFilter(
  args: string[],
  scriptDir: string,
  scriptName: string,
): Promise<{ args: string[]; cleanup: () => Promise<void> }> {
  const i = args.indexOf('-filter_complex');
  if (i < 0) return { args, cleanup: async () => {} };
  const value = args[i + 1];
  if (!value || value.length <= FILTER_INLINE_MAX) {
    return { args, cleanup: async () => {} };
  }
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, scriptName);
  await fs.writeFile(scriptPath, value, 'utf8');
  const newArgs = [
    ...args.slice(0, i),
    '-filter_complex_script', scriptPath,
    ...args.slice(i + 2),
  ];
  return {
    args: newArgs,
    cleanup: async () => { try { await fs.unlink(scriptPath); } catch {} },
  };
}

// Resolve the outro: confirm the file exists, probe it for duration and audio
// presence. Returned info is used to build the outro's encoding args and
// progress denominator. Errors are surfaced as { ok: false } so the caller
// can short-circuit before doing any expensive clip rendering.
async function resolveOutro(spec: OutroSpec): Promise<
  | { ok: true; durationMs: number; hasAudio: boolean }
  | { ok: false; error: string }
> {
  try {
    await fs.access(spec.path);
  } catch {
    return { ok: false, error: `Outro file not found: ${spec.path}` };
  }
  try {
    const meta = await probeVideo(spec.path);
    const hasAudio = await probeHasAudio(spec.path);
    return { ok: true, durationMs: Math.max(1, Math.round(meta.duration * 1000)), hasAudio };
  } catch (e: any) {
    return { ok: false, error: `Could not probe outro: ${e?.message ?? String(e)}` };
  }
}

// Render the outro to `outputPath` as a part that matches the clip parts'
// codec / resolution / audio layout, so the concat demuxer can stream-copy
// it on after the rendered timeline.
async function renderOutroPart(opts: {
  outro: OutroSpec;
  source: SourceMeta;
  outputPath: string;
  durationMs: number;
  hasAudio: boolean;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { outro, source, outputPath, durationMs, hasAudio, signal, onProgress } = opts;
  const args = buildOutroFfmpegArgs(outro.path, source, outputPath, hasAudio);
  const r = await runFfmpeg({ args, totalDurationMs: durationMs, signal, onProgress });
  if (!r.ok) {
    return { ok: false, error: r.stderrTail || `Outro render failed (exit ${r.exitCode})` };
  }
  return { ok: true };
}

export async function exportClip(opts: {
  runId: string;
  clip: Clip;
  source: SourceMeta;
  outputPath: string;
  outro?: OutroSpec;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clip, source, outputPath, outro, onProgress, signal } = opts;

  // No outro: single-pass — encode straight to the user's output path.
  if (!outro) {
    return runSinglePassClip({ runId, clip, source, outputPath, onProgress, signal });
  }

  // With outro: validate first, then render clip + outro into a temp dir and
  // concat-copy them to the output. Validating up front avoids burning a full
  // clip render only to fail on a missing outro.
  const resolved = await resolveOutro(outro);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const tempDir = path.join(os.tmpdir(), `reelmagic-export-${runId}`);
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const totalItems = 3; // clip + outro + concat
    const clipPath = path.join(tempDir, 'clip.mp4');
    const clipRes = await renderClipPart({
      runId, clip, source, outputPath: clipPath,
      tempDir, scriptName: `fc-clip.txt`,
      itemIndex: 1, totalItems, onProgress, signal,
    });
    if (!clipRes.ok) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      return clipRes;
    }

    if (signal?.aborted) return { ok: false, error: 'Cancelled' };

    const outroPartPath = path.join(tempDir, 'outro.mp4');
    const outroRes = await renderOutroPart({
      outro, source, outputPath: outroPartPath,
      durationMs: resolved.durationMs, hasAudio: resolved.hasAudio,
      signal,
      onProgress: (percent) => onProgress?.({
        runId, phase: 'rendering-part', currentItem: 2, totalItems, percent,
      }),
    });
    if (!outroRes.ok) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      return { ok: false, error: outroRes.error };
    }

    if (signal?.aborted) return { ok: false, error: 'Cancelled' };

    const concatRes = await concatToOutput({
      partPaths: [clipPath, outroPartPath],
      outputPath, tempDir, runId,
      totalDurationMs: clipDurationMs(clip) + resolved.durationMs,
      itemIndex: totalItems, totalItems,
      source,
      filterConcat: true,
      onProgress, signal,
    });
    if (!concatRes.ok) return concatRes;

    onProgress?.({ runId, phase: 'done', currentItem: totalItems, totalItems, percent: 100 });
    return { ok: true, outputPath };
  } finally {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function runSinglePassClip(opts: {
  runId: string;
  clip: Clip;
  source: SourceMeta;
  outputPath: string;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clip, source, outputPath, onProgress, signal } = opts;
  const totalDurationMs = clipDurationMs(clip);
  const rawArgs = buildClipFfmpegArgs(clip, source, outputPath);
  const { args, cleanup } = await spillLongFilter(
    rawArgs,
    os.tmpdir(),
    `reelmagic-fc-${runId}.txt`,
  );

  try {
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
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      return { ok: false, error: r.stderrTail || `ffmpeg exited with code ${r.exitCode}` };
    }
    onProgress?.({ runId, phase: 'done', currentItem: 1, totalItems: 1, percent: 100 });
    return { ok: true, outputPath };
  } finally {
    await cleanup();
  }
}

// Render one clip into `outputPath` using the clip-encoding pipeline. Shared
// between exportSequence (rendering each sequence entry) and exportClip's
// with-outro flow (which treats the single clip as the first of two parts).
async function renderClipPart(opts: {
  runId: string;
  clip: Clip;
  source: SourceMeta;
  outputPath: string;
  tempDir: string;
  scriptName: string;
  itemIndex: number;
  totalItems: number;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { runId, clip, source, outputPath, tempDir, scriptName, itemIndex, totalItems, onProgress, signal } = opts;
  const rawArgs = buildClipFfmpegArgs(clip, source, outputPath);
  const { args, cleanup } = await spillLongFilter(rawArgs, tempDir, scriptName);
  try {
    const r = await runFfmpeg({
      args,
      totalDurationMs: clipDurationMs(clip),
      signal,
      onProgress: (percent) => onProgress?.({
        runId, phase: 'rendering-part', currentItem: itemIndex, totalItems, percent,
      }),
    });
    if (!r.ok) {
      return { ok: false, error: r.stderrTail || `Part ${itemIndex} failed (exit ${r.exitCode})` };
    }
    return { ok: true };
  } finally {
    await cleanup();
  }
}

async function concatToOutput(opts: {
  partPaths: string[];
  outputPath: string;
  tempDir: string;
  runId: string;
  totalDurationMs: number;
  itemIndex: number;
  totalItems: number;
  source: SourceMeta;
  // When true, use the filter-concat path (single ffmpeg call, multi-input,
  // re-encode through libx264 preset=fast). Required whenever any part comes
  // from a different source (i.e. an outro is appended) — the demuxer's
  // stream-copy desyncs at the boundary, and demuxer+reencode stalls there.
  filterConcat?: boolean;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<{ ok: true } | ExportResult> {
  const { partPaths, outputPath, tempDir, runId, totalDurationMs, itemIndex, totalItems, source, filterConcat, onProgress, signal } = opts;
  let concatArgs: string[];
  if (filterConcat) {
    concatArgs = buildFilterConcatFfmpegArgs(partPaths, outputPath, source);
  } else {
    const listPath = path.join(tempDir, 'list.txt');
    await fs.writeFile(listPath, buildConcatListContents(partPaths), 'utf8');
    concatArgs = buildConcatFfmpegArgs(listPath, outputPath);
  }
  const r = await runFfmpeg({
    args: concatArgs,
    totalDurationMs,
    signal,
    onProgress: (percent) => onProgress?.({
      runId, phase: 'concatenating', currentItem: itemIndex, totalItems, percent,
    }),
  });
  if (!r.ok) {
    try { await fs.unlink(outputPath); } catch {}
    if (signal?.aborted) return { ok: false, error: 'Cancelled' };
    return { ok: false, error: r.stderrTail || `Concat failed (exit ${r.exitCode})` };
  }
  return { ok: true };
}

export { buildConcatFfmpegArgs, buildConcatListContents };

export async function exportSequence(opts: {
  runId: string;
  clips: Clip[];
  sequence: SequenceEntry[];
  source: SourceMeta;
  outputPath: string;
  outro?: OutroSpec;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clips, sequence, source, outputPath, outro, onProgress, signal } = opts;

  if (sequence.length === 0) {
    return { ok: false, error: 'Sequence is empty' };
  }

  const clipById = new Map(clips.map(c => [c.id, c]));
  const items: { index: number; clip: Clip }[] = [];
  for (let idx = 0; idx < sequence.length; idx++) {
    const entry = sequence[idx]!;
    const clip = clipById.get(entry.clipId);
    if (!clip) {
      return { ok: false, error: `Sequence references missing clip ${entry.clipId}` };
    }
    items.push({ index: idx, clip });
  }

  // Validate outro up front so a missing file fails fast — no point rendering
  // hundreds of frames of clip parts only to discover the appendix is broken.
  let resolvedOutro: { durationMs: number; hasAudio: boolean } | null = null;
  if (outro) {
    const r = await resolveOutro(outro);
    if (!r.ok) return { ok: false, error: r.error };
    resolvedOutro = { durationMs: r.durationMs, hasAudio: r.hasAudio };
  }

  const tempDir = path.join(os.tmpdir(), `reelmagic-export-${runId}`);
  await fs.mkdir(tempDir, { recursive: true });

  const partPaths: string[] = [];

  try {
    // total = clip parts + (1 if outro) + 1 for concat
    const totalItems = items.length + (resolvedOutro ? 1 : 0) + 1;

    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      const { clip } = items[i]!;
      const partPath = path.join(tempDir, `part-${i}.mp4`);
      partPaths.push(partPath);
      const r = await renderClipPart({
        runId, clip, source, outputPath: partPath,
        tempDir, scriptName: `fc-part-${i}.txt`,
        itemIndex: i + 1, totalItems,
        onProgress, signal,
      });
      if (!r.ok) {
        if (signal?.aborted) return { ok: false, error: 'Cancelled' };
        return { ok: false, error: r.error };
      }
    }

    if (resolvedOutro && outro) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      const outroPartPath = path.join(tempDir, 'outro.mp4');
      partPaths.push(outroPartPath);
      const r = await renderOutroPart({
        outro, source, outputPath: outroPartPath,
        durationMs: resolvedOutro.durationMs, hasAudio: resolvedOutro.hasAudio,
        signal,
        onProgress: (percent) => onProgress?.({
          runId, phase: 'rendering-part',
          currentItem: items.length + 1, totalItems, percent,
        }),
      });
      if (!r.ok) {
        if (signal?.aborted) return { ok: false, error: 'Cancelled' };
        return { ok: false, error: r.error };
      }
    }

    if (signal?.aborted) return { ok: false, error: 'Cancelled' };

    const totalConcatMs =
      items.reduce((acc, it) => acc + clipDurationMs(it.clip), 0)
      + (resolvedOutro?.durationMs ?? 0);

    const concatRes = await concatToOutput({
      partPaths, outputPath, tempDir, runId,
      totalDurationMs: totalConcatMs,
      itemIndex: totalItems, totalItems,
      source,
      filterConcat: !!resolvedOutro,
      onProgress, signal,
    });
    if (!concatRes.ok) return concatRes;

    onProgress?.({ runId, phase: 'done', currentItem: totalItems, totalItems, percent: 100 });
    return { ok: true, outputPath };
  } finally {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  }
}
