// Written with AI assistance, directed and reviewed by the team.

/**
 * Hazard-ahead cue for the visor: where the route passes within a set distance of
 * impassable ground (cost value `impassable`, 255, in cost.bin; contracts section 6).
 * Cells outside the grid are unknown ground and never count as a hazard.
 */

import { RouteGrid } from '../lib/grid';
import { TrackVertex } from './track';

export const HAZARD_RADIUS_M = 10;
export const HAZARD_LOOKAHEAD_M = 50;

/** For each route vertex, whether an impassable cell centre lies within `radiusM`. */
export function hazardFlags(
  vertices: TrackVertex[],
  grid: RouteGrid,
  radiusM: number = HAZARD_RADIUS_M
): boolean[] {
  const impassable = grid.header.cost.impassable;
  const reachRows = Math.ceil(radiusM / grid.cell_y_m);
  const reachCols = Math.ceil(radiusM / grid.cell_x_m);

  return vertices.map((v) => {
    const p = grid.lonlatToLocalMetres(v.lon, v.lat);
    const centre = grid.localMetresToRowCol(p.x_m, p.y_m);
    for (let row = centre.row - reachRows; row <= centre.row + reachRows; row++) {
      for (let col = centre.col - reachCols; col <= centre.col + reachCols; col++) {
        if (!grid.isInside(row, col) || grid.getCost(row, col) !== impassable) continue;
        const c = grid.rowColToLocalMetres(row, col);
        if (Math.hypot(c.x_m - p.x_m, c.y_m - p.y_m) <= radiusM) return true;
      }
    }
    return false;
  });
}

/**
 * Distance along the route from `alongM` to the first flagged vertex no more than
 * `lookaheadM` ahead, or null when none is.
 */
export function hazardAhead(
  vertices: TrackVertex[],
  flags: boolean[],
  alongM: number,
  lookaheadM: number = HAZARD_LOOKAHEAD_M
): number | null {
  for (let i = 0; i < vertices.length; i++) {
    const ahead = vertices[i].along_m - alongM;
    if (ahead > lookaheadM) return null;
    if (ahead >= 0 && flags[i]) return ahead;
  }
  return null;
}
