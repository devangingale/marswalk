// Written with AI assistance, directed and reviewed by the team.

import { describe, expect, it } from 'vitest';
import { computeEyeHeight, groundHeightAt, headingFromTrack, sanitizePlanForOverlays } from './cameraMath';
import { localMetresToLonLat, type GridOrigin } from '../../lib/grid';
import type { Plan } from '../../lib/plan';
import type { TrackVertex } from '../../walk/track';

describe('computeEyeHeight', () => {
  it('adds bundle elevation, measured site offset, and standard 1.7 m eye height', () => {
    // Gale: bundle elevation -4501.04 m, spike height offset 73.76 m, eye 1.7 m
    expect(computeEyeHeight(-4501.04, 73.76)).toBeCloseTo(-4425.58, 5);
  });

  it('computes Jezero eye height with negative height offset', () => {
    // Jezero: bundle elevation -2500.0 m, spike height offset -70.92 m, eye 1.7 m
    expect(computeEyeHeight(-2500.0, -70.92)).toBeCloseTo(-2569.22, 5);
  });

  it('supports custom eye height override', () => {
    expect(computeEyeHeight(100.0, 10.0, 2.0)).toBeCloseTo(112.0, 5);
  });
});

describe('headingFromTrack', () => {
  const sampleVertices: TrackVertex[] = [
    { lon: 137.4, lat: -4.7, x_m: 0, y_m: 0, along_m: 0 },
    { lon: 137.4, lat: -4.69, x_m: 0, y_m: 100, along_m: 100 }, // North (bearing 0°)
    { lon: 137.41, lat: -4.69, x_m: 100, y_m: 100, along_m: 200 }, // East (bearing 90°)
    { lon: 137.41, lat: -4.7, x_m: 100, y_m: 0, along_m: 300 }, // South (bearing 180°)
  ];

  it('returns 0 for empty or single-vertex tracks', () => {
    expect(headingFromTrack([], 0)).toBe(0);
    expect(headingFromTrack([sampleVertices[0]], 0)).toBe(0);
  });

  it('determines exact heading on the first leg (walking North)', () => {
    expect(headingFromTrack(sampleVertices, 0)).toBeCloseTo(0, 5);
    expect(headingFromTrack(sampleVertices, 50)).toBeCloseTo(0, 5);
  });

  it('determines exact heading on the second leg (walking East)', () => {
    expect(headingFromTrack(sampleVertices, 150)).toBeCloseTo(90, 5);
  });

  it('determines exact heading on the third leg (walking South)', () => {
    expect(headingFromTrack(sampleVertices, 250)).toBeCloseTo(180, 5);
  });

  it('returns final segment heading when at or past the end of the track', () => {
    expect(headingFromTrack(sampleVertices, 300)).toBeCloseTo(180, 5);
    expect(headingFromTrack(sampleVertices, 500)).toBeCloseTo(180, 5);
  });
});

describe('groundHeightAt', () => {
  const fakeGrid = {
    lonlatToRowCol: (lon: number, lat: number) => ({
      row: Math.round((lat + 5) * 100),
      col: Math.round((lon - 137) * 100),
    }),
    isInside: (r: number, c: number) => r >= 0 && r < 100 && c >= 0 && c < 100,
    getElevation: (r: number, c: number) => (r === 50 && c === 50 ? -4500 : Number.NaN),
  };

  it('returns heightOffsetM when grid is null', () => {
    expect(groundHeightAt(null, 137.5, -4.5, 73.76)).toBe(73.76);
  });

  it('returns bundle elevation + heightOffsetM for valid inside cell', () => {
    expect(groundHeightAt(fakeGrid, 137.5, -4.5, 73.76)).toBeCloseTo(-4500 + 73.76, 5);
  });

  it('falls back to heightOffsetM when position is outside or NaN elevation', () => {
    expect(groundHeightAt(fakeGrid, 130.0, 0.0, 73.76)).toBe(73.76);
    expect(groundHeightAt(fakeGrid, 137.1, -4.9, 73.76)).toBe(73.76);
  });
});

describe('sanitizePlanForOverlays', () => {
  const origin: GridOrigin = { lon0: 137.4, lat0: -4.7, lat_c: -4.7 };

  it('filters out empty or single-point legs', () => {
    const plan: Plan = {
      version: 1,
      site: 'gale',
      params: { crew: 2, time_limit_s: 3600, suit_mass_kg: 100, body_mass_kg: 80, stop_time_s: 600, solar_event: false },
      start: { lon: 137.4, lat: -4.7, label: 'Rover drop-off' },
      stops: [],
      route: {
        legs: [
          { from: 'start', to: 's1', line: [], distance_m: 0, time_s: 0, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
          { from: 's1', to: 'start', line: [[137.4, -4.7]], distance_m: 0, time_s: 0, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
        ],
        returns_to_start: true,
        totals: { distance_m: 0, time_s: 0, climb_m: 0, descent_m: 0, energy_kj: 0, dose_mgy: 0 },
        turn_back: null,
        feasible: true,
        warnings: [],
      },
    };

    const sanitized = sanitizePlanForOverlays(plan, origin);
    expect(sanitized.route.legs).toHaveLength(0);
  });

  it('thins intermediate vertices closer than 3.5 m while preserving start and end points', () => {
    // Generate a line with points spaced every 1 metre from 0 m to 10 m
    const line: [number, number][] = [];
    for (let x = 0; x <= 10; x += 1) {
      const { lon, lat } = localMetresToLonLat(x, 0, origin);
      line.push([lon, lat]);
    }

    const plan: Plan = {
      version: 1,
      site: 'gale',
      params: { crew: 2, time_limit_s: 3600, suit_mass_kg: 100, body_mass_kg: 80, stop_time_s: 600, solar_event: false },
      start: { lon: 137.4, lat: -4.7, label: 'Rover drop-off' },
      stops: [{ id: 's1', name: 'Stop 1', lon: line[line.length - 1][0], lat: line[line.length - 1][1] }],
      route: {
        legs: [
          { from: 'start', to: 's1', line, distance_m: 10, time_s: 10, climb_m: 0, descent_m: 0, energy_kj: 1, max_slope_deg: 0 },
        ],
        returns_to_start: false,
        totals: { distance_m: 10, time_s: 10, climb_m: 0, descent_m: 0, energy_kj: 1, dose_mgy: 0 },
        turn_back: null,
        feasible: true,
        warnings: [],
      },
    };

    const sanitized = sanitizePlanForOverlays(plan, origin);
    const thinnedLine = sanitized.route.legs[0].line;
    // Original had 11 points (0..10); with 3.5 m min spacing: 0, 4, 8, 10 -> 4 points
    expect(thinnedLine.length).toBeLessThan(11);
    expect(thinnedLine[0]).toEqual(line[0]);
    expect(thinnedLine[thinnedLine.length - 1]).toEqual(line[line.length - 1]);
  });
});
