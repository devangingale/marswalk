// Written with AI assistance, directed and reviewed by the team.
// Highest (or lowest) local extremes of a whole-planet value grid, kept apart by a minimum
// great-circle distance so a single broad high does not take every slot.

import type { ValuesGrid } from '../layerManifest';
import { greatCircleKm } from './geo';

/** Packing spans: cell indices below 2^20, equator distances (in half cells) below 2^10. */
const INDEX_SPAN = 2 ** 20;
const TIE_SPAN = 2 ** 10;

export interface Peak {
  lon: number;
  lat: number;
  value: number;
}

export interface PeakOptions {
  count: number;
  minSeparationKm: number;
  /** Look for the lowest values instead of the highest. */
  lowest?: boolean;
}

/**
 * Local extremes in a 3 by 3 neighbourhood (columns wrap when the grid spans 360 degrees),
 * best first, picked greedily so each is at least minSeparationKm from those already taken.
 * Ties (common where values are capped) go to the cell nearer the equator, then the earlier
 * cell in row order. Positions are cell centres.
 */
export function findPeaks(grid: ValuesGrid, { count, minSeparationKm, lowest = false }: PeakOptions): Peak[] {
  const { width, height, data, nodata } = grid;
  const wraps = Math.abs(width * grid.res_deg - 360) < 1e-9;
  // Raw integers order the same way as decoded values, reversed when the scale is negative.
  const sign = (lowest ? -1 : 1) * (grid.scale < 0 ? -1 : 1);
  if (width * height > INDEX_SPAN || height * 2 >= TIE_SPAN) throw new Error('Grid too large for peak finding');
  const equatorRow = grid.north / grid.res_deg - 0.5;

  // Each candidate packs its rank (best first, 16-bit), its distance from the equator and its
  // cell index into one number, so a single numeric sort gives the order.
  const order: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const raw = data[row * width + col];
      if (raw === nodata) continue;
      const key = sign * raw;
      let extreme = true;
      for (let dr = -1; dr <= 1 && extreme; dr++) {
        const r = row + dr;
        if (r < 0 || r >= height) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          let c = col + dc;
          if (c < 0 || c >= width) {
            if (!wraps) continue;
            c = (c + width) % width;
          }
          const other = data[r * width + c];
          if (other !== nodata && sign * other > key) {
            extreme = false;
            break;
          }
        }
      }
      if (!extreme) continue;
      const rank = sign > 0 ? 0xffff - raw : raw;
      const tie = Math.round(Math.abs(row - equatorRow) * 2);
      order.push((rank * TIE_SPAN + tie) * INDEX_SPAN + row * width + col);
    }
  }
  const sorted = Float64Array.from(order).sort();

  const peaks: Peak[] = [];
  for (const packed of sorted) {
    if (peaks.length >= count) break;
    const index = packed % INDEX_SPAN;
    const row = Math.floor(index / width);
    const col = index % width;
    const lon = grid.west + (col + 0.5) * grid.res_deg;
    const lat = grid.north - (row + 0.5) * grid.res_deg;
    if (peaks.some((p) => greatCircleKm(p.lon, p.lat, lon, lat) < minSeparationKm)) continue;
    peaks.push({ lon, lat, value: data[index] * grid.scale + grid.offset });
  }
  return peaks;
}
