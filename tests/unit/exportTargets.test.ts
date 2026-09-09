import { exportTargets } from '../../src/shared/exportTargets';

test('both exports use distinct filenames in the chosen directory', () => {
  expect(exportTargets('C:\\Videos\\Match highlights.MP4', 'both')).toEqual([
    { format: 'standard', outputPath: 'C:\\Videos\\Match highlights_standard.mp4' },
    { format: 'instagram', outputPath: 'C:\\Videos\\Match highlights_instagram.mp4' },
  ]);
});

test('adds extensions when omitted and preserves single-format filenames', () => {
  expect(exportTargets('/videos/sequence', 'both')[1]!.outputPath).toBe('/videos/sequence_instagram.mp4');
  expect(exportTargets('/videos/clip.mp4', 'instagram')).toEqual([
    { format: 'instagram', outputPath: '/videos/clip.mp4' },
  ]);
});
