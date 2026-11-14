// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { AppMode } from '../types';

interface ModeSwitchProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export const ModeSwitch: React.FC<ModeSwitchProps> = ({ currentMode, onModeChange }) => {
  const modes: { id: AppMode; label: string }[] = [
    { id: 'plan', label: 'Plan' },
    { id: 'walk', label: 'Walk' },
    { id: 'visor', label: 'Visor' },
  ];

  return (
    <div className="s48-seg" role="group" aria-label="Mode">
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          aria-pressed={currentMode === mode.id}
          onClick={() => onModeChange(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
};
