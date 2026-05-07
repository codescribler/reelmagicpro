import React, { useRef, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import type { Clip, FocusMarker } from '../../shared/types';

const MARKER_COLORS = ['yellow', 'red', 'lime', 'cyan', 'magenta', 'orange', 'white'];

// Each click of − / + scales the marker by this factor (preserving aspect).
const SIZE_STEP = 1.15;
const MIN_DIMENSION = 10;

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function newMarkerId(): string {
  return 'fm_' + Math.random().toString(36).slice(2, 10);
}

export function ClipFocusMarkers({ clip }: { clip: Clip }) {
  const addMarker = useProjectStore(s => s.addFocusMarker);
  const updateMarker = useProjectStore(s => s.updateFocusMarker);
  const deleteMarker = useProjectStore(s => s.deleteFocusMarker);
  const togglePrimaryMarker = useProjectStore(s => s.togglePrimaryMarker);
  const setMode = useProjectStore(s => s.setPreviewMode);
  const project = useProjectStore(s => s.project);

  // Identify which marker drives Instagram framing for this clip.
  // Explicit primary wins; otherwise the first marker is the implicit driver.
  const explicitPrimary = clip.focusMarkers.find(m => m.primary === true);
  const implicitPrimaryId = explicitPrimary
    ? explicitPrimary.id
    : (clip.focusMarkers[0]?.id ?? null);

  // Star UI is only meaningful when there's a choice to make. With one
  // marker, it's automatically primary — the star is just clutter and a
  // question mark in the user's head.
  const showPrimaryStar = clip.focusMarkers.length >= 2;

  function handleAdd() {
    if (!project) return;
    const sw = project.sourceVideo.width;
    const sh = project.sourceVideo.height;
    const w = Math.round(sw * 0.15);
    const h = Math.round(sh * 0.25);
    const m: FocusMarker = {
      id: newMarkerId(),
      x: Math.round((sw - w) / 2),
      y: Math.round((sh - h) / 2),
      width: w,
      height: h,
      in: clip.in,
      out: clip.out,
      color: MARKER_COLORS[clip.focusMarkers.length % MARKER_COLORS.length] || 'yellow',
      shape: 'rect',
    };
    addMarker(clip.id, m);
    setMode({ kind: 'track-marker', clipId: clip.id, markerId: m.id });
  }

  return (
    <div>
      {clip.focusMarkers.length === 0 ? (
        <>
          <p className="dim" style={{ fontSize: 12, margin: '0 0 8px 0' }}>
            Tag your kid in the video below. The tag follows them so the focus box and the Reel framing can stay on them.
          </p>
          <button className="primary" onClick={handleAdd} title="Tag a player and follow them with the mouse">
            + Tag a player
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
            {clip.focusMarkers.map(m => (
              <MarkerRow
                key={m.id}
                clip={clip}
                marker={m}
                sourceWidth={project?.sourceVideo.width ?? 1}
                sourceHeight={project?.sourceVideo.height ?? 1}
                showPrimaryStar={showPrimaryStar}
                implicitPrimary={!m.primary && m.id === implicitPrimaryId}
                onUpdate={patch => updateMarker(clip.id, m.id, patch)}
                onDelete={() => deleteMarker(clip.id, m.id)}
                onTogglePrimary={() => togglePrimaryMarker(clip.id, m.id)}
                onTrack={() => setMode({ kind: 'track-marker', clipId: clip.id, markerId: m.id })}
                onClearPath={() => updateMarker(clip.id, m.id, { path: undefined })}
              />
            ))}
          </div>
          <button onClick={handleAdd} title="Tag another player">
            + Tag another player
          </button>
        </>
      )}
    </div>
  );
}

function scaleMarker(
  marker: FocusMarker, factor: number, sw: number, sh: number,
): Partial<FocusMarker> {
  const newW = Math.round(Math.max(MIN_DIMENSION, Math.min(sw, marker.width * factor)));
  const newH = Math.round(Math.max(MIN_DIMENSION, Math.min(sh, marker.height * factor)));
  if (marker.path && marker.path.length > 0) {
    return { width: newW, height: newH };
  }
  const cx = marker.x + marker.width / 2;
  const cy = marker.y + marker.height / 2;
  let newX = Math.round(cx - newW / 2);
  let newY = Math.round(cy - newH / 2);
  if (newX < 0) newX = 0;
  if (newY < 0) newY = 0;
  if (newX + newW > sw) newX = sw - newW;
  if (newY + newH > sh) newY = sh - newH;
  return { x: newX, y: newY, width: newW, height: newH };
}

function MarkerRow({ clip, marker, sourceWidth, sourceHeight, showPrimaryStar, implicitPrimary, onUpdate, onDelete, onTogglePrimary, onTrack, onClearPath }: {
  clip: Clip;
  marker: FocusMarker;
  sourceWidth: number;
  sourceHeight: number;
  showPrimaryStar: boolean;
  implicitPrimary: boolean;
  onUpdate: (patch: Partial<FocusMarker>) => void;
  onDelete: () => void;
  onTogglePrimary: () => void;
  onTrack: () => void;
  onClearPath: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [showMore, setShowMore] = useState(false);

  const clipDuration = clip.out - clip.in;
  const inPct = ((marker.in - clip.in) / clipDuration) * 100;
  const outPct = ((marker.out - clip.in) / clipDuration) * 100;
  const shape = marker.shape ?? 'rect';
  const hasPath = !!(marker.path && marker.path.length > 0);

  function pixelToClipTime(clientX: number): number {
    const el = stripRef.current!;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return clip.in + (x / rect.width) * clipDuration;
  }

  function startDrag(end: 'in' | 'out') {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const onMove = (ev: MouseEvent) => {
        const t = pixelToClipTime(ev.clientX);
        if (end === 'in') {
          const newIn = Math.max(clip.in, Math.min(marker.out - 0.05, t));
          onUpdate({ in: newIn });
        } else {
          const newOut = Math.min(clip.out, Math.max(marker.in + 0.05, t));
          onUpdate({ out: newOut });
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
  }

  function resize(factor: number) {
    onUpdate(scaleMarker(marker, factor, sourceWidth, sourceHeight));
  }

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          width: 12, height: 12,
          borderRadius: shape === 'oval' ? '50%' : 2,
          background: marker.color,
          border: '1px solid var(--border)',
          flex: '0 0 auto',
        }} />
        {showPrimaryStar && (
          <button
            onClick={onTogglePrimary}
            title={marker.primary
              ? 'Primary marker — Reel framing follows this player. Click to unset.'
              : implicitPrimary
                ? 'First tag — drives Reel framing by default. Click to make explicit.'
                : 'Make this the primary tag — Reel framing will follow this player.'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              opacity: marker.primary ? 1 : implicitPrimary ? 0.45 : 0.25,
              fontSize: 14,
              padding: '0 2px',
              color: marker.primary ? 'var(--accent)' : 'var(--text)',
              flex: '0 0 auto',
            }}
          >★</button>
        )}
        <input
          placeholder="Label (e.g. Player 7)"
          value={marker.label ?? ''}
          onChange={e => onUpdate({ label: e.target.value })}
          style={{
            flex: 1, minWidth: 0, padding: '4px 6px',
            background: 'var(--panel-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 3, fontSize: 12,
          }}
        />
        <button onClick={onDelete} title="Delete this tag" style={{ flex: '0 0 auto' }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className={hasPath ? '' : 'primary'}
          onClick={onTrack}
          title={hasPath
            ? 'Re-record the path: video plays at 0.5× and the tag follows your mouse'
            : 'Play at 0.5× and follow the player with your mouse to record their path'}>
          {hasPath ? `Re-record path (${marker.path!.length} pts)` : 'Follow with mouse'}
        </button>
        <button
          onClick={() => setShowMore(v => !v)}
          title="Show advanced options for this tag"
          style={{ marginLeft: 'auto' }}>
          More options {showMore ? '▴' : '▾'}
        </button>
      </div>
      {showMore && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="dim" style={{ fontSize: 11 }}>Shape</span>
            <select
              value={shape}
              onChange={e => onUpdate({ shape: e.target.value as 'rect' | 'oval' })}
              style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11 }}>
              <option value="rect">Rect</option>
              <option value="oval">Oval</option>
            </select>
            <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>Colour</span>
            <select
              value={marker.color}
              onChange={e => onUpdate({ color: e.target.value })}
              style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11 }}>
              {MARKER_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>Size</span>
            <button onClick={() => resize(1 / SIZE_STEP)} title="Shrink tag">−</button>
            <button onClick={() => resize(SIZE_STEP)} title="Enlarge tag">+</button>
          </div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
            Active from {fmtTime(marker.in)} to {fmtTime(marker.out)} — drag the handles to limit when the tag is shown.
          </div>
          <div ref={stripRef}
            style={{ position: 'relative', height: 18, background: '#15171b', borderRadius: 3, marginBottom: 6 }}>
            <div style={{
              position: 'absolute', left: `${inPct}%`, width: `${outPct - inPct}%`,
              top: 0, bottom: 0,
              background: marker.color, opacity: 0.4,
            }} />
            <div onMouseDown={startDrag('in')}
              title="Drag to set when the tag appears"
              style={{
                position: 'absolute', left: `${inPct}%`, top: -2, bottom: -2,
                width: 6, marginLeft: -3,
                background: marker.color, border: '1px solid black',
                cursor: 'ew-resize',
              }} />
            <div onMouseDown={startDrag('out')}
              title="Drag to set when the tag disappears"
              style={{
                position: 'absolute', left: `${outPct}%`, top: -2, bottom: -2,
                width: 6, marginLeft: -3,
                background: marker.color, border: '1px solid black',
                cursor: 'ew-resize',
              }} />
          </div>
          {hasPath && (
            <button onClick={onClearPath} title="Remove the recorded path so the tag stays in one spot">
              Clear path
            </button>
          )}
        </div>
      )}
    </div>
  );
}
