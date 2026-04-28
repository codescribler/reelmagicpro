import { spawn, ChildProcess } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { ProgressParser } from './progress';

const ffmpegPath = (ffmpegStatic as unknown as string);

export interface RunOptions {
  args: string[];
  totalDurationMs: number;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  stderrTail: string;
}

export async function runFfmpeg(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(ffmpegPath, opts.args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const parser = new ProgressParser({ totalDurationMs: opts.totalDurationMs });
    if (opts.onProgress) parser.on('progress', e => opts.onProgress!(e.percent));

    let stderrTail = '';
    const TAIL_MAX = 4096;

    child.stderr!.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      parser.feed(s);
      stderrTail = (stderrTail + s).slice(-TAIL_MAX);
    });

    if (opts.signal) {
      if (opts.signal.aborted) {
        try { child.kill('SIGKILL'); } catch {}
      } else {
        const onAbort = () => { try { child.kill('SIGKILL'); } catch {} };
        opts.signal.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => opts.signal!.removeEventListener('abort', onAbort);
        child.once('close', cleanup);
        child.once('error', cleanup);
      }
    }

    child.on('error', () => resolve({ ok: false, exitCode: null, stderrTail }));
    child.on('close', (code) => resolve({ ok: code === 0, exitCode: code, stderrTail }));
  });
}
