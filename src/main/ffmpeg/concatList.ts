import type { SourceMeta, BackingTrack } from '../../shared/types';

// Mirrors AUDIO_FADE_OUT_SEC in command.ts. Duplicated here rather than
// exported across modules so the concat builder doesn't have to import from
// command.ts (which pulls in a much larger surface).
const SEQ_FADE_OUT_SEC = 0.5;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
}

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
  opts?: {
    // Sequence-wide music. When set, the concatenated audio is replaced (or
    // mixed under) the backing track, and a fade-out is applied at the very
    // end. totalDurationSec must be provided alongside so the trim/fade have
    // somewhere to land.
    backingTrack?: BackingTrack;
    totalDurationSec?: number;
    // Sequence-wide brightness offset (eq=brightness=N) applied AFTER concat
    // so it stacks on top of any per-clip brightness already baked into the
    // parts. -1..1, 0 = no change.
    brightness?: number;
  },
): string[] {
  if (partPaths.length === 0) {
    throw new Error('buildFilterConcatFfmpegArgs requires at least one part');
  }
  const inputs: string[] = [];
  for (const p of partPaths) inputs.push('-i', p);

  const backingTrack = opts?.backingTrack;
  if (backingTrack && (opts?.totalDurationSec ?? 0) > 0) {
    inputs.push('-i', backingTrack.path);
  }

  let normalize = '';
  let labels = '';
  for (let i = 0; i < partPaths.length; i++) {
    normalize += `[${i}:v]scale=${source.width}:${source.height},setsar=1[v${i}n];`;
    labels += `[v${i}n][${i}:a]`;
  }

  let filter: string;
  let audioMap: string;
  let videoMap = '[v]';

  if (backingTrack && (opts?.totalDurationSec ?? 0) > 0) {
    const N = partPaths.length;
    const dur = opts!.totalDurationSec!;
    const fade = Math.min(SEQ_FADE_OUT_SEC, Math.max(0, dur / 2));
    const fadeStart = Math.max(0, dur - fade);
    const trimTail = `,atrim=duration=${fmt(dur)},asetpts=PTS-STARTPTS`;
    const fadeTail = fade > 0 ? `,afade=t=out:st=${fmt(fadeStart)}:d=${fmt(fade)}` : '';
    const vol = fmt(backingTrack.volume);

    if (backingTrack.muteSource) {
      // Concat the video only — discard each part's audio entirely. Backing
      // track plays alone, length-clamped to the total duration with a fade
      // at the end.
      let videoLabels = '';
      for (let i = 0; i < N; i++) videoLabels += `[v${i}n]`;
      filter = `${normalize}${videoLabels}concat=n=${N}:v=1:a=0[v];`
        + `[${N}:a]volume=${vol}${trimTail}${fadeTail}[aout]`;
    } else {
      // Concat parts' audio (source kept) and mix the backing track over it.
      // duration=first stops the mix when the parts' concatenated audio ends
      // — exactly the total export duration — and normalize=0 means the
      // volume slider behaves as an actual gain knob.
      filter = `${normalize}${labels}concat=n=${N}:v=1:a=1[v][srcA];`
        + `[${N}:a]volume=${vol}[bg];`
        + `[srcA][bg]amix=inputs=2:duration=first:normalize=0[mix];`
        + `[mix]anull${trimTail}${fadeTail}[aout]`;
    }
    audioMap = '[aout]';
  } else {
    filter = `${normalize}${labels}concat=n=${partPaths.length}:v=1:a=1[v][a]`;
    audioMap = '[a]';
  }

  // Sequence-wide brightness sits at the very tail of the video chain so it
  // stacks on top of any per-clip brightness already encoded into each part.
  // Renames the concat's [v] to [vc] then runs eq → [v], so the rest of the
  // function still maps [v].
  const sb = opts?.brightness;
  if (sb !== undefined && Math.abs(sb) >= 0.001) {
    // Insert before the final [v] label: change "[v]" → "[vc]" in the
    // already-built filter, then append the eq stage.
    filter = filter.replace(']concat=n=', ']concat=n=').replace('a=0[v]', 'a=0[vc]').replace('a=1[v]', 'a=1[vc]');
    filter += `;[vc]eq=brightness=${fmt(sb)}[v]`;
    videoMap = '[v]';
  }

  return [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', videoMap, '-map', audioMap,
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
