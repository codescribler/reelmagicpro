import React from 'react';
import type { FocusMarker } from '../../shared/types';
import { usePlayerProfiles } from '../state/playerProfiles';

type PlayerName = Pick<FocusMarker, 'label' | 'playerId'>;

export function PlayerNameField({ value, onChange, label = 'Player' }: {
  value: PlayerName;
  onChange: (patch: PlayerName) => void;
  label?: string;
}) {
  const profiles = usePlayerProfiles(s => s.profiles);
  const saved = profiles.find(p => p.id === value.playerId);
  return (
    <div className="player-name-field">
      <select aria-label={label} value={saved?.id ?? ''} onChange={e => {
        const profile = profiles.find(p => p.id === e.target.value);
        onChange(profile ? { playerId: profile.id, label: profile.name } : { playerId: undefined, label: value.label });
      }}>
        <option value="">Other player (custom name)</option>
        {profiles.map(p => <option key={p.id} value={p.id}>
          {p.id === saved?.id ? value.label ?? p.name : p.name}
        </option>)}
      </select>
      {!saved && <input aria-label={`${label} name`} placeholder="Player name (optional)" maxLength={80}
        value={value.label ?? ''} onChange={e => onChange({ playerId: undefined, label: e.target.value })} />}
    </div>
  );
}
