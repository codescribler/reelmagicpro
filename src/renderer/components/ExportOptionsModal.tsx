import React, { useEffect, useState } from 'react';
import type { ExportFormat, Clip, SourceMeta } from '../../shared/types';
import { InstagramPreviewCanvas } from './InstagramPreviewCanvas';
import type { ExportSelection } from '../../shared/exportTargets';

export interface ExportOptionsResult {
  ok: boolean;
  format?: ExportSelection;
  sequenceMode?: 'combined' | 'individual';
}

export type ExportOptionsContext =
  | { kind: 'clip'; clip: Clip; source: SourceMeta }
  | { kind: 'sequence'; firstClip?: Clip; source: SourceMeta; clipCount?: number };

// Pre-export options dialog. Lets the user pick format (Standard or
// Instagram). When Instagram is selected, shows a live preview canvas of the
// first clip's IG framing so the user can verify the player stays in shot
// before committing to the export.
export function ExportOptionsModal(props: {
  open: boolean;
  initialFormat?: ExportFormat;
  context: ExportOptionsContext;
  onResolve: (r: ExportOptionsResult) => void;
}) {
  const { open, initialFormat = 'standard', context, onResolve } = props;
  const [format, setFormat] = useState<ExportSelection>(initialFormat);
  const [sequenceMode, setSequenceMode] = useState<'combined' | 'individual'>('combined');

  useEffect(() => { if (open) setFormat(initialFormat); }, [open, initialFormat]);
  useEffect(() => { if (open) setSequenceMode('combined'); }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onResolve({ ok: false }); }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [open, onResolve]);

  if (!open) return null;

  const previewClip: Clip | undefined =
    context.kind === 'clip' ? context.clip : context.firstClip;
  const individual = context.kind === 'sequence' && sequenceMode === 'individual';

  return (
    <div onClick={() => onResolve({ ok: false })} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="export-options-title"
        onClick={e => e.stopPropagation()} style={{
        background: 'var(--panel)', border: '1px solid var(--accent-glow)',
        borderRadius: 10, padding: 24, width: 520, maxWidth: '92vw',
        maxHeight: '88vh', overflow: 'hidden', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h2 id="export-options-title" style={{ margin: 0, fontSize: 16 }}>Export options</h2>
          <button onClick={() => onResolve({ ok: false })}>Cancel</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', minHeight: 0 }}>
        {context.kind === 'sequence' && <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Export as</div>
          <div role="group" aria-label="Export as" style={{ display: 'flex', gap: 6 }}>
            <button className={sequenceMode === 'combined' ? 'primary' : ''}
              aria-pressed={sequenceMode === 'combined'} onClick={() => setSequenceMode('combined')}>
              Combined video
            </button>
            <button className={individual ? 'primary' : ''}
              aria-pressed={individual} onClick={() => setSequenceMode('individual')}>
              Individual clips
            </button>
          </div>
        </div>}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Format</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={format === 'standard' ? 'primary' : ''}
              aria-pressed={format === 'standard'}
              onClick={() => setFormat('standard')}
            >Standard (16:9)</button>
            <button
              className={format === 'instagram' ? 'primary' : ''}
              aria-pressed={format === 'instagram'}
              onClick={() => setFormat('instagram')}
            >Instagram (9:16)</button>
            <button className={format === 'both' ? 'primary' : ''}
              aria-pressed={format === 'both'}
              onClick={() => setFormat('both')}>Both</button>
          </div>
        </div>
        {format === 'both' && <div className="dim" style={{ fontSize: 12 }}>
          {individual ? 'Saves Standard and Instagram versions in separate subfolders.'
            : 'Saves two files with _standard and _instagram suffixes. Exports run one after the other.'}
        </div>}
        {individual && context.kind === 'sequence' && <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
          Saves {context.clipCount ? `${context.clipCount * (format === 'both' ? 2 : 1)} files` : 'the clips'} in a new
          {' '}folder named after this sequence. Choose its location next.
          <div>Numbered in sequence order, using each clip’s own edits, music and brightness settings.</div>
        </div>}
        {format !== 'standard' && previewClip && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="dim" style={{ fontSize: 12 }}>
              {driverSummary(previewClip, context.source)}
            </div>
            <InstagramPreviewCanvas clip={previewClip} source={context.source} />
          </div>
        )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
          <button className="primary" onClick={() => onResolve({ ok: true, format,
            ...(context.kind === 'sequence' ? { sequenceMode } : {}) })}>
            {individual ? 'Choose location…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function driverSummary(clip: Clip, _source: SourceMeta): string {
  const path = clip.reelFraming?.panPath;
  if (!path || path.length < 2) {
    return 'Reel not framed — using a static, centred crop.';
  }
  const span = (path[path.length - 1]!.t - path[0]!.t).toFixed(1);
  return `Reel framed — panned over ${span}s.`;
}
