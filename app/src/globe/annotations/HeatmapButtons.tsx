// Written with AI assistance, directed and reviewed by the team.
// Two-item segmented control for the headline heatmaps in the map controls; one on at a time.

import React from 'react';
import type { GlobeLayer } from '../layerManifest';
import { HEATMAPS } from './heatmaps';

interface HeatmapButtonsProps {
  layers: GlobeLayer[];
  states: Record<string, { enabled: boolean }>;
  onChoose: (id: string) => void;
}

export const HeatmapButtons: React.FC<HeatmapButtonsProps> = ({ layers, states, onChoose }) => {
  const shown = HEATMAPS.filter((h) => layers.some((l) => l.id === h.id));
  if (!shown.length) return null;
  return (
    <div className="s48-seg" role="group" aria-label="Heatmap">
      {shown.map((h) => (
        <button key={h.id} type="button" aria-pressed={!!states[h.id]?.enabled} onClick={() => onChoose(h.id)}>
          {h.label}
        </button>
      ))}
    </div>
  );
};
