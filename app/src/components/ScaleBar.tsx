// Written with AI assistance, directed and reviewed by the team.

import React, { useRef } from 'react';

interface ScaleBarProps {
  metresPerPixel: number;
}

/** 1-2-5 steps from 1 m to 50 km. */
export const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];
const MIN_PX = 50;
const MAX_PX = 220;
const TARGET_PX = 120;
/** A shown step stays until its bar leaves this wider band, so small changes never flip the label. */
const KEEP_MIN_PX = 40;
const KEEP_MAX_PX = 260;

/** The step closest to TARGET_PX wide, keeping the previous one while it still fits the wider band. */
export function pickScaleStep(metresPerPixel: number, previous: number | null): number {
  const safe = Number.isFinite(metresPerPixel) && metresPerPixel > 0 ? metresPerPixel : 1;
  if (previous !== null) {
    const width = previous / safe;
    if (width >= KEEP_MIN_PX && width <= KEEP_MAX_PX) return previous;
  }
  const fitting = SCALE_STEPS.filter((step) => step / safe >= MIN_PX && step / safe <= MAX_PX);
  const pool = fitting.length ? fitting : SCALE_STEPS;
  return pool.reduce((best, step) => (Math.abs(step / safe - TARGET_PX) < Math.abs(best / safe - TARGET_PX) ? step : best));
}

export const ScaleBar: React.FC<ScaleBarProps> = ({ metresPerPixel }) => {
  const previous = useRef<number | null>(null);
  const safeScale = Number.isFinite(metresPerPixel) && metresPerPixel > 0 ? metresPerPixel : 1;
  const distance = pickScaleStep(safeScale, previous.current);
  previous.current = distance;
  const pixelWidth = Math.round(distance / safeScale);
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
