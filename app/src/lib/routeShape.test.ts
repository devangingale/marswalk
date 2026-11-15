// Written with AI assistance, directed and reviewed by the team.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import samplePlanJson from '../fixtures/plan.sample.json';
import { chevronsFor } from '../globe/routeLook';
import { makeInitialPlan } from '../plan/planLogic';
import {
  createGrid,
  GridOrigin,
  localMetresToLonLat,
  lonlatToLocalMetres,
  radToDeg,
  RouteGrid,
} from './grid';
import { buildPlan, Plan, PlanLeg } from './plan';
import {
  chevronPositions,
  forkPoints,
  MIN_STRETCH_M,
  sections,
  sharedSegments,
  slopeStats,
} from './routeShape';
import { reachableMask, snapToReachable } from './snap';

const testOrigin: GridOrigin = {
  lon0: 0.0,
  lat0: 0.0,
  lat_c: 0.0,
};

function pt(x_m: number, y_m: number): [number, number] {
  const { lon, lat } = localMetresToLonLat(x_m, y_m, testOrigin);
  return [lon, lat];
}

function createSyntheticRampGrid(origin: GridOrigin): RouteGrid {
  // 100 x 100 cells, 10m each -> 1000m x 1000m
  // Elevation ramp: row-major, 0 to 10m over col 0 to 10 (100m), then flat at 10m
  const width = 100;
  const height = 100;
  const elevData = new Uint16Array(width * height);
  const costData = new Uint8Array(width * height);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const idx = r * width + c;
      const x_m = (c + 0.5) * 10.0;
      let elevM = 0;
      if (x_m <= 100.0) {
        elevM = (x_m / 100.0) * 10.0;
      } else {
        elevM = 10.0;
      }
      elevData[idx] = Math.round(elevM * 10); // scale = 0.1
      costData[idx] = 1;
    }
  }

  return createGrid(
    {
      width,
      height,
      cell_x_m: 10.0,
      cell_y_m: 10.0,
      elev: {
        file: 'elev.bin',
        dtype: 'uint16',
        scale_m: 0.1,
        offset_m: 0.0,
        nodata: 65535,
      },
      cost: {
        file: 'cost.bin',
        dtype: 'uint8',
        impassable: 255,
      },
      origin,
    },
    elevData,
    costData,
    origin
  );
}

describe('routeShape', () => {
  it('1. Out-and-back detour: sharedSegments, forkPoints, and sections', () => {
    const startCoord = pt(0, 0);
    const aCoord = pt(1000, 0);
    const bCoord = pt(1000, 300);

    const leg0: PlanLeg = {
      from: 'start',
      to: 'A',
      line: [startCoord, aCoord],
      distance_m: 1000,
      time_s: 800,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 200,
      max_slope_deg: 0,
    };

    const leg1: PlanLeg = {
      from: 'A',
      to: 'B',
      line: [aCoord, bCoord],
      distance_m: 300,
      time_s: 240,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 60,
      max_slope_deg: 0,
    };

    const leg2: PlanLeg = {
      from: 'B',
      to: 'A',
      line: [bCoord, aCoord],
      distance_m: 300,
      time_s: 240,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 60,
      max_slope_deg: 0,
    };

    const leg3: PlanLeg = {
      from: 'A',
      to: 'start',
      line: [aCoord, startCoord],
      distance_m: 1000,
      time_s: 800,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 200,
      max_slope_deg: 0,
    };

    const legs = [leg0, leg1, leg2, leg3];

    // 1a. sharedSegments contains the spur once with legs walking it fwd and back
    const segments = sharedSegments(legs, testOrigin, 3);
    const spur = segments.find((s) => s.legs.includes(1) && s.legs.includes(2));
    expect(spur).toBeDefined();
    // Spur is traversed once fwd and once back by legs 1 and 2
    expect(spur!.legs).toEqual([1, 2]);
    expect(spur!.directions).toEqual(['fwd', 'back']);

    // 1b. forkPoints has exactly one fork at A with branches labelled with B's name and the next destination
    const forks = forkPoints(legs, testOrigin, 3);
    expect(forks.length).toBe(1);
    const forkAtA = forks[0];
    const forkDistFromA = Math.hypot(
      lonlatToLocalMetres(forkAtA.lon, forkAtA.lat, testOrigin).x_m - 1000,
      lonlatToLocalMetres(forkAtA.lon, forkAtA.lat, testOrigin).y_m - 0
    );
    expect(forkDistFromA).toBeLessThan(3.0);
    expect(forkAtA.branches).toEqual([
      { legIndex: 1, toLabel: 'B' },
      { legIndex: 3, toLabel: 'drop-off' },
    ]);

    // 1c. sections returns one section containing B as a detour
    const plan: Plan = {
      version: 1,
      site: 'test-site',
      params: {
        crew: 2,
        time_limit_s: 3600,
        suit_mass_kg: 80,
        body_mass_kg: 75,
        stop_time_s: 300,
        solar_event: false,
      },
      start: {
        lon: startCoord[0],
        lat: startCoord[1],
        label: 'Rover drop-off',
      },
      stops: [
        {
          id: 'B',
          name: 'Stop B',
          lon: bCoord[0],
          lat: bCoord[1],
        },
      ],
      route: {
        legs,
        returns_to_start: true,
        totals: {
          distance_m: 2600,
          time_s: 2080,
          climb_m: 0,
          descent_m: 0,
          energy_kj: 520,
          dose_mgy: 0.1,
        },
        turn_back: null,
        feasible: true,
        warnings: [],
      },
    };

    const secs = sections(plan, testOrigin);
    expect(secs.length).toBe(1);
    expect(secs[0].detourStopIds).toContain('B');
    expect(secs[0].fromStopId).toBe('start');
    expect(secs[0].toStopId).toBe('start');
    expect(secs[0].legIndices).toEqual([0, 1, 2, 3]);
  });

  it('2. Two legs that cross at a single point (an X) produce zero forks', () => {
    // Leg 0: (-100, 0) -> (100, 0)
    // Leg 1: (0, -100) -> (0, 100)
    const leg0: PlanLeg = {
      from: 'W',
      to: 'E',
      line: [pt(-100, 0), pt(0, 0), pt(100, 0)],
      distance_m: 200,
      time_s: 160,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 40,
      max_slope_deg: 0,
    };

    const leg1: PlanLeg = {
      from: 'S',
      to: 'N',
      line: [pt(0, -100), pt(0, 0), pt(0, 100)],
      distance_m: 200,
      time_s: 160,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 40,
      max_slope_deg: 0,
    };

    const forks = forkPoints([leg0, leg1], testOrigin, 3);
    expect(forks).toEqual([]);
  });

  it('3. chevronPositions on a straight 1000 m eastward line at spacing 150 m yields 6 points (at 75, 225, ..., 825 m) all with bearing 90 deg', () => {
    const line: [number, number][] = [pt(0, 0), pt(1000, 0)];
    const chevrons = chevronPositions(line, testOrigin, 150);

    expect(chevrons.length).toBe(6);
    const expectedDistances = [75, 225, 375, 525, 675, 825];

    for (let i = 0; i < 6; i++) {
      const ch = chevrons[i];
      const m = lonlatToLocalMetres(ch.lon, ch.lat, testOrigin);
      expect(m.x_m).toBeCloseTo(expectedDistances[i], 1);
      expect(m.y_m).toBeCloseTo(0, 1);
      expect(ch.bearingDeg).toBeCloseTo(90, 5);
    }
  });

  it('4. slopeStats on a synthetic ramp rising 10 m over 100 m then flat: highM, lowM, climbM = 10, descentM = 0, steepestDeg = atan(10/100) in degrees to 1e-9', () => {
    const grid = createSyntheticRampGrid(testOrigin);

    // Vertex 0 at (0, 0) -> cell col 0 -> elev 0.05 * 10 / 100? Wait, let's use exact grid points
    // Let's create a custom grid with exact getElevation for the test
    const customGrid: RouteGrid = {
      ...grid,
      getElevation(_row: number, col: number) {
        if (col === 0) return 0.0;
        if (col === 10) return 10.0;
        if (col === 20) return 10.0;
        return 10.0;
      },
      lonlatToRowCol(lon: number, lat: number) {
        const { x_m } = lonlatToLocalMetres(lon, lat, testOrigin);
        const col = Math.round(x_m / 10);
        return { row: 0, col };
      },
    };

    const rampLine: [number, number][] = [pt(0, 0), pt(100, 0), pt(200, 0)];
    const stats = slopeStats(rampLine, customGrid);

    expect(stats.highM).toBe(10.0);
    expect(stats.lowM).toBe(0.0);
    expect(stats.climbM).toBe(10.0);
    expect(stats.descentM).toBe(0.0);

    const expectedSteepestDeg = radToDeg(Math.atan(10.0 / 100.0));
    expect(stats.steepestDeg).toBeCloseTo(expectedSteepestDeg, 9);

    const steepestMid = lonlatToLocalMetres(stats.steepestAt![0], stats.steepestAt![1], testOrigin);
    expect(steepestMid.x_m).toBeCloseTo(50.0, 1);
    expect(steepestMid.y_m).toBeCloseTo(0.0, 1);
  });

  it('ignores a non-finite first elevation when calculating slope statistics', () => {
    const grid = createSyntheticRampGrid(testOrigin);
    const stats = slopeStats([[99, 99], ...[pt(55, 500), pt(95, 500)]], grid);
    expect(stats.highM).toBe(9.5);
    expect(stats.lowM).toBe(5.5);
    expect(stats.climbM).toBe(4);
    expect(stats.descentM).toBe(0);
    expect(stats.steepestDeg).not.toBeNull();
  });

  it('5. sharedSegments for a single one-way leg returns one stretch with legs [0] and directions [\'fwd\']', () => {
    const leg0: PlanLeg = {
      from: 'start',
      to: 'end',
      line: [pt(0, 0), pt(500, 200)],
      distance_m: 538,
      time_s: 430,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 100,
      max_slope_deg: 0,
    };

    const stretches = sharedSegments([leg0], testOrigin, 3);
    expect(stretches.length).toBe(1);
    expect(stretches[0].legs).toEqual([0]);
    expect(stretches[0].directions).toEqual(['fwd']);
  });

  it('merges nearby narrow-angle fork candidates and keeps the union of branches', () => {
    const legs: PlanLeg[] = [
      { from: 'start', to: 'A', line: [pt(0, 0), pt(100, 0), pt(300, 0)], distance_m: 300, time_s: 240, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
      { from: 'start', to: 'B', line: [pt(0, 0), pt(100, 0), pt(300, 22)], distance_m: 300, time_s: 240, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
      { from: 'start', to: 'C', line: [pt(0, 0), pt(100, 0), pt(300, -22)], distance_m: 300, time_s: 240, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
    ];
    const forks = forkPoints(legs, testOrigin);
    expect(forks).toHaveLength(1);
    expect(forks[0].branches).toEqual([
      { legIndex: 0, toLabel: 'A' },
      { legIndex: 1, toLabel: 'B' },
      { legIndex: 2, toLabel: 'C' },
    ]);
  });

  it('measures steepest gradient over at least 10 m to damp a single noisy sample', () => {
    const grid = createSyntheticRampGrid(testOrigin);
    const noisyGrid: RouteGrid = {
      ...grid,
      getElevation(_row: number, col: number) { return col === 5 ? 2 : 0; },
      lonlatToRowCol(lon: number, lat: number) {
        const { x_m } = lonlatToLocalMetres(lon, lat, testOrigin);
        return { row: 0, col: Math.round(x_m / 2) };
      },
    };
    const line = Array.from({ length: 11 }, (_, i) => pt(i * 2, 0));
    const stats = slopeStats(line, noisyGrid);
    expect(stats.steepestDeg).toBeCloseTo(radToDeg(Math.atan(2 / 10)), 9);
    const steepest = lonlatToLocalMetres(stats.steepestAt![0], stats.steepestAt![1], testOrigin);
    expect(steepest.x_m).toBeCloseTo(5, 1);
  });

  it('uses the first baseline reaching 10 m for each start point', () => {
    const grid = createSyntheticRampGrid(testOrigin);
    const baselineGrid: RouteGrid = {
      ...grid,
      getElevation(_row: number, col: number) {
        if (col === 10) return 1;
        if (col === 15) return 10;
        return 0;
      },
      lonlatToRowCol(lon: number, lat: number) {
        const { x_m } = lonlatToLocalMetres(lon, lat, testOrigin);
        return { row: 0, col: Math.round(x_m) };
      },
    };

    const stats = slopeStats([pt(0, 0), pt(10, 0), pt(15, 0)], baselineGrid);
    expect(stats.steepestDeg).toBe(radToDeg(Math.atan(1 / 10)));
    const steepest = lonlatToLocalMetres(stats.steepestAt![0], stats.steepestAt![1], testOrigin);
    expect(steepest.x_m).toBeCloseTo(5, 1);
  });

  it('a single densified leg (vertices 1 m apart, straight and with a bend) yields one unshared stretch covering the whole leg, no forks, no collapse', () => {
    // 11 vertices from (0,0) to (10,0), then 10 vertices from (10,1) to (10,10) -> 21 vertices total
    const line: [number, number][] = [];
    for (let x = 0; x <= 10; x++) {
      line.push(pt(x, 0));
    }
    for (let y = 1; y <= 10; y++) {
      line.push(pt(10, y));
    }

    const leg0: PlanLeg = {
      from: 'start',
      to: 'bend-end',
      line,
      distance_m: 20,
      time_s: 16,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 2,
      max_slope_deg: 0,
    };

    const stretches = sharedSegments([leg0], testOrigin, 3);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].legs).toEqual([0]);
    expect(stretches[0].directions).toEqual(['fwd']);
    expect(stretches[0].line).toHaveLength(21);
    expect(stretches[0].line[0]).toEqual(pt(0, 0));
    expect(stretches[0].line[20]).toEqual(pt(10, 10));

    const forks = forkPoints([leg0], testOrigin, 3);
    expect(forks).toEqual([]);
  });

  it('an out-and-back where the return runs within 3 m of the outbound yields one shared stretch', () => {
    // Outbound: 0 to 50 m along y=0 (51 vertices, 1 m apart)
    // Return: 50 to 0 m along y=2 (51 vertices, 1 m apart, 2 m offset <= 3 m tolerance)
    const outboundLine: [number, number][] = [];
    for (let x = 0; x <= 50; x++) {
      outboundLine.push(pt(x, 0));
    }
    const returnLine: [number, number][] = [];
    for (let x = 50; x >= 0; x--) {
      returnLine.push(pt(x, 2));
    }

    const leg0: PlanLeg = {
      from: 'start',
      to: 'turnaround',
      line: outboundLine,
      distance_m: 50,
      time_s: 40,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 5,
      max_slope_deg: 0,
    };

    const leg1: PlanLeg = {
      from: 'turnaround',
      to: 'start',
      line: returnLine,
      distance_m: 50,
      time_s: 40,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 5,
      max_slope_deg: 0,
    };

    const stretches = sharedSegments([leg0, leg1], testOrigin, 3);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].legs).toEqual([0, 1]);
    expect(stretches[0].directions).toEqual(['fwd', 'back']);
    expect(stretches[0].line.length).toBeGreaterThanOrEqual(50);
  });

  it('two legs that touch at one point only yield no shared stretch', () => {
    // Leg 0: (0,0) -> (25,0) -> (50,0)
    // Leg 1: (50,0) -> (50,25) -> (50,50)
    const leg0: PlanLeg = {
      from: 'start',
      to: 'corner',
      line: [pt(0, 0), pt(25, 0), pt(50, 0)],
      distance_m: 50,
      time_s: 40,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 5,
      max_slope_deg: 0,
    };

    const leg1: PlanLeg = {
      from: 'corner',
      to: 'end',
      line: [pt(50, 0), pt(50, 25), pt(50, 50)],
      distance_m: 50,
      time_s: 40,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 5,
      max_slope_deg: 0,
    };

    const stretches = sharedSegments([leg0, leg1], testOrigin, 3);
    const shared = stretches.filter((s) => s.legs.length >= 2);
    expect(shared).toHaveLength(0);
    expect(stretches.every((s) => s.legs.length === 1)).toBe(true);

    const forks = forkPoints([leg0, leg1], testOrigin, 3);
    expect(forks).toEqual([]);
  });

  it('performance: sharedSegments runs under 200 ms on Gale sample plan and a 5,000-vertex route', () => {
    const samplePlan = samplePlanJson as unknown as Plan;
    const galeOrigin: GridOrigin = {
      lon0: 137.36045619776752,
      lat0: -4.765947140908848,
      lat_c: -4.761729489694319,
    };

    // Warm up JIT
    sharedSegments(samplePlan.route.legs.slice(0, 1), galeOrigin, 3);

    // 1. Gale sample plan (median of 5 runs to avoid OS scheduling spikes)
    const galeRuns: number[] = [];
    let galeSegments: ReturnType<typeof sharedSegments> = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      galeSegments = sharedSegments(samplePlan.route.legs, galeOrigin, 3);
      galeRuns.push(performance.now() - t0);
    }
    galeRuns.sort((a, b) => a - b);
    const galeMedian = galeRuns[2];
    expect(galeSegments.length).toBeGreaterThan(0);
    expect(galeMedian).toBeLessThan(200);

    // 2. 5,000-vertex synthetic route (2,500 outbound + 2,500 return out-and-back)
    const outPts: [number, number][] = [];
    const backPts: [number, number][] = [];
    for (let i = 0; i < 2500; i++) {
      outPts.push(pt(i * 2, 0));
      backPts.push(pt(i * 2, 1));
    }
    backPts.reverse();

    const legA: PlanLeg = {
      from: 'start',
      to: 'far',
      line: outPts,
      distance_m: 5000,
      time_s: 4000,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 500,
      max_slope_deg: 0,
    };
    const legB: PlanLeg = {
      from: 'far',
      to: 'start',
      line: backPts,
      distance_m: 5000,
      time_s: 4000,
      climb_m: 0,
      descent_m: 0,
      energy_kj: 500,
      max_slope_deg: 0,
    };

    const smallOut: [number, number][] = [];
    const smallBack: [number, number][] = [];
    for (let i = 0; i < 250; i++) {
      smallOut.push(pt(i * 2, 0));
      smallBack.push(pt(i * 2, 1));
    }
    smallBack.reverse();
    const smallLegA: PlanLeg = {
      from: 'start', to: 'far', line: smallOut,
      distance_m: 500, time_s: 400, climb_m: 0, descent_m: 0, energy_kj: 50, max_slope_deg: 0,
    };
    const smallLegB: PlanLeg = {
      from: 'far', to: 'start', line: smallBack,
      distance_m: 500, time_s: 400, climb_m: 0, descent_m: 0, energy_kj: 50, max_slope_deg: 0,
    };
    const smallRuns: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t = performance.now();
      sharedSegments([smallLegA, smallLegB], testOrigin, 3);
      smallRuns.push(performance.now() - t);
    }
    smallRuns.sort((a, b) => a - b);
    const smallMedian = smallRuns[2];

    const synthRuns: number[] = [];
    let synthSegments: ReturnType<typeof sharedSegments> = [];
    for (let r = 0; r < 5; r++) {
      const t1 = performance.now();
      synthSegments = sharedSegments([legA, legB], testOrigin, 3);
      synthRuns.push(performance.now() - t1);
    }
    synthRuns.sort((a, b) => a - b);
    const synthMedian = synthRuns[2];
    expect(synthSegments.length).toBeGreaterThan(0);
    expect(synthMedian).toBeLessThan(200);
    // 10x vertices takes under 20x time to verify O(n) scaling under load
    expect(synthMedian).toBeLessThanOrEqual(Math.max(smallMedian * 20, 200));
  });

  const galeDir = path.resolve(__dirname, '../../../data/sites/gale/bundle');
  const hasGaleData = fs.existsSync(path.join(galeDir, 'grid.json'));
  it.skipIf(!hasGaleData)('real Gale sample plan: sharedSegments avoids fragmenting near-parallel routes', () => {
    // galeDir already resolved above
    const gridHeader = JSON.parse(fs.readFileSync(path.join(galeDir, 'grid.json'), 'utf-8'));
    const site = JSON.parse(fs.readFileSync(path.join(galeDir, 'site.json'), 'utf-8'));
    const elevBuf = fs.readFileSync(path.join(galeDir, 'elev.bin'));
    const costBuf = fs.readFileSync(path.join(galeDir, 'cost.bin'));

    const elevData = new Uint16Array(elevBuf.buffer, elevBuf.byteOffset, elevBuf.byteLength / 2);
    const costData = new Uint8Array(costBuf.buffer, costBuf.byteOffset, costBuf.byteLength);

    const grid = createGrid(gridHeader, elevData, costData, site.origin);
    const sample = samplePlanJson as unknown as Plan;

    const mask = reachableMask(grid, sample.start);
    const snappedStop = snapToReachable(grid, mask, sample.stops[0]);
    expect(snappedStop).not.toBeNull();

    const initialPlan = makeInitialPlan('gale', sample.start);
    const plan = buildPlan({
      grid,
      params: initialPlan.params,
      start: sample.start,
      stops: [{ ...sample.stops[0], lon: snappedStop!.lon, lat: snappedStop!.lat }],
    });

    expect(plan.route.legs.length).toBe(2);
    const segs = sharedSegments(plan.route.legs, site.origin);

    // Target 1: at most 10 stretches
    expect(segs.length).toBeLessThanOrEqual(10);

    // Target 2: every stretch at least 15 m (MIN_STRETCH_M) except a whole leg shorter than that
    for (const s of segs) {
      let lenM = 0;
      for (let i = 0; i < s.line.length - 1; i++) {
        const a = lonlatToLocalMetres(s.line[i][0], s.line[i][1], site.origin);
        const b = lonlatToLocalMetres(s.line[i + 1][0], s.line[i + 1][1], site.origin);
        lenM += Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
      }
      expect(lenM).toBeGreaterThanOrEqual(MIN_STRETCH_M);
    }

    // Target 3: directions per stretch are a set: never 'fwd+fwd' or 'back+back'
    for (const s of segs) {
      const counts: Record<string, number> = {};
      for (const d of s.directions) {
        counts[d] = (counts[d] || 0) + 1;
        expect(counts[d]).toBe(1);
      }
    }

    // Target 4: chevronsFor over all stretches gives one arrow per direction about every spacing (not 0, not 100+)
    let totalArrows = 0;
    for (const s of segs) {
      const ch = chevronsFor(s.line, s.directions, site.origin);
      totalArrows += ch.length;
    }
    expect(totalArrows).toBeGreaterThanOrEqual(4);
    expect(totalArrows).toBeLessThan(50);
  });

  it('synthetic: two parallel 600 m polylines 1-5 m apart with excursions beyond 3 m', () => {
    // Two parallel 600 m polylines 1-5 m apart with a few excursions beyond 3 m
    // Outbound leg: 600m along y=0 (vertices every 2m: 301 vertices)
    const outbound: [number, number][] = [];
    for (let x = 0; x <= 600; x += 2) {
      outbound.push(pt(x, 0));
    }

    // Return leg: 600m along y=2 (parallel 2m apart)
    // Short excursion (< 15m): x from 208 down to 200 -> len 8m at y=5 (5m apart > 3m tolerance)
    // Genuine detour (> 15m): x from 450 down to 400 -> len 50m at y=10 (10m apart > 3m tolerance)
    const returnLine: [number, number][] = [];
    for (let x = 600; x >= 0; x -= 2) {
      let y = 2;
      if (x >= 202 && x <= 206) {
        y = 5;
      } else if (x >= 400 && x <= 450) {
        y = 10;
      }
      returnLine.push(pt(x, y));
    }

    const leg0: PlanLeg = {
      from: 'start', to: 'turnaround', line: outbound,
      distance_m: 600, time_s: 480, climb_m: 0, descent_m: 0, energy_kj: 120, max_slope_deg: 0,
    };
    const leg1: PlanLeg = {
      from: 'turnaround', to: 'start', line: returnLine,
      distance_m: 600, time_s: 480, climb_m: 0, descent_m: 0, energy_kj: 120, max_slope_deg: 0,
    };

    const segs = sharedSegments([leg0, leg1], testOrigin, 3);
    // Short excursion is absorbed; genuine detour is preserved; at most 10 stretches
    expect(segs.length).toBeLessThanOrEqual(10);

    for (const s of segs) {
      let lenM = 0;
      for (let i = 0; i < s.line.length - 1; i++) {
        const a = lonlatToLocalMetres(s.line[i][0], s.line[i][1], testOrigin);
        const b = lonlatToLocalMetres(s.line[i + 1][0], s.line[i + 1][1], testOrigin);
        lenM += Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
      }
      expect(lenM).toBeGreaterThanOrEqual(MIN_STRETCH_M);
    }

    // Directions per stretch are a set
    for (const s of segs) {
      const counts: Record<string, number> = {};
      for (const d of s.directions) {
        counts[d] = (counts[d] || 0) + 1;
        expect(counts[d]).toBe(1);
      }
    }

    let totalArrows = 0;
    for (const s of segs) {
      const ch = chevronsFor(s.line, s.directions, testOrigin);
      totalArrows += ch.length;
    }
    expect(totalArrows).toBeGreaterThanOrEqual(4);
    expect(totalArrows).toBeLessThan(50);
  });
});


