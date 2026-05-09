import React from 'react';
import type { VeoDownloadProgress } from '../../shared/types';

// Mirrors ExportProgressModal's visual language so the two flows feel like
// siblings. State is owned by the parent (App.tsx) since the Veo download
// happens before a project exists, so the project store isn't appropriate.
export function VeoDownloadModal({
  progress,
  error,
  onCancel,
  onClose,
}: {
  progress: VeoDownloadProgress | null;
  error: string | null;
  onCancel: () => void;
  onClose: () => void;
}) {
  if (!progress && !error) return null;

  const cancelled = error === 'cancelled';
  const phaseLabel =
    progress?.phase === 'fetching-page' ? 'Reading the Veo page…'
    : progress?.phase === 'downloading' ? 'Downloading video…'
    : progress?.phase === 'probing' ? 'Reading video metadata…'
    : '';

  const showBytes = progress?.phase === 'downloading' && progress.bytesDownloaded > 0;
  const percent = progress?.percent ?? 0;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--panel)',
        padding: 24, borderRadius: 10, minWidth: 380,
        border: '1px solid var(--accent-glow)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>
          {error ? (cancelled ? 'Download cancelled' : 'Download failed') : 'Downloading from Veo'}
        </div>
        {!error && (
          <div className="dim" style={{ marginBottom: 8 }}>
            {phaseLabel}
            {progress?.phase === 'downloading' && (
              <> — {progress.totalBytes ? `${percent}%` : 'starting…'}</>
            )}
          </div>
        )}
        {!error && showBytes && (
          <div className="dim" style={{ marginBottom: 8, fontSize: 12 }}>
            {formatBytes(progress!.bytesDownloaded)}
            {progress!.totalBytes && <> of {formatBytes(progress!.totalBytes)}</>}
          </div>
        )}
        {error && (
          <div
            className="dim"
            style={{
              marginBottom: 8,
              color: cancelled ? 'var(--muted)' : 'var(--danger)',
              maxWidth: 420,
            }}>
            {cancelled ? 'You stopped the download.' : error}
          </div>
        )}
        <div style={{
          height: 6,
          background: 'var(--panel-2)',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          <div style={{
            width: `${error ? 0 : percent}%`,
            height: '100%',
            background: 'var(--accent)',
            boxShadow: '0 0 10px rgba(109, 209, 13, 0.45)',
            transition: 'width 200ms ease-out',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {!error && <button onClick={onCancel}>Cancel</button>}
          {error && <button className="primary" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
