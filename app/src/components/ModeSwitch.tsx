// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { AppMode } from '../types';

interface ModeSwitchProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export const ModeSwitch: React.FC<ModeSwitchProps> = ({ currentMode, onModeChange }) => {
  const modes: { id: AppMode; label: string; description: string }[] = [
    { id: 'plan', label: 'Plan', description: 'Habitat Route Console' },
    { id: 'walk', label: 'Walk', description: 'Tablet Field Navigation' },
    { id: 'visor', label: 'Visor', description: 'Helmet HUD & Imagery' },
  ];

  return (
    <div
      style={{
        display: 'inline-flex',
        backgroundColor: '#0f172a',
        borderRadius: '6px',
        padding: '3px',
        border: '1px solid #334155',
      }}
    >
      {modes.map((mode) => {
        const isActive = currentMode === mode.id;
        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? '#ffffff' : '#94a3b8',
              backgroundColor: isActive ? '#2563eb' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title={mode.description}
          >
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
};
