import React, { useRef } from 'react';
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
  // The star UI shows filled / half-faded / outline accordingly.
  const explicitPrimary = clip.focusMarkers.find(m => m.primary === true);
  const implicitPrimaryId = explicitPrimary
    ? explicitPrimary.id
    : (clip.focusMarkers[0]?.id ?? null);

  function handleAdd() {
    if (!project) return;
    const sw = project.sourceVideo.width;
    const sh = project.sourceVideo.height;
    // Default size — the user said this default is ideal. Track mode will set
    // the position from where they click on the player, so the initial x/y
    // here only matters if they cancel out of tracking before clicking.
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
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="dim" style={{ fontSize: 11 }}>Focus markers ({clip.focusMarkers.length})</span>
        <button onClick={handleAdd}>+ Add focus marker</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {clip.focusMarkers.map(m => (
          <MarkerRow
            key={m.id}
            clip={clip}
            marker={m}
            sourceWidth={project?.sourceVideo.width ?? 1}
            sourceHeight={project?.sourceVideo.height ?? 1}
            implicitPrimary={!m.primary && m.id === implicitPrimaryId}
            onUpdate={patch => updateMarker(clip.id, m.id, patch)}
            onDelete={() => deleteMarker(clip.id, m.id)}
            onTogglePrimary={() => togglePrimaryMarker(clip.id, m.id)}
            onTrack={() => setMode({ kind: 'track-marker', clipId: clip.id, markerId: m.id })}
            onClearPath={() => updateMarker(clip.id, m.id, { path: undefined })}
          />
        ))}
      </div>
    </div>
  );
}

// Scale a marker proportionally around its centre, clamped to source bounds
// and a minimum size. Path-based markers store their position on the path
// rather than x/y, so we leave those fields alone — width/height changes are
// picked up by both preview and export regardless.
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

function MarkerRow({ clip, marker, sourceWidth, sourceHeight, implicitPrimary, onUpdate, onDelete, onTogglePrimary, onTrack, onClearPath }: {
  clip: Clip;
  marker: FocusMarker;
  sourceWidth: number;
  sourceHeight: number;
  implicitPrimary: boolean;
  onUpdate: (patch: Partial<FocusMarker>) => void;
  onDelete: () => void;
  onTogglePrimary: () => void;
  onTrack: () => void;
  onClearPath: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  const clipDuration = clip.out - clip.in;
  const inPct = ((marker.in - clip.in) / clipDuration) * 100;
  const outPct = ((marker.out - clip.in) / clipDuration) * 100;
  const shape = marker.shape ?? 'rect';

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
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          width: 12, height: 12,
          borderRadius: shape === 'oval' ? '50%' : 2,
          background: marker.color,
          border: '1px solid var(--border)',
        }} />
        <button
          onClick={onTogglePrimary}
          title={marker.primary
            ? 'Primary marker for Instagram framing — click to unset'
            : implicitPrimary
              ? 'First marker — drives Instagram framing by default. Click to make explicit.'
              : 'Set as primary marker for Instagram framing'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            opacity: marker.primary ? 1 : implicitPrimary ? 0.45 : 0.25,
            fontSize: 14,
            padding: '0 2px',
            color: marker.primary ? 'var(--accent)' : 'var(--text)',
          }}
        >★</button>
        <span className="dim" style={{ fontSize: 11, flex: 1 }}>
          in {fmtTime(marker.in)} → out {fmtTime(marker.out)}
        </span>
        <select
          value={shape}
          onChange={e => onUpdate({ shape: e.target.value as 'rect' | 'oval' })}
          title="Marker shape"
          style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11 }}>
          <option value="rect">Rect</option>
          <option value="oval">Oval</option>
        </select>
        <select
          value={marker.color}
          onChange={e => onUpdate({ color: e.target.value })}
          style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11 }}>
          {MARKER_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <input
        placeholder="Label (e.g. Player 7)"
        value={marker.label ?? ''}
        onChange={e => onUpdate({ label: e.target.value })}
        style={{
          width: '100%', padding: 4, marginBottom: 6,
          background: 'var(--panel)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 3, fontSize: 12,
        }}
      />
      <div ref={stripRef}
        style={{ position: 'relative', height: 18, background: '#15171b', borderRadius: 3, marginBottom: 6 }}>
        <div style={{
          position: 'absolute', left: `${inPct}%`, width: `${outPct - inPct}%`,
          top: 0, bottom: 0,
          background: marker.color, opacity: 0.4,
        }} />
        <div onMouseDown={startDrag('in')}
          title="Drag to set when the marker appears"
          style={{
            position: 'absolute', left: `${inPct}%`, top: -2, bottom: -2,
            width: 6, marginLeft: -3,
            background: marker.color, border: '1px solid black',
            cursor: 'ew-resize',
          }} />
        <div onMouseDown={startDrag('out')}
          title="Drag to set when the marker disappears"
          style={{
            position: 'absolute', left: `${outPct}%`, top: -2, bottom: -2,
            width: 6, marginLeft: -3,
            background: marker.color, border: '1px solid black',
            cursor: 'ew-resize',
          }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="dim" style={{ fontSize: 11 }}>Size</span>
        <button onClick={() => resize(1 / SIZE_STEP)} title="Shrink marker">−</button>
        <button onClick={() => resize(SIZE_STEP)} title="Enlarge marker">+</button>
        <button onClick={onTrack} title="Re-track the player by moving your mouse while the video plays at 0.5×">
          Track {marker.path && marker.path.length > 0 ? `(${marker.path.length} pts)` : ''}
        </button>
        {marker.path && marker.path.length > 0 && (
          <button onClick={onClearPath} title="Remove the recorded motion path so the marker stays static">
            Clear path
          </button>
        )}
        <button onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
