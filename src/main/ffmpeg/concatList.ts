function escapePath(p: string): string {
  return p.replace(/'/g, `'\\''`);
}

export function buildConcatListContents(absPaths: string[]): string {
  return absPaths.map(p => `file '${escapePath(p)}'`).join('\n') + '\n';
}

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
