import { create } from 'zustand';

const STORAGE_KEY = 'reelmagic.recentProjects';

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter(path => {
    const key = /^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, '/').toLowerCase() : path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function loadSaved(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value)
      ? uniquePaths(value.filter((path): path is string => typeof path === 'string' && path.trim().length > 0))
      : [];
  } catch { return []; }
}

export const useRecentProjects = create<{
  paths: string[];
  remember: (path: string) => void;
}>((set) => ({
  paths: loadSaved(),
  remember: (path) => set(state => {
    const paths = uniquePaths([path, ...state.paths]);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(paths)); } catch {}
    return { paths };
  }),
}));
