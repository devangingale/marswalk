// Written with AI assistance, directed and reviewed by the team.

import { MARS_RADIUS_METERS } from '../config';

export interface MarsScaleResult {
  distanceMeters: number;
  pixelWidth: number;
  label: string;
  metersPerPixel: number;
}

const SCALE_CANDIDATES = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000
];

/**
 * Calculates true ground distance in Mars metres along a parallel of latitude (contracts section 3).
 * x_m = R · cos(lat) · radians(lon2 - lon1)
 */
export function calculateMarsDistanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const avgLatRad = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLonRad = Math.abs(lon2 - lon1) * (Math.PI / 180);
  const dLatRad = Math.abs(lat2 - lat1) * (Math.PI / 180);

  const dx = MARS_RADIUS_METERS * Math.cos(avgLatRad) * dLonRad;
  const dy = MARS_RADIUS_METERS * dLatRad;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the scale bar representation for a given screen span and coordinate bounds.
 *
 * @param lonLeft Longitude at left edge of pixel span
 * @param lonRight Longitude at right edge of pixel span
 * @param latitude Centre latitude of the span
 * @param screenPixelSpan Width of the test span on screen in pixels (e.g. 100px)
 * @param targetBarWidth Target width in pixels for the rendered scale bar (default 120px)
 */
export function calculateMarsScaleBar(
  lonLeft: number,
  lonRight: number,
  latitude: number,
  screenPixelSpan: number,
  targetBarWidth = 120
): MarsScaleResult {
  if (screenPixelSpan <= 0 || lonLeft === lonRight) {
    return {
      distanceMeters: 100,
      pixelWidth: 100,
      label: '100 m',
      metersPerPixel: 1,
    };
  }

  const dLonRad = Math.abs(lonRight - lonLeft) * (Math.PI / 180);
  const latRad = latitude * (Math.PI / 180);
  const trueSpanDistanceMeters = MARS_RADIUS_METERS * Math.cos(latRad) * dLonRad;
  const metersPerPixel = trueSpanDistanceMeters / screenPixelSpan;

  const targetMeters = targetBarWidth * metersPerPixel;

  // Find candidate whose pixel width is closest to targetBarWidth and between 60px and 200px
  let bestCandidate = SCALE_CANDIDATES[0];
  let minDiff = Infinity;

  for (const candidate of SCALE_CANDIDATES) {
    const px = candidate / metersPerPixel;
    if (px >= 50 && px <= 220) {
      const diff = Math.abs(px - targetBarWidth);
      if (diff < minDiff) {
        minDiff = diff;
        bestCandidate = candidate;
      }
    }
  }

  // Fallback if no candidate in 50-220px range
  if (minDiff === Infinity) {
    bestCandidate = SCALE_CANDIDATES.reduce((prev, curr) =>
      Math.abs(curr - targetMeters) < Math.abs(prev - targetMeters) ? curr : prev
    );
  }

  const pixelWidth = Math.round(bestCandidate / metersPerPixel);
  const label =
    bestCandidate >= 1000
      ? `${bestCandidate / 1000} km`
      : `${bestCandidate} m`;

  return {
    distanceMeters: bestCandidate,
    pixelWidth,
    label,
    metersPerPixel,
  };
}
