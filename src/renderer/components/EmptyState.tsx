import React from 'react';
import logoUrl from '../assets/reelmagic.png';

// First-run / no-project hero. Shown whenever there is no project loaded.
// One way in: open a local file. "Open a saved project" is tucked underneath
// as a secondary link for returning users.
export function EmptyState({
  onOpenVideo,
  onOpenProject,
}: {
  onOpenVideo: () => void;
  onOpenProject: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <img src={logoUrl} alt="ReelMagic" className="empty-state-logo" />
        <p className="empty-state-tagline">
          Turn match footage into highlight reels of your kid.
        </p>
        <button
          className="primary empty-state-cta"
          onClick={onOpenVideo}
          autoFocus
        >
          📁 Open a video
        </button>

        <button className="empty-state-secondary" onClick={onOpenProject}>
          Open a saved project
        </button>
      </div>
    </div>
  );
}
