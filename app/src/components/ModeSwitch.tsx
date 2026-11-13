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
    <nav aria-label="Mode selector" className="s48-mode-switch">
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`s48-mode-btn ${currentMode === mode.id ? 's48-mode-btn-active' : ''}`}
          onClick={() => onModeChange(mode.id)}
          aria-current={currentMode === mode.id ? 'page' : undefined}
        >
          {mode.label}
        </button>
      ))}
    </nav>
  );
};
