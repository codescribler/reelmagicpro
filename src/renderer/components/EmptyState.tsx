import React, { useState } from 'react';
import { useRecentProjects } from '../state/recentProjects';
import logoUrl from '../assets/reelmagic.png';

// First-run / no-project hero. Shown whenever there is no project loaded.
// Recent saved projects provide a shortcut for returning users.
export function EmptyState({
  onOpenVideo,
  onOpenProject,
}: {
  onOpenVideo: () => void;
  onOpenProject: (path?: string) => Promise<void>;
}) {
  const paths = useRecentProjects(s => s.paths);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  async function openProject(path?: string) {
    if (opening) return;
    setOpening(true);
    setError('');
    try { await onOpenProject(path); }
    catch { setError('Could not open the project. Please try again.'); }
    finally { setOpening(false); }
  }
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
          disabled={opening}
          autoFocus
        >
          📁 Open a video
        </button>

        <button className="empty-state-secondary" disabled={opening} onClick={() => void openProject()}>
          Open a saved project
        </button>
        {paths.length > 0 && <section className="recent-projects" aria-label="Recent projects" aria-busy={opening}>
          <h2>Recent projects</h2>
          <ul>{paths.map(path => <li key={path}>
            <button disabled={opening} title={path} onClick={() => void openProject(path)}>
              <strong>{path.split(/[\\/]/).pop()?.replace(/\.(rmproj|json)$/i, '')}</strong>
              <span>{path}</span>
            </button>
          </li>)}</ul>
        </section>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
