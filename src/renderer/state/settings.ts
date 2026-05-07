import { create } from 'zustand';

// User-level preferences. Persisted to localStorage so they survive across
// sessions and projects. Kept separate from the project store because they
// don't belong in the saved project file — they're a property of the user,
// not of the timeline.

export interface Settings {
  // Seconds rewound from a bookmark when the user clicks it. The user marks a
  // bookmark *after* something interesting has happened, so rewinding lets
  // them watch the lead-up.
  bookmarkRewindSeconds: number;
  // Seconds the left/right arrow keys (and the ± buttons in Preview and
  // ClipEditor) skip the playhead by.
  skipSeconds: number;
  // Playback speed used while recording a focus marker's track. Lower speeds
  // make fast action easier to follow with the cursor.
  trackingPlaybackRate: number;
  // Optional path to a 9:16 outro to append to Instagram exports. When unset,
  // the standard outro (if any) is rescaled with black bars top/bottom.
  instagramOutroPath?: string;
}

const STORAGE_KEY = 'reelmagic.settings';

const defaults: Settings = {
  bookmarkRewindSeconds: 10,
  skipSeconds: 5,
  trackingPlaybackRate: 0.5,
};

function loadSaved(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      bookmarkRewindSeconds: numberOr(parsed.bookmarkRewindSeconds, defaults.bookmarkRewindSeconds),
      skipSeconds: numberOr(parsed.skipSeconds, defaults.skipSeconds),
      trackingPlaybackRate: numberOr(parsed.trackingPlaybackRate, defaults.trackingPlaybackRate),
      instagramOutroPath: typeof parsed.instagramOutroPath === 'string' ? parsed.instagramOutroPath : undefined,
    };
  } catch {
    return defaults;
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  ...loadSaved(),
  update: (patch) => set(state => {
    const next: Settings = {
      bookmarkRewindSeconds: patch.bookmarkRewindSeconds ?? state.bookmarkRewindSeconds,
      skipSeconds: patch.skipSeconds ?? state.skipSeconds,
      trackingPlaybackRate: patch.trackingPlaybackRate ?? state.trackingPlaybackRate,
      // 'in patch' so passing { instagramOutroPath: undefined } can clear the
      // value rather than the spread keeping the prior path.
      instagramOutroPath: 'instagramOutroPath' in patch ? patch.instagramOutroPath : state.instagramOutroPath,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    return next;
  }),
}));
