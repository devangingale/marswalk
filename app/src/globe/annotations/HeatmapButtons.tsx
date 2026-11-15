// Written with AI assistance, directed and reviewed by the team.
// Map-control toggles for the two headline heatmaps; one on at a time.

import React from 'react';
import type { GlobeLayer } from '../layerManifest';
import { HEATMAPS } from './heatmaps';

interface HeatmapButtonsProps {
  layers: GlobeLayer[];
  states: Record<string, { enabled: boolean }>;
  onChoose: (id: string) => void;
}

export const HeatmapButtons: React.FC<HeatmapButtonsProps> = ({ layers, states, onChoose }) => (
  <>
    {HEATMAPS.filter((h) => layers.some((l) => l.id === h.id)).map((h) => (
      <button
        key={h.id}
        type="button"
        className="s48-btn s48-btn--secondary"
        aria-pressed={!!states[h.id]?.enabled}
        onClick={() => onChoose(h.id)}
      >
        {h.label}
      </button>
    ))}
  </>
);
