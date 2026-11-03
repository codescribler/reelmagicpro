import React, { useState } from 'react';
import { activeNamedSequence, sequenceLibrary } from '../../shared/namedSequences';
import { useProjectStore } from '../state/projectStore';
import { saveProjectInteractive } from '../state/saveProject';
import '../styles/sequenceLibrary.css';

type Naming = { kind: 'new' | 'copy' | 'rename'; name: string };

export function SequenceLibrary() {
  const project = useProjectStore(s => s.project);
  const dirty = useProjectStore(s => s.dirty);
  const create = useProjectStore(s => s.createNamedSequence);
  const rename = useProjectStore(s => s.renameNamedSequence);
  const select = useProjectStore(s => s.selectNamedSequence);
  const remove = useProjectStore(s => s.deleteNamedSequence);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!project) return null;
  const library = sequenceLibrary(project);
  const active = activeNamedSequence(project);

  function edit(kind: Naming['kind']) {
    setError('');
    setNaming({ kind, name: kind === 'rename' ? active.name : kind === 'copy' ? `${active.name} copy` : '' });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!naming) return;
    const ok = naming.kind === 'rename' ? rename(active.id, naming.name) : create(naming.name, naming.kind === 'copy');
    if (!ok) { setError('Enter a unique name between 1 and 80 characters.'); return; }
    setNaming(null);
    setError('');
  }

  async function save() {
    setSaving(true);
    try { setSaved(await saveProjectInteractive()); }
    finally { setSaving(false); }
  }

  return <div className="sequence-library">
    <div className="sequence-library-row">
      <label className="sequence-library-label">
        <span>Sequence</span>
        <select aria-label="Active sequence" value={active.id} disabled={saving || !!naming}
          onChange={e => select(e.target.value)}>
          {library.map(sequence => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
        </select>
      </label>
      <button disabled={saving || !!naming} onClick={() => edit('new')} title="Start an empty named sequence">+ New</button>
      <button disabled={saving || !!naming} onClick={() => edit('copy')} title="Copy this sequence with its clip order, music and brightness">Copy</button>
      <button disabled={saving || !!naming} onClick={() => edit('rename')}>Rename</button>
      <button disabled={saving || !!naming || library.length <= 1} onClick={() => {
        if (window.confirm(`Delete sequence “${active.name}”? Its clips will stay in the project.`)) remove(active.id);
      }}>Delete sequence</button>
      <span className="sequence-library-help" role="status">
        {saved && !dirty ? 'All sequences saved.' : 'Save project to keep all sequences.'}
      </span>
      <button disabled={saving || !!naming} onClick={() => void save()}>{saving ? 'Saving…' : 'Save project'}</button>
    </div>
    {naming && <form className="sequence-name-form" onSubmit={submit} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); setNaming(null); setError(''); }
    }}>
      <label>
        {naming.kind === 'new' ? 'New sequence' : naming.kind === 'copy' ? 'Copy as' : 'Sequence name'}
        <input autoFocus aria-label="Sequence name" maxLength={80} value={naming.name}
          onChange={e => { setNaming({ ...naming, name: e.target.value }); setError(''); }} />
      </label>
      <button type="submit">{naming.kind === 'rename' ? 'Save name' : 'Create sequence'}</button>
      <button type="button" onClick={() => { setNaming(null); setError(''); }}>Cancel</button>
      {error && <span role="alert">{error}</span>}
    </form>}
  </div>;
}
