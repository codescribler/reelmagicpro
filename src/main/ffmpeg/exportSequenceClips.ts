import fs from 'fs/promises';
import path from 'path';
import { exportClip } from './exporter';
import { exportTargets } from '../../shared/exportTargets';
import { resolveSource } from '../../shared/resolveSource';
import type { ExportSequenceClipsArgs, ExportProgress, ExportResult } from '../../shared/types';

const FORMAT_FOLDERS = { standard: 'Standard', instagram: 'Instagram' } as const;

function safeName(value: string, fallback: string): string {
  const clean = Array.from(value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'))
    .slice(0, 80).join('').trim().replace(/[. ]+$/, '');
  if (!clean) return fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}

async function createFolder(parent: string, name: string): Promise<string> {
  for (let suffix = 1; ; suffix++) {
    const folder = path.join(parent, suffix === 1 ? name : `${name} (${suffix})`);
    try {
      await fs.mkdir(folder);
      return folder;
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

export async function exportSequenceClips(opts: ExportSequenceClipsArgs & {
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}): Promise<ExportResult> {
  const { runId, signal, onProgress } = opts;
  const outputPaths: string[] = [];
  let outputDirectory: string | undefined;
  let currentFile: string | undefined;
  const failed = (error: string): ExportResult => ({ ok: false, error, outputDirectory, outputPaths });
  try {
    if (!['standard', 'instagram', 'both'].includes(opts.format)) return failed('Choose an export format.');
    if (!opts.sequence.length) return failed('Sequence is empty');
    if (!opts.sources.length) return failed('No sources provided');
    if (!opts.directory) return failed('Choose a destination folder.');
    const clipById = new Map(opts.clips.map(clip => [clip.id, clip]));
    const entries = opts.sequence.map(entry => {
      const clip = clipById.get(entry.clipId);
      if (!clip) throw new Error(`Sequence references missing clip ${entry.clipId}`);
      return { clip, source: resolveSource({ sources: opts.sources }, clip.sourceId) ?? opts.sources[0]! };
    });
    if (signal?.aborted) return failed('Cancelled');
    outputDirectory = await createFolder(opts.directory, safeName(opts.sequenceName, 'Sequence clips'));
    if (opts.format === 'both') {
      await Promise.all(Object.values(FORMAT_FOLDERS).map(folder => fs.mkdir(path.join(outputDirectory!, folder))));
    }
    const digits = Math.max(2, String(entries.length).length);
    const jobs = entries.flatMap(({ clip, source }, index) => {
      const filename = `${String(index + 1).padStart(digits, '0')} - ${safeName(clip.name, 'Clip')}.mp4`;
      return exportTargets(path.join(outputDirectory!, filename), opts.format)
        .map(target => ({ ...target, clip, source,
          outputPath: opts.format === 'both'
            ? path.join(outputDirectory!, FORMAT_FOLDERS[target.format], path.basename(target.outputPath))
            : target.outputPath,
        }));
    });
    let percent = 0;
    for (const [index, job] of jobs.entries()) {
      if (signal?.aborted) return failed('Cancelled');
      currentFile = job.outputPath;
      const report = (partPercent: number) => {
        const value = Number.isFinite(partPercent) ? Math.min(100, Math.max(0, partPercent)) : 0;
        percent = Math.max(percent, (index + value / 100) / jobs.length * 100);
        onProgress?.({ runId, phase: 'rendering-part', currentItem: index + 1,
          totalItems: jobs.length, percent, message: path.basename(job.outputPath) });
      };
      report(0);
      const result = await exportClip({ runId, ...job, signal,
        onProgress: p => { if (p.phase !== 'done') report(p.percent); } });
      if (!result.ok) {
        await fs.unlink(currentFile).catch(() => {});
        return failed(signal?.aborted ? 'Cancelled' : `${path.basename(currentFile)}: ${result.error}`);
      }
      outputPaths.push(job.outputPath);
      currentFile = undefined;
      report(100);
    }
    onProgress?.({ runId, phase: 'done', currentItem: jobs.length, totalItems: jobs.length, percent: 100 });
    return { ok: true, outputDirectory, outputPaths };
  } catch (error: any) {
    if (currentFile) await fs.unlink(currentFile).catch(() => {});
    return failed(signal?.aborted ? 'Cancelled' : error?.message ?? String(error));
  }
}
