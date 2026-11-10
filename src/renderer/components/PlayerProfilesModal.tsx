import React, { useEffect, useRef, useState } from 'react';
import { usePlayerProfiles } from '../state/playerProfiles';

export function PlayerProfilesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profiles, saveProfile, deleteProfile } = usePlayerProfiles();
  const [editingId, setEditingId] = useState<string>();
  const [name, setName] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  function reset() { setEditingId(undefined); setName(''); setShortcut(''); setError(''); }
  useEffect(() => {
    if (open) { reset(); dialogRef.current?.showModal(); }
    else dialogRef.current?.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="players-dialog" aria-labelledby="players-title"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === dialogRef.current) onClose(); }}>
      <div className="players-dialog-heading">
        <h2 id="players-title">Saved players</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="dim">Available in every video and project on this computer. Press a player’s letter while watching to bookmark their play. B adds a general bookmark.</p>
      <div className="players-saved-list">
        {profiles.length === 0 && <p className="dim">No saved players yet. Add your first player below.</p>}
        {profiles.map(player => (
          <div className="players-saved-row" key={player.id}>
            <kbd>{player.shortcut.toUpperCase()}</kbd>
            <span>{player.name}</span>
            <button aria-label={`Edit ${player.name}`} onClick={() => {
              setEditingId(player.id); setName(player.name); setShortcut(player.shortcut); setError('');
              nameRef.current?.focus();
            }}>Edit</button>
            <button aria-label={`Remove ${player.name}`} onClick={() => {
              const result = deleteProfile(player.id);
              if (result) setError(result);
              else if (editingId === player.id) reset();
            }}>Remove</button>
          </div>
        ))}
      </div>
      <form className="players-form" onSubmit={e => {
        e.preventDefault();
        const result = saveProfile({ name, shortcut }, editingId);
        if (result) setError(result);
        else { reset(); nameRef.current?.focus(); }
      }}>
        <h3>{editingId ? 'Edit player' : 'Add a player'}</h3>
        <div className="players-form-fields">
          <label>Player name<input ref={nameRef} autoFocus value={name} maxLength={80} required
            onChange={e => setName(e.target.value)} placeholder="e.g. Alex Smith" /></label>
          <label className="players-letter">Letter<input value={shortcut.toUpperCase()} maxLength={1} required
            onChange={e => setShortcut(e.target.value)} placeholder="A" /></label>
        </div>
        {error && <p role="alert" className="players-error">{error}</p>}
        <div className="players-form-actions">
          <button type="submit" className="primary">{editingId ? 'Save changes' : 'Save player'}</button>
          {editingId && <button type="button" onClick={reset}>Cancel edit</button>}
        </div>
      </form>
      <p className="dim players-footnote">Removing a profile keeps its existing bookmarks and tag names.</p>
    </dialog>
  );
}
