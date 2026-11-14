// Written with AI assistance, directed and reviewed by the team.

import React from 'react';

interface ScaleBarProps {
  metresPerPixel: number;
}

const CANDIDATES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];

export const ScaleBar: React.FC<ScaleBarProps> = ({ metresPerPixel }) => {
  const safeScale = Number.isFinite(metresPerPixel) && metresPerPixel > 0 ? metresPerPixel : 1;
  const distance = CANDIDATES.reduce((best, value) => {
    const width = value / safeScale;
    if (width < 50 || width > 220) return best;
    return Math.abs(width - 120) < Math.abs(best / safeScale - 120) ? value : best;
  }, CANDIDATES[0]);
  const pixelWidth = Math.max(50, Math.min(220, Math.round(distance / safeScale)));
  const label = distance >= 1000 ? `${distance / 1000} km` : `${distance} m`;

  return (
    <div
      className="map-ui"
      style={{ left: 'var(--space-4)', bottom: 'calc(var(--space-4) + var(--space-6))' }}
      title="Mars ground scale"
    >
      <div className="s48-scale" style={{ width: `${pixelWidth}px` }}>
        <div className="s48-scale__label">{label}</div>
        <div className="s48-scale__bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
};
