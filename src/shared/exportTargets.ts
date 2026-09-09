import type { ExportFormat } from './types';

export type ExportSelection = ExportFormat | 'both';

export function exportTargets(outputPath: string, selection: ExportSelection) {
  if (selection !== 'both') return [{ format: selection, outputPath }];
  const base = outputPath.replace(/\.mp4$/i, '');
  return (['standard', 'instagram'] as const).map(format => ({
    format, outputPath: `${base}_${format}.mp4`,
  }));
}
