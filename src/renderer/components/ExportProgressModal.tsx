import React from 'react';
import { useProjectStore } from '../state/projectStore';

export function ExportProgressModal() {
  const run = useProjectStore(s => s.activeRun);
  const result = useProjectStore(s => s.exportResult);
  const clear = useProjectStore(s => s.clearRun);

  async function cancel() {
    if (run) await window.reelmagic.cancelExport(run.runId);
  }

  if (!run && !result) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--panel)', padding: 24, borderRadius: 8, minWidth: 360, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>
          {result?.ok ? 'Export complete' : result?.ok === false ? 'Export failed' : 'Exporting…'}
        </div>
        {run && !result && (
          <div className="dim" style={{ marginBottom: 8 }}>
            {run.phase === 'concatenating' ? 'Concatenating…' : `Item ${run.currentItem} of ${run.totalItems}`}
            {' '}— {Math.round(run.percent)}%
          </div>
        )}
        {result?.ok && <div className="dim" style={{ marginBottom: 8 }}>{result.outputPath}</div>}
        {result?.ok === false && <div className="dim" style={{ marginBottom: 8, color: 'var(--danger)' }}>{result.error}</div>}
        <div style={{ height: 6, background: 'var(--panel-2)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${run?.percent ?? (result?.ok ? 100 : 0)}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {!result && <button onClick={cancel}>Cancel</button>}
          {result && <button className="primary" onClick={clear}>Close</button>}
        </div>
      </div>
    </div>
  );
}
