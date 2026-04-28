import { EventEmitter } from 'events';

export interface ProgressEvent {
  percent: number; // 0..100
  outTimeMs: number;
}

export class ProgressParser extends EventEmitter {
  private buffer = '';
  private readonly totalMs: number;

  constructor(opts: { totalDurationMs: number }) {
    super();
    this.totalMs = Math.max(1, opts.totalDurationMs);
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      const [k, v] = line.split('=', 2);
      if (k === 'out_time_ms' && v) {
        const outTimeMs = parseInt(v, 10) / 1000;
        const percent = Math.min(100, Math.max(0, (outTimeMs / this.totalMs) * 100));
        this.emit('progress', { percent, outTimeMs } as ProgressEvent);
      } else if (k === 'progress' && v === 'end') {
        this.emit('done');
      }
    }
  }
}
