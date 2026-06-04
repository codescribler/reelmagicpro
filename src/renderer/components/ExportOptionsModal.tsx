import React, { useEffect, useState } from 'react';
import type { ExportFormat, Clip, SourceMeta } from '../../shared/types';
import { InstagramPreviewCanvas } from './InstagramPreviewCanvas';

export interface ExportOptionsResult {
  ok: boolean;
  format?: ExportFormat;
}

export type ExportOptionsContext =
  | { kind: 'clip'; clip: Clip; source: SourceMeta }
  | { kind: 'sequence'; firstClip?: Clip; source: SourceMeta };

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
  const [format, setFormat] = useState<ExportFormat>(initialFormat);

  useEffect(() => { if (open) setFormat(initialFormat); }, [open, initialFormat]);

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

  return (
    <div onClick={() => onResolve({ ok: false })} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--panel)', border: '1px solid var(--accent-glow)',
        borderRadius: 10, padding: 24, width: 520, maxWidth: '92vw',
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Export options</h2>
          <button onClick={() => onResolve({ ok: false })}>Cancel</button>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Format</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={format === 'standard' ? 'primary' : ''}
              onClick={() => setFormat('standard')}
            >Standard (16:9)</button>
            <button
              className={format === 'instagram' ? 'primary' : ''}
              onClick={() => setFormat('instagram')}
            >Instagram (9:16)</button>
          </div>
        </div>
        {format === 'instagram' && previewClip && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="dim" style={{ fontSize: 12 }}>
              {driverSummary(previewClip, context.source)}
            </div>
            <InstagramPreviewCanvas clip={previewClip} source={context.source} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button className="primary" onClick={() => onResolve({ ok: true, format })}>
            Continue
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
