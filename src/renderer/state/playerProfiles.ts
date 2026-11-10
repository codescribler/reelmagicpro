import { create } from 'zustand';
import type { PlayerProfile } from '../../shared/types';

const STORAGE_KEY = 'reelmagic.players';
type ProfileInput = Pick<PlayerProfile, 'name' | 'shortcut'>;
type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface PlayerProfilesState {
  profiles: PlayerProfile[];
  saveProfile: (input: ProfileInput, id?: string) => string | null;
  deleteProfile: (id: string) => string | null;
}

function validationError(profiles: PlayerProfile[], input: ProfileInput, id?: string): string | null {
  if (!input.name || input.name.length > 80) return 'Enter a player name (up to 80 characters).';
  if (!/^[a-z]$/.test(input.shortcut)) return 'Choose a single letter from A to Z.';
  if (input.shortcut === 'b') return 'B is reserved for general bookmarks.';
  if (profiles.some(p => p.id !== id && p.shortcut === input.shortcut)) return 'That letter is already assigned to another player.';
  if (profiles.some(p => p.id !== id && p.name.toLowerCase() === input.name.toLowerCase())) return 'A player with that name is already saved.';
  return null;
}

function loadProfiles(storage?: ProfileStorage): PlayerProfile[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const profiles: PlayerProfile[] = [];
    for (const entry of saved) {
      if (!entry || typeof entry.id !== 'string' || !entry.id ||
          typeof entry.name !== 'string' || typeof entry.shortcut !== 'string') continue;
      const input = { name: entry.name.trim(), shortcut: entry.shortcut.trim().toLowerCase() };
      if (profiles.some(p => p.id === entry.id) || validationError(profiles, input)) continue;
      profiles.push({ id: entry.id, ...input });
    }
    return profiles;
  } catch { return []; }
}

function browserStorage(): ProfileStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function createPlayerProfilesStore(storage: ProfileStorage | undefined = browserStorage()) {
  return create<PlayerProfilesState>((set, get) => {
    function persist(profiles: PlayerProfile[]): string | null {
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(STORAGE_KEY, JSON.stringify(profiles));
        set({ profiles });
        return null;
      } catch { return 'Could not save player profiles. Please try again.'; }
    }
    return {
      profiles: loadProfiles(storage),
      saveProfile: (input, id) => {
        const normalized = { name: input.name.trim(), shortcut: input.shortcut.trim().toLowerCase() };
        const profiles = get().profiles;
        const error = validationError(profiles, normalized, id);
        if (error) return error;
        if (id && !profiles.some(p => p.id === id)) return 'This profile no longer exists.';
        const profile = { id: id ?? `player_${crypto.randomUUID()}`, ...normalized };
        return persist(id ? profiles.map(p => p.id === id ? profile : p) : [...profiles, profile]);
      },
      deleteProfile: id => persist(get().profiles.filter(p => p.id !== id)),
    };
  });
}

type ShortcutEvent = Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>>;

export function playerForShortcut(profiles: PlayerProfile[], event: ShortcutEvent): PlayerProfile | undefined {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return undefined;
  const key = event.key.toLowerCase();
  return key === 'b' ? undefined : profiles.find(p => p.shortcut === key);
}

export const usePlayerProfiles = createPlayerProfilesStore();
