// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { createGrid, GridHeader, GridOrigin, lonlatToLocalMetres, localMetresToLonLat } from './grid';
import { buildPlan, computeTurnBack, densifyLine, validatePlan, PlanParams } from './plan';
import { MARS_R, degToRad } from './grid';
import { reachableMask, snapToReachable } from './snap';
import { buildTrack } from '../walk/track';

describe('Plan builder and validation (Contracts Section 7 and 10)', () => {
  const origin: GridOrigin = {
    lon0: 137.3628,
    lat0: -4.825,
    lat_c: -4.7913,
  };

  const params: PlanParams = {
    crew: 2,
    time_limit_s: 28800,
    suit_mass_kg: 120,
    body_mass_kg: 80,
    stop_time_s: 1200,
    solar_event: false,
  };

  it('does not charge a stationary duplicate at a leg boundary during turn-back walkback', () => {
    const header: GridHeader = {
      width: 3, height: 3, cell_x_m: 2, cell_y_m: 2,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0, offset_m: 0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 }, origin,
    };
    const grid = createGrid(header, new Uint16Array(9), new Uint8Array(9));
    const detail = (col: number, timeS: number) => {
      const p = grid.rowColToLonLat(1, col);
      return { row: 1, col, ...p, distanceM: timeS, timeS, climbM: 0, descentM: 0, energyKj: 1, slopeDeg: 0 };
    };
    const leg = (steps: ReturnType<typeof detail>[]) => ({ feasible: true, cells: [], steps, distance_m: 0, time_s: 0, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 });
    const plain = [leg([detail(0, 0), detail(1, 10)]), leg([detail(2, 10)])];
    const duplicated = [leg([detail(0, 0), detail(1, 10)]), leg([detail(1, 0), detail(2, 10)])];
    expect(computeTurnBack(duplicated, [], { ...params, time_limit_s: 1000 }, grid))
      .toEqual(computeTurnBack(plain, [], { ...params, time_limit_s: 1000 }, grid));
  });

  it('densifies line so that no two consecutive points are more than 4 m apart', () => {
    // Points far apart: 100 m
    const p1: [number, number] = [137.39, -4.78];
    const m1 = lonlatToLocalMetres(p1[0], p1[1], origin);
    // Add 100 m east
    const m2 = { x_m: m1.x_m + 100.0, y_m: m1.y_m };
    // Convert back
    const lon2 = origin.lon0 + ((m2.x_m / (MARS_R * Math.cos(degToRad(origin.lat_c)))) * 180.0) / Math.PI;
    const lat2 = origin.lat0 + ((m2.y_m / MARS_R) * 180.0) / Math.PI;
    const p2: [number, number] = [lon2, lat2];

    const rawLine: [number, number][] = [p1, p2];
    const densified = densifyLine(rawLine, origin, 4.0);

    expect(densified.length).toBeGreaterThan(2);

    // Verify distance between every consecutive pair <= 4.0001 m
    for (let i = 0; i < densified.length - 1; i++) {
      const a = densified[i];
      const b = densified[i + 1];
      const ma = lonlatToLocalMetres(a[0], a[1], origin);
      const mb = lonlatToLocalMetres(b[0], b[1], origin);
      const dist = Math.hypot(mb.x_m - ma.x_m, mb.y_m - ma.y_m);
      expect(dist).toBeLessThanOrEqual(4.0001);
    }
  });

  it('matches hand-calculated distance from Contracts Section 3 within 2%', () => {
    // Create a flat 100x100 synthetic grid
    const width = 100;
    const height = 100;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: -4000.0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin,
    };

    const grid = createGrid(header, elevData, costData);

    // Pick start at col 10, row 50 and stop at col 70, row 50 (straight horizontal line)
    const startCoord = grid.rowColToLonLat(50, 10);
    const stopCoord = grid.rowColToLonLat(50, 70);

    // Hand calculation per Contracts Section 3:
    // x_m = R * cos(lat_c) * radians(lon2 - lon1)
    // y_m = R * radians(lat2 - lat1)
    const dx_hand = MARS_R * Math.cos(degToRad(origin.lat_c)) * degToRad(stopCoord.lon - startCoord.lon);
    const dy_hand = MARS_R * degToRad(stopCoord.lat - startCoord.lat);
    const handDistanceM = Math.hypot(dx_hand, dy_hand);

    const plan = buildPlan({
      site: 'gale',
      grid,
      params,
      start: { lon: startCoord.lon, lat: startCoord.lat, label: 'Rover drop-off' },
      stops: [{ id: 's1', name: 'Science Waypoint', lon: stopCoord.lon, lat: stopCoord.lat, dwell_s: 600 }],
    });

    expect(plan.route.feasible).toBe(true);
    const leg0 = plan.route.legs[0];

    // Check hand distance vs planner leg distance within 2%
    const relativeError = Math.abs(leg0.distance_m - handDistanceM) / handDistanceM;
    expect(relativeError).toBeLessThan(0.02);
  });

  it('computes turn-back point on a long out-and-back route', () => {
    // 200x50 grid: cell_x_m = 2.0, cell_y_m = 2.0 -> width = 400 m
    const width = 200;
    const height = 50;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: -4000.0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin,
    };

    const grid = createGrid(header, elevData, costData);

    const startCoord = grid.rowColToLonLat(25, 10);
    const farStopCoord = grid.rowColToLonLat(25, 180);

    // One-way distance ~ 170 cells * 2m = 340m
    // Round trip distance ~ 680m.
    // At 0.8 m/s, walking 680m takes ~850 seconds.
    // Set time_limit_s = 600 seconds, so 85% effective limit = 510 seconds.
    // The astronaut cannot complete the round trip within 510 seconds!
    const tightParams: PlanParams = {
      crew: 2,
      time_limit_s: 600,
      suit_mass_kg: 120,
      body_mass_kg: 80,
      stop_time_s: 0,
      solar_event: false,
    };

    const plan = buildPlan({
      site: 'gale',
      grid,
      params: tightParams,
      start: { lon: startCoord.lon, lat: startCoord.lat, label: 'Start' },
      stops: [{ id: 'far', name: 'Far Stop', lon: farStopCoord.lon, lat: farStopCoord.lat, dwell_s: 0 }],
    });

    expect(plan.route.feasible).toBe(true);
    expect(plan.route.turn_back).not.toBeNull();
    const tb = plan.route.turn_back!;

    // Turn-back point must be on outward leg (leg 0)
    expect(tb.leg).toBe(0);
    expect(tb.reason).toBe('time');

    // Turn-back coordinate is between start and stop (col between 10 and 180)
    const tbRc = grid.lonlatToRowCol(tb.lon, tb.lat);
    expect(tbRc.col).toBeGreaterThan(10);
    expect(tbRc.col).toBeLessThan(180);
  });

  it('validates plan schema strictly according to Contracts Section 7', () => {
    const width = 30;
    const height = 30;
    const grid = createGrid(
      {
        width,
        height,
        cell_x_m: 2.0,
        cell_y_m: 2.0,
        elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: -4000.0, nodata: 65535 },
        cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
        origin,
      },
      new Uint16Array(width * height),
      new Uint8Array(width * height)
    );

    const startCoord = grid.rowColToLonLat(15, 5);
    const stopCoord = grid.rowColToLonLat(15, 20);

    const plan = buildPlan({
      site: 'gale',
      grid,
      params,
      start: { lon: startCoord.lon, lat: startCoord.lat, label: 'Rover drop-off' },
      stops: [{ id: 's1', name: 'Boxwork ridge', lon: stopCoord.lon, lat: stopCoord.lat, dwell_s: 1200 }],
    });

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(plan.version).toBe(1);
    expect(plan.route.returns_to_start).toBe(true);
    expect(plan.route.legs.length).toBe(2); // start -> s1, s1 -> start
  });

  it('generates app/src/fixtures/plan.sample.json valid against Contracts Section 7', async () => {
    const fs = await import('node:fs');
    const { fileURLToPath } = await import('node:url');

    // Synthetic Gale-scale grid (500x500 cells, 8m resolution = 4000x4000m)
    const width = 500;
    const height = 500;
    const cell_x_m = 8.0;
    const cell_y_m = 8.0;

    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    // Mount Sharp slope: elevation rises as y_m decreases (moving South / higher row index)
    // Elevation range: -4082 m to -3800 m
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const baseElev = -4082.0 + (r / height) * 250.0 + Math.sin(c / 20.0) * 5.0;
        // offset -4082.2, scale 0.1
        const raw = Math.round((baseElev - (-4082.2)) / 0.1);
        elevData[r * width + c] = Math.max(0, Math.min(65534, raw));
        costData[r * width + c] = 10; // smooth firm ground
      }
    }

    const galeOrigin: GridOrigin = {
      lon0: 137.3628,
      lat0: -4.825,
      lat_c: -4.7913,
    };

    const header: GridHeader = {
      width,
      height,
      cell_x_m,
      cell_y_m,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: -4082.2, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
      origin: galeOrigin,
    };

    const grid = createGrid(header, elevData, costData);

    const galeParams: PlanParams = {
      crew: 2,
      time_limit_s: 28800,
      suit_mass_kg: 120,
      body_mass_kg: 80,
      stop_time_s: 1200,
      solar_event: false,
    };

    const samplePlan = buildPlan({
      site: 'gale',
      grid,
      params: galeParams,
      start: { ...localMetresToLonLat(65, 65, galeOrigin), label: 'Rover drop-off' },
      stops: [
        {
          id: 's1',
          name: 'Boxwork ridge',
          ...localMetresToLonLat(410, 430, galeOrigin),
          note: 'Mineral veins standing as ridges',
          dwell_s: 1200,
        },
      ],
    });

    const validation = validatePlan(samplePlan);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Check legs
    expect(samplePlan.route.legs.length).toBe(2);
    expect(samplePlan.route.legs[0].from).toBe('start');
    expect(samplePlan.route.legs[0].to).toBe('s1');
    expect(samplePlan.route.legs[1].from).toBe('s1');
    expect(samplePlan.route.legs[1].to).toBe('start');
    expect(samplePlan.route.returns_to_start).toBe(true);
    expect(samplePlan.route.feasible).toBe(true);

    // Densification check: all segments <= 4.0001m
    for (const leg of samplePlan.route.legs) {
      for (let i = 0; i < leg.line.length - 1; i++) {
        const ma = lonlatToLocalMetres(leg.line[i][0], leg.line[i][1], galeOrigin);
        const mb = lonlatToLocalMetres(leg.line[i + 1][0], leg.line[i + 1][1], galeOrigin);
        const dist = Math.hypot(mb.x_m - ma.x_m, mb.y_m - ma.y_m);
        expect(dist).toBeLessThanOrEqual(4.0001);
      }
    }

    // Other test files import this fixture, so a run must never rewrite it: compare instead, and
    // regenerate only on request (REGENERATE_FIXTURES=1 npx vitest run src/lib/plan.test.ts).
    const fixturePath = fileURLToPath(new URL('../fixtures/plan.sample.json', import.meta.url));
    if (process.env.REGENERATE_FIXTURES === '1') {
      fs.writeFileSync(fixturePath, JSON.stringify(samplePlan, null, 2), 'utf-8');
    }
    const committed = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(samplePlan)));
  });

  it('buildPlan with one unreachable stop in the middle keeps the other legs and their totals', () => {
    // 30x30 grid: start at (15, 5), stop 1 at (15, 10), stop 2 at (15, 15) impassable, stop 3 at (15, 20)
    const width = 30;
    const height = 30;
    const elevData = new Uint16Array(width * height);
    const costData = new Uint8Array(width * height);

    // Make stop 2 cell (15, 15) impassable
    costData[15 * width + 15] = 255;

    const testOrigin: GridOrigin = { lon0: 137.36, lat0: -4.82, lat_c: -4.82 };
    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: 0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
      origin: testOrigin,
    };
    const grid = createGrid(header, elevData, costData, testOrigin);

    const startPt = grid.rowColToLonLat(15, 5);
    const s1Pt = grid.rowColToLonLat(15, 10);
    const s2Pt = grid.rowColToLonLat(15, 15);
    const s3Pt = grid.rowColToLonLat(15, 20);

    const plan = buildPlan({
      site: 'gale',
      grid,
      params,
      start: { lon: startPt.lon, lat: startPt.lat, label: 'Rover drop-off' },
      stops: [
        { id: 's1', name: 'Stop 1', lon: s1Pt.lon, lat: s1Pt.lat, dwell_s: 300 },
        { id: 's2', name: 'Stop 2', lon: s2Pt.lon, lat: s2Pt.lat, dwell_s: 300 },
        { id: 's3', name: 'Stop 3', lon: s3Pt.lon, lat: s3Pt.lat, dwell_s: 300 },
      ],
    });

    // Feasible is false because stop 2 was skipped
    expect(plan.route.feasible).toBe(false);
    expect(plan.route.warnings).toContain("Can't reach Stop 2. Move or remove it.");

    // Legs must exist: start -> s1, s1 -> s3 (s2 skipped!), s3 -> start
    expect(plan.route.legs.length).toBe(3);
    expect(plan.route.legs[0].from).toBe('start');
    expect(plan.route.legs[0].to).toBe('s1');
    expect(plan.route.legs[1].from).toBe('s1');
    expect(plan.route.legs[1].to).toBe('s3');
    expect(plan.route.legs[2].from).toBe('s3');
    expect(plan.route.legs[2].to).toBe('start');

    // Totals come from the legs that exist
    const sumDist = plan.route.legs[0].distance_m + plan.route.legs[1].distance_m + plan.route.legs[2].distance_m;
    expect(Math.abs(plan.route.totals.distance_m - sumDist)).toBeLessThanOrEqual(1);
    expect(plan.route.totals.distance_m).toBeGreaterThan(0);

    // Dwell time includes only reached stops s1 and s3 (300 + 300 = 600 s)
    const legWalkTime = plan.route.legs[0].time_s + plan.route.legs[1].time_s + plan.route.legs[2].time_s;
    expect(Math.abs(plan.route.totals.time_s - (legWalkTime + 600))).toBeLessThanOrEqual(1);

    // Walk and Visor play such a plan (buildTrack produces non-empty vertices and duration)
    const track = buildTrack(plan, testOrigin);
    expect(track.vertices.length).toBeGreaterThan(0);
    expect(Math.abs(track.durationS - plan.route.totals.time_s)).toBeLessThanOrEqual(1);
    expect(track.legs.length).toBe(3);
  });

  it('sample plan on a synthetic grid where its stop cell is impassable gets snapped', () => {
    // 50x50 grid
    const width = 50;
    const height = 50;
    const costData = new Uint8Array(width * height);
    const elevData = new Uint16Array(width * height);

    const testOrigin: GridOrigin = { lon0: 137.36, lat0: -4.82, lat_c: -4.82 };
    const header: GridHeader = {
      width,
      height,
      cell_x_m: 2.0,
      cell_y_m: 2.0,
      elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: 0, nodata: 65535 },
      cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
      origin: testOrigin,
    };

    // Place stop at (25, 25), make (25, 25) impassable
    costData[25 * width + 25] = 255;
    const grid = createGrid(header, elevData, costData, testOrigin);

    const startPt = grid.rowColToLonLat(10, 10);
    const stopPt = grid.rowColToLonLat(25, 25);

    // Initial plan with stop on impassable terrain
    const initialPlan = {
      start: { lon: startPt.lon, lat: startPt.lat, label: 'Rover drop-off' },
      stops: [{ id: 's1', name: 'Boxwork ridge', lon: stopPt.lon, lat: stopPt.lat, dwell_s: 600 }],
    };

    // Without snap, buildPlan skips the stop because it is impassable
    const unSnappedPlan = buildPlan({
      site: 'gale',
      grid,
      params,
      start: initialPlan.start,
      stops: initialPlan.stops,
    });
    expect(unSnappedPlan.route.feasible).toBe(false);
    expect(unSnappedPlan.route.legs.length).toBe(0);

    // With snapToReachable:
    const mask = reachableMask(grid, initialPlan.start);
    const snapped = snapToReachable(grid, mask, initialPlan.stops[0], 100);
    expect(snapped).not.toBeNull();
    expect(snapped!.movedM).toBeGreaterThan(0);
    expect(snapped!.movedM).toBeCloseTo(2.0, 4); // snapped to adjacent cell

    const snappedPlan = buildPlan({
      site: 'gale',
      grid,
      params,
      start: initialPlan.start,
      stops: [{ ...initialPlan.stops[0], lon: snapped!.lon, lat: snapped!.lat }],
    });

    expect(snappedPlan.route.feasible).toBe(true);
    expect(snappedPlan.route.warnings).toEqual([]);
    expect(snappedPlan.route.legs.length).toBe(2);
    expect(snappedPlan.route.totals.distance_m).toBeGreaterThan(0);
  });
});
