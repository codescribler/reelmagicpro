import { ProgressParser } from '../../src/main/ffmpeg/progress';

test('emits time updates from -progress key=value lines', () => {
  const events: number[] = [];
  const p = new ProgressParser({ totalDurationMs: 10_000 });
  p.on('progress', e => events.push(e.percent));
  p.feed('out_time_ms=2500000\n');
  p.feed('out_time_ms=5000000\n');
  p.feed('progress=continue\n');
  expect(events[0]).toBeCloseTo(25, 0);
  expect(events[1]).toBeCloseTo(50, 0);
});

test('emits done at progress=end', () => {
  const p = new ProgressParser({ totalDurationMs: 1000 });
  let done = false;
  p.on('done', () => { done = true; });
  p.feed('progress=end\n');
  expect(done).toBe(true);
});

test('handles partial chunks split across feed() calls', () => {
  const events: number[] = [];
  const p = new ProgressParser({ totalDurationMs: 1000 });
  p.on('progress', e => events.push(e.percent));
  p.feed('out_time_');
  p.feed('ms=500');
  p.feed('000\n');
  expect(events).toEqual([50]);
});
