// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { createGrid, GridHeader, GridOrigin } from '../lib/grid';
import { Plan } from '../lib/plan';
import { hazardAhead, hazardFlags } from './hazard';
import { buildTrack } from './track';

const origin: GridOrigin = { lon0: 137.0, lat0: -5.0, lat_c: -5.0 };

/** 50 × 50 cells of 2 m (100 m square), all passable except one impassable cell. */
function syntheticGrid(impassableRow: number, impassableCol: number) {
  const width = 50;
  const height = 50;
  const header: GridHeader = {
    width,
    height,
    cell_x_m: 2,
    cell_y_m: 2,
    elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: -4000, nodata: 65535 },
    cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
  };
  const elev = new Uint16Array(width * height).fill(100);
  const cost = new Uint8Array(width * height).fill(10);
  cost[impassableRow * width + impassableCol] = 255;
  return createGrid(header, elev, cost, origin);
}

/** A walk due east along y = 51 m from x = 1 m to x = 99 m, vertices every 2 m. */
function eastboundTrack(grid: ReturnType<typeof syntheticGrid>) {
  const line: [number, number][] = [];
  for (let x = 1; x <= 99; x += 2) {
    const { lon, lat } = grid.localMetresToLonLat(x, 51);
    line.push([lon, lat]);
  }
  const plan: Plan = {
    version: 1,
    site: 'test',
    params: { crew: 2, time_limit_s: 3600, suit_mass_kg: 120, body_mass_kg: 80, stop_time_s: 0, solar_event: false },
    start: { lon: line[0][0], lat: line[0][1], label: 'Start' },
    stops: [],
    route: {
      legs: [{ from: 'start', to: 'start', line, distance_m: 98, time_s: 100, climb_m: 0, descent_m: 0, energy_kj: 10, max_slope_deg: 0 }],
      returns_to_start: true,
      totals: { distance_m: 98, time_s: 100, climb_m: 0, descent_m: 0, energy_kj: 10, dose_mgy: 0 },
      turn_back: null,
      feasible: true,
      warnings: [],
    },
  };
  return buildTrack(plan, origin);
}

describe('hazard-ahead detection on a synthetic grid', () => {
  // Row 20, col 35: cell centre at x = 71 m, y = 100 - 41 = 59 m, 8 m north of the route.
  const grid = syntheticGrid(20, 35);
  const track = eastboundTrack(grid);

  it('flags the route vertices within 10 m of the impassable cell centre', () => {
    const flags = hazardFlags(track.vertices, grid, 10);
    const flaggedX = track.vertices.filter((_, i) => flags[i]).map((v) => Math.round(grid.lonlatToLocalMetres(v.lon, v.lat).x_m));
    expect(flaggedX).toEqual([65, 67, 69, 71, 73, 75, 77]);
  });

  it('flags nothing when the radius is smaller than the clearance', () => {
    expect(hazardFlags(track.vertices, grid, 7.9).some(Boolean)).toBe(false);
  });

  it('reports the along-route distance to the first hazard inside the lookahead', () => {
    const flags = hazardFlags(track.vertices, grid, 10);
    expect(hazardAhead(track.vertices, flags, 30, 50)).toBeCloseTo(34, 3);
    expect(hazardAhead(track.vertices, flags, 70, 50)).toBeCloseTo(0, 3);
  });

  it('reports nothing when the hazard is beyond the lookahead or behind', () => {
    const flags = hazardFlags(track.vertices, grid, 10);
    expect(hazardAhead(track.vertices, flags, 0, 50)).toBeNull();
    expect(hazardAhead(track.vertices, flags, 80, 50)).toBeNull();
  });

  it('treats ground just outside the grid edge as unknown, not impassable', () => {
    const { lon, lat } = grid.localMetresToLonLat(-3, 51);
    expect(hazardFlags([{ lon, lat, x_m: -3, y_m: 51, along_m: 0 }], grid, 10)).toEqual([false]);
  });
});
