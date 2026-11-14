// Written with AI assistance, directed and reviewed by the team.

/**
 * Pure camera and coordinate math for Walk and Visor globe views.
 */

import type { RouteGrid } from '../../lib/grid';
import type { TrackVertex } from '../../walk/track';
import { eyeHeightM } from '../frame';

/**
 * Computes exact eye camera height on the Cesium surface.
 * Adds site height offset and eye height (1.7 m) to bundle elevation.
 */
export function computeEyeHeight(bundleElevM: number, heightOffsetM: number, eyeM = 1.7): number {
  return eyeHeightM(bundleElevM, heightOffsetM, eyeM);
}

/**
 * Calculates heading along a route track at a given along_m distance.
 * Returns bearing in degrees [0, 360).
 */
export function headingFromTrack(vertices: TrackVertex[], alongM: number): number {
  if (vertices.length < 2) return 0;

  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (b.along_m > a.along_m && b.along_m >= alongM) {
      const deg = (Math.atan2(b.x_m - a.x_m, b.y_m - a.y_m) * 180) / Math.PI;
      return (deg + 360) % 360;
    }
  }

  // If at or past the end, return the bearing of the final segment
  const n = vertices.length;
  for (let i = n - 1; i > 0; i--) {
    if (vertices[i].along_m > vertices[i - 1].along_m) {
      const deg = (Math.atan2(vertices[i].x_m - vertices[i - 1].x_m, vertices[i].y_m - vertices[i - 1].y_m) * 180) / Math.PI;
      return (deg + 360) % 360;
    }
  }

  return 0;
}

/**
 * Ground height on the Cesium surface from the elevation grid and measured site offset.
 * Falls back to heightOffsetM if grid or point elevation is unavailable.
 */
export function groundHeightAt(
  grid: Pick<RouteGrid, 'lonlatToRowCol' | 'isInside' | 'getElevation'> | null,
  lon: number,
  lat: number,
  heightOffsetM: number,
): number {
  if (!grid) return heightOffsetM;
  const { row, col } = grid.lonlatToRowCol(lon, lat);
  if (!grid.isInside(row, col)) return heightOffsetM;
  const elev = grid.getElevation(row, col);
  if (!Number.isFinite(elev)) return heightOffsetM;
  return elev + heightOffsetM;
}
