import type { SiteTerrain } from '../types';

/** MapLibre custom DEM factors: elevation = r·R + g·G + b·B + baseShift. */
export const DEM_DECODING = {
  mapbox: { redFactor: 6553.6, greenFactor: 25.6, blueFactor: 0.1, baseShift: -10000 },
  terrarium: { redFactor: 256, greenFactor: 1, blueFactor: 1 / 256, baseShift: -32768 },
} as const;

/** Offset decoded Mars elevations so MapLibre receives non-negative heights. */
export function shiftedDemDecoding(terrain: SiteTerrain) {
  const decoding = DEM_DECODING[terrain.encoding];
  return { ...decoding, baseShift: decoding.baseShift - terrain.min_m };
}
