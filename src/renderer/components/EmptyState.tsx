import React from 'react';
import logoUrl from '../assets/reelmagic.png';

// First-run / no-project hero. Shown whenever there is no project loaded.
// Single primary CTA ("Open a video") so a first-time user can't miss the one
// action that matters; "Open a saved project" tucked underneath as a secondary
// link for returning users.
export function EmptyState({ onOpenVideo, onOpenProject }: {
  onOpenVideo: () => void;
  onOpenProject: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <img src={logoUrl} alt="ReelMagic" className="empty-state-logo" />
        <h1 className="empty-state-title">ReelMagic</h1>
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
