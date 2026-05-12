import { runFfmpeg } from './runner';
import {
  buildClipFfmpegArgs, buildOutroFfmpegArgs,
  buildInstagramClipFfmpegArgs, buildInstagramOutroFfmpegArgs,
} from './command';
import {
  buildConcatFfmpegArgs, buildConcatListContents, buildFilterConcatFfmpegArgs,
} from './concatList';
import { probeVideo, probeHasAudio } from './probe';
import type {
  Clip, SourceMeta, ExportProgress, ExportResult, SequenceEntry, OutroSpec, ExportFormat,
  BackingTrack,
} from '../../shared/types';
import { computeInstagramFraming } from '../../shared/instagramFraming';
import { INSTAGRAM_REEL_WIDTH, INSTAGRAM_REEL_HEIGHT } from '../../shared/instagramFormat';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Build the clip-render ffmpeg args for the chosen format. Branches at the
// arg-builder level so the standard pipeline stays byte-identical. When
// `forceSilentAudio` is set, each clip part is rendered with no audio
// (anullsrc); the sequence-with-backing-track flow uses this so the
// concatenated audio is silent before the sequence track is mixed in.
function buildArgsForClip(
  clip: Clip,
  source: SourceMeta,
  outputPath: string,
  format: ExportFormat,
  opts?: { forceSilentAudio?: boolean },
): string[] {
  if (format === 'instagram') {
    const framing = computeInstagramFraming(clip, source);
    return buildInstagramClipFfmpegArgs(clip, source, framing.samples, outputPath, opts);
  }
  return buildClipFfmpegArgs(clip, source, outputPath, opts);
}

// Wall-clock duration of a clip in the rendered output (seconds). Mirrors
// the formula in command.ts so the concat-stage fade lands at the same beat
// as each part's own pipeline.
function clipOutputDurationSec(clip: Clip): number {
  return (clip.out - clip.in) / clip.speed;
}

// Synthetic "source" for the concat step so the IG output canvas is sized
// correctly. The clip parts are already 1080×1920 once IG-rendered, but the
// concat filter chain in concatList sizes its output canvas off this value.
function concatSourceForFormat(source: SourceMeta, format: ExportFormat): SourceMeta {
  if (format !== 'instagram') return source;
  return { ...source, width: INSTAGRAM_REEL_WIDTH, height: INSTAGRAM_REEL_HEIGHT };
}

// Pick the outro to render for the chosen format. For Instagram exports we
// prefer the IG-specific path (if set and the file exists); otherwise we fall
// back to the standard outro letterboxed and emit a warning. Returns
// { ok: true, none: true } when no outro should be appended.
async function resolveOutroForFormat(opts: {
  format: ExportFormat;
  outro?: OutroSpec;
  instagramOutroPath?: string;
  onWarning?: (msg: string) => void;
}): Promise<
  | { ok: true; none?: false; spec: OutroSpec; durationMs: number; hasAudio: boolean }
  | { ok: true; none: true }
  | { ok: false; error: string }
> {
  const { format, outro, instagramOutroPath, onWarning } = opts;
  if (format === 'instagram') {
    if (instagramOutroPath) {
      const r = await resolveOutro({ path: instagramOutroPath });
      if (r.ok) {
        return { ok: true, spec: { path: instagramOutroPath }, durationMs: r.durationMs, hasAudio: r.hasAudio };
      }
      onWarning?.('Instagram outro file not found — using standard outro letterboxed.');
    }
    if (!outro) return { ok: true, none: true };
    const r = await resolveOutro(outro);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, spec: outro, durationMs: r.durationMs, hasAudio: r.hasAudio };
  }
  if (!outro) return { ok: true, none: true };
  const r = await resolveOutro(outro);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, spec: outro, durationMs: r.durationMs, hasAudio: r.hasAudio };
}

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
  format: ExportFormat;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { outro, source, outputPath, durationMs, hasAudio, format, signal, onProgress } = opts;
  const args = format === 'instagram'
    ? buildInstagramOutroFfmpegArgs(outro.path, source, outputPath, hasAudio)
    : buildOutroFfmpegArgs(outro.path, source, outputPath, hasAudio);
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
  format?: ExportFormat;
  instagramOutroPath?: string;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clip, source, outputPath, outro, instagramOutroPath, onProgress, signal } = opts;
  const format: ExportFormat = opts.format ?? 'standard';

  const resolved = await resolveOutroForFormat({
    format, outro, instagramOutroPath,
    onWarning: (msg) => onProgress?.({
      runId, phase: 'rendering-part', currentItem: 1, totalItems: 1, percent: 0, message: msg,
    }),
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  // No outro: single-pass — encode straight to the user's output path.
  if (resolved.none) {
    return runSinglePassClip({ runId, clip, source, outputPath, format, onProgress, signal });
  }

  const { spec: outroSpec, durationMs: outroDurationMs, hasAudio: outroHasAudio } = resolved;

  const tempDir = path.join(os.tmpdir(), `reelmagic-export-${runId}`);
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const totalItems = 3; // clip + outro + concat
    const clipPath = path.join(tempDir, 'clip.mp4');
    const clipRes = await renderClipPart({
      runId, clip, source, outputPath: clipPath,
      tempDir, scriptName: `fc-clip.txt`,
      itemIndex: 1, totalItems, format, onProgress, signal,
    });
    if (!clipRes.ok) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      return clipRes;
    }

    if (signal?.aborted) return { ok: false, error: 'Cancelled' };

    const outroPartPath = path.join(tempDir, 'outro.mp4');
    const outroRes = await renderOutroPart({
      outro: outroSpec, source, outputPath: outroPartPath,
      durationMs: outroDurationMs, hasAudio: outroHasAudio,
      format,
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
      totalDurationMs: clipDurationMs(clip) + outroDurationMs,
      itemIndex: totalItems, totalItems,
      source: concatSourceForFormat(source, format),
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
  format: ExportFormat;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clip, source, outputPath, format, onProgress, signal } = opts;
  const totalDurationMs = clipDurationMs(clip);
  const rawArgs = buildArgsForClip(clip, source, outputPath, format);
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
  format: ExportFormat;
  forceSilentAudio?: boolean;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { runId, clip, source, outputPath, tempDir, scriptName, itemIndex, totalItems, format, forceSilentAudio, onProgress, signal } = opts;
  const rawArgs = buildArgsForClip(clip, source, outputPath, format, { forceSilentAudio });
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
  // Sequence-wide backing track applied at concat time. Forces filter-concat
  // (the demuxer can't mix in an extra audio input), takes over the audio
  // stream from the parts, and fades the final output down to zero.
  sequenceBackingTrack?: BackingTrack;
  // Sequence-wide brightness offset. Same forced-filter-concat rule as the
  // backing track — demuxer concat can't run an eq filter.
  sequenceBrightness?: number;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<{ ok: true } | ExportResult> {
  const { partPaths, outputPath, tempDir, runId, totalDurationMs, itemIndex, totalItems, source, filterConcat, sequenceBackingTrack, sequenceBrightness, onProgress, signal } = opts;
  let concatArgs: string[];
  const hasSeqBrightness = sequenceBrightness !== undefined && Math.abs(sequenceBrightness) >= 0.001;
  const useFilter = filterConcat || !!sequenceBackingTrack || hasSeqBrightness;
  if (useFilter) {
    concatArgs = buildFilterConcatFfmpegArgs(partPaths, outputPath, source, {
      backingTrack: sequenceBackingTrack,
      totalDurationSec: sequenceBackingTrack ? totalDurationMs / 1000 : undefined,
      brightness: hasSeqBrightness ? sequenceBrightness : undefined,
    });
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
  format?: ExportFormat;
  instagramOutroPath?: string;
  sequenceBackingTrack?: BackingTrack;
  sequenceBrightness?: number;
  onProgress?: ProgressCb;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { runId, clips, sequence, source, outputPath, outro, instagramOutroPath, sequenceBackingTrack, sequenceBrightness, onProgress, signal } = opts;
  const format: ExportFormat = opts.format ?? 'standard';

  // Sequence-level music overrides per-clip music. When present, each clip
  // part is rendered as if `clip.backingTrack` were unset, and (if
  // muteSource) its source audio is silenced too. The single backing track
  // then mixes over the entire concatenated output, with a fade at the very
  // end.
  const stripPerClipAudio = !!sequenceBackingTrack;
  const forceSilent = !!sequenceBackingTrack && sequenceBackingTrack.muteSource;

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
  const resolvedOutro = await resolveOutroForFormat({
    format, outro, instagramOutroPath,
    onWarning: (msg) => onProgress?.({
      runId, phase: 'rendering-part', currentItem: 1, totalItems: 1, percent: 0, message: msg,
    }),
  });
  if (!resolvedOutro.ok) return { ok: false, error: resolvedOutro.error };
  const outroSpec = resolvedOutro.none ? null : resolvedOutro;

  const tempDir = path.join(os.tmpdir(), `reelmagic-export-${runId}`);
  await fs.mkdir(tempDir, { recursive: true });

  const partPaths: string[] = [];

  try {
    // total = clip parts + (1 if outro) + 1 for concat
    const totalItems = items.length + (outroSpec ? 1 : 0) + 1;

    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      const { clip } = items[i]!;
      // When a sequence track is set, drop the clip's own backing-track config
      // before rendering — otherwise the clip part would carry its own music
      // and try to fade out, fighting the sequence-wide track.
      const renderClip: Clip = stripPerClipAudio
        ? { ...clip, backingTrack: undefined }
        : clip;
      const partPath = path.join(tempDir, `part-${i}.mp4`);
      partPaths.push(partPath);
      const r = await renderClipPart({
        runId, clip: renderClip, source, outputPath: partPath,
        tempDir, scriptName: `fc-part-${i}.txt`,
        itemIndex: i + 1, totalItems, format,
        forceSilentAudio: forceSilent,
        onProgress, signal,
      });
      if (!r.ok) {
        if (signal?.aborted) return { ok: false, error: 'Cancelled' };
        return { ok: false, error: r.error };
      }
    }

    if (outroSpec) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      const outroPartPath = path.join(tempDir, 'outro.mp4');
      partPaths.push(outroPartPath);
      // Outro renders silent when the sequence track wants source audio
      // hidden — the sequence track plays through the outro too.
      const r = await renderOutroPart({
        outro: outroSpec.spec, source, outputPath: outroPartPath,
        durationMs: outroSpec.durationMs,
        hasAudio: forceSilent ? false : outroSpec.hasAudio,
        format,
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
      + (outroSpec?.durationMs ?? 0);

    const concatRes = await concatToOutput({
      partPaths, outputPath, tempDir, runId,
      totalDurationMs: totalConcatMs,
      itemIndex: totalItems, totalItems,
      source: concatSourceForFormat(source, format),
      filterConcat: !!outroSpec || format === 'instagram' || !!sequenceBackingTrack
        || (sequenceBrightness !== undefined && Math.abs(sequenceBrightness) >= 0.001),
      sequenceBackingTrack,
      sequenceBrightness,
      onProgress, signal,
    });
    if (!concatRes.ok) return concatRes;

    onProgress?.({ runId, phase: 'done', currentItem: totalItems, totalItems, percent: 100 });
    return { ok: true, outputPath };
  } finally {
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
  }
}
