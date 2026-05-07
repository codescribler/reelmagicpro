import type { SourceMeta } from '../../shared/types';

function escapePath(p: string): string {
  return p.replace(/'/g, `'\\''`);
}

export function buildConcatListContents(absPaths: string[]): string {
  return absPaths.map(p => `file '${escapePath(p)}'`).join('\n') + '\n';
}

// Stream-copy concat via the concat demuxer. Fast (no encoding) but strict —
// every part must agree on codec, framerate, SAR, profile, timebase, etc.
// Used when all parts come from the same source (no outro).
export function buildConcatFfmpegArgs(listPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    outputPath,
  ];
}

// Filter-concat: a single ffmpeg invocation that takes each part as its own
// `-i` input and joins them through the `concat` filter. Unlike the demuxer,
// the filter can stitch streams that aren't perfectly uniform — but only IF
// the frames it sees are uniform. We force that by piping every input
// through `scale=W:H,setsar=1` before the concat node, so any SAR / size
// drift between parts (e.g. an outro that libx264 encoded with SAR
// 2025:2024 instead of 1:1) is normalised away before concat sees it.
//
// Encoder uses preset=fast (vs. clip parts' preset=medium) — roughly halves
// CPU time on this pass with imperceptible visual cost on already-compressed
// input.
export function buildFilterConcatFfmpegArgs(
  partPaths: string[],
  outputPath: string,
  source: SourceMeta,
): string[] {
  if (partPaths.length === 0) {
    throw new Error('buildFilterConcatFfmpegArgs requires at least one part');
  }
  const inputs: string[] = [];
  for (const p of partPaths) inputs.push('-i', p);

  let normalize = '';
  let labels = '';
  for (let i = 0; i < partPaths.length; i++) {
    normalize += `[${i}:v]scale=${source.width}:${source.height},setsar=1[v${i}n];`;
    labels += `[v${i}n][${i}:a]`;
  }
  const filter = `${normalize}${labels}concat=n=${partPaths.length}:v=1:a=1[v][a]`;

  return [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    // Filter concat re-encodes already-encoded parts. Preset stays fast
    // (vs preset=slow on the per-part encodes) because the re-encode quality
    // cost is small on already-compressed input but slow would multiply
    // export time on long sequences. CRF + audio bitrate stay aligned with
    // the rest of the pipeline so output size is consistent.
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-aspect', `${source.width}:${source.height}`,
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    outputPath,
  ];
}
