import { useProjectStore } from '../../src/renderer/state/projectStore';
import type { Project } from '../../src/shared/types';

function baseProject(): Project {
  return {
    version: 1,
    sourceVideo: { path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 's1', path: '/v.mp4', duration: 100, width: 1920, height: 1080, fps: 30 }],
    clips: [{
      id: 'c1', name: 'A', in: 0, out: 5, speed: 1,
      zoom: { x: 0, y: 0, width: 1920, height: 1080 }, focusMarkers: [],
    }],
    sequence: [], bookmarks: [],
  };
}

test('setReelFraming sets and clears the clip pan path', () => {
  useProjectStore.getState().setProject(baseProject());
  useProjectStore.getState().setReelFraming('c1', { panPath: [{ t: 0, cx: 600 }] });
  expect(useProjectStore.getState().project!.clips[0]!.reelFraming)
    .toEqual({ panPath: [{ t: 0, cx: 600 }] });
  useProjectStore.getState().setReelFraming('c1', undefined);
  expect(useProjectStore.getState().project!.clips[0]!.reelFraming).toBeUndefined();
});

test('deleting a clip while in frame-reel mode drops back to source', () => {
  useProjectStore.getState().setProject(baseProject());
  useProjectStore.getState().setPreviewMode({ kind: 'frame-reel', clipId: 'c1' });
  useProjectStore.getState().deleteClip('c1');
  expect(useProjectStore.getState().previewMode).toEqual({ kind: 'source' });
});
