// Written with AI assistance, directed and reviewed by the team.

/**
 * Reachability mask and stop snapping for Marswalk.
 * Implements Contracts Section 3 (Coordinates and Units) and Section 6 (Route grids).
 *
 * Computes 8-neighbour flood fill through passable cells (cost < 255 and elev != nodata)
 * from a start location, caching the mask per grid and start cell.
 * Searches outward in rings to snap unreachable stops to the nearest reachable cell centre
 * within maxM metres (default 100 m).
 */

import type { RouteGrid } from './grid';

export interface PointLonLat {
  lon: number;
  lat: number;
}

export interface SnapResult {
  lon: number;
  lat: number;
  movedM: number;
}

const maskCache = new WeakMap<RouteGrid, Map<string, Uint8Array>>();

export function clearMaskCache(): void {
  // Useful in tests if needed
}

/**
 * Returns a Uint8Array mask of size width * height where 1 indicates the cell
 * is connected to the start cell through passable cells (8-neighbour connectivity,
 * matching grid.isPassable). Cached per grid instance and start cell.
 */
export function reachableMask(
  grid: RouteGrid,
  start: { lon: number; lat: number } | { row: number; col: number }
): Uint8Array {
  const { row: startRow, col: startCol } =
    'row' in start && 'col' in start ? start : grid.lonlatToRowCol(start.lon, start.lat);

  let gridCache = maskCache.get(grid);
  if (!gridCache) {
    gridCache = new Map<string, Uint8Array>();
    maskCache.set(grid, gridCache);
  }

  const cacheKey = `${startRow},${startCol}`;
  const cached = gridCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const width = grid.width;
  const height = grid.height;
  const size = width * height;
  const mask = new Uint8Array(size);

  if (!grid.isInside(startRow, startCol) || !grid.isPassable(startRow, startCol)) {
    gridCache.set(cacheKey, mask);
    return mask;
  }

  const costData = grid.costData;
  const elevData = grid.elevData;
  const costImpassable = grid.header.cost.impassable;
  const elevNodata = grid.header.elev.nodata;

  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  const startIdx = startRow * width + startCol;
  mask[startIdx] = 1;
  queue[tail++] = startIdx;

  while (head < tail) {
    const idx = queue[head++];
    const r = (idx / width) | 0;
    const c = idx % width;

    for (let dr = -1; dr <= 1; dr++) {
      const nr = r + dr;
      if (nr < 0 || nr >= height) continue;
      const rOffset = nr * width;
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = c + dc;
        if (nc < 0 || nc >= width) continue;
        const nIdx = rOffset + nc;
        if (mask[nIdx] !== 0) continue;
        if (costData[nIdx] >= costImpassable || elevData[nIdx] === elevNodata) continue;
        mask[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  gridCache.set(cacheKey, mask);
  return mask;
}

function findNearestCell(
  grid: RouteGrid,
  point: { lon: number; lat: number },
  isTarget: (r: number, c: number, idx: number) => boolean,
  maxM: number
): SnapResult | null {
  const ptM = grid.lonlatToLocalMetres(point.lon, point.lat);
  const targetRc = grid.localMetresToRowCol(ptM.x_m, ptM.y_m);

  const width = grid.width;
  const height = grid.height;

  if (
    targetRc.row >= 0 &&
    targetRc.row < height &&
    targetRc.col >= 0 &&
    targetRc.col < width
  ) {
    const targetIdx = targetRc.row * width + targetRc.col;
    if (isTarget(targetRc.row, targetRc.col, targetIdx)) {
      return { lon: point.lon, lat: point.lat, movedM: 0 };
    }
  }

  const minCellM = Math.min(grid.cell_x_m, grid.cell_y_m);
  const maxRings = Math.ceil(maxM / minCellM);
  const centerR = Math.max(0, Math.min(height - 1, targetRc.row));
  const centerC = Math.max(0, Math.min(width - 1, targetRc.col));

  let bestDist = Infinity;
  let bestR = -1;
  let bestC = -1;

  for (let ring = 1; ring <= maxRings; ring++) {
    const checkCell = (r: number, c: number) => {
      if (r < 0 || r >= height || c < 0 || c >= width) return;
      const idx = r * width + c;
      if (!isTarget(r, c, idx)) return;
      const cellM = grid.rowColToLocalMetres(r, c);
      const dist = Math.hypot(cellM.x_m - ptM.x_m, cellM.y_m - ptM.y_m);
      if (dist < bestDist) {
        bestDist = dist;
        bestR = r;
        bestC = c;
      }
    };

    // Top and bottom edges of the ring
    const top = centerR - ring;
    const bottom = centerR + ring;
    for (let c = centerC - ring; c <= centerC + ring; c++) {
      checkCell(top, c);
      checkCell(bottom, c);
    }

    // Left and right edges (excluding corners already checked)
    const left = centerC - ring;
    const right = centerC + ring;
    for (let r = centerR - ring + 1; r <= centerR + ring - 1; r++) {
      checkCell(r, left);
      checkCell(r, right);
    }

    // Early termination: if the best candidate found so far is closer than any
    // possible cell centre in the next ring, no subsequent ring can beat it.
    if (bestDist <= ring * minCellM - Math.max(grid.cell_x_m, grid.cell_y_m)) {
      break;
    }
  }

  if (bestDist <= maxM && bestR >= 0 && bestC >= 0) {
    const snapped = grid.rowColToLonLat(bestR, bestC);
    return { lon: snapped.lon, lat: snapped.lat, movedM: bestDist };
  }

  return null;
}

/**
 * Snaps a point to the nearest reachable cell centre within maxM metres (default 100 m).
 * Returns { lon, lat, movedM } where movedM = 0 if the point is already on reachable ground.
 * Returns null if no reachable cell centre is within maxM metres.
 */
export function snapToReachable(
  grid: RouteGrid,
  mask: Uint8Array,
  point: { lon: number; lat: number },
  maxM = 100
): SnapResult | null {
  return findNearestCell(grid, point, (_r, _c, idx) => mask[idx] === 1, maxM);
}

/**
 * Snaps a point to the nearest passable cell centre within maxM metres (default 100 m).
 * Used when the start itself is placed on impassable terrain.
 */
export function snapToPassable(
  grid: RouteGrid,
  point: { lon: number; lat: number },
  maxM = 100
): SnapResult | null {
  return findNearestCell(grid, point, (r, c) => grid.isPassable(r, c), maxM);
}
