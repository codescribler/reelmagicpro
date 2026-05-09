import { useEffect } from 'react';
import { create } from 'zustand';
import type { LicenceState } from '../../shared/types';

interface LicenceStore {
  state: LicenceState;
  setState: (s: LicenceState) => void;
}

export const useLicenceStore = create<LicenceStore>((set) => ({
  state: { kind: 'initialising' },
  setState: (s) => set({ state: s }),
}));

// Subscribe to main-process push updates and seed initial state. Mounted once
// from the app shell.
export function useLicenceSubscription(): void {
  const setState = useLicenceStore((s) => s.setState);
  useEffect(() => {
    let cancelled = false;
    void window.reelmagic.licence.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const off = window.reelmagic.licence.onChange((s) => setState(s));
    return () => {
      cancelled = true;
      off();
    };
  }, [setState]);
}
