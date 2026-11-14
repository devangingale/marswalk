// Written with AI assistance, directed and reviewed by the team.

import { describe, expect, it } from 'vitest';
import {
  createGrid,
  GridOrigin,
  localMetresToLonLat,
  lonlatToLocalMetres,
  radToDeg,
  RouteGrid,
} from './grid';
import { Plan, PlanLeg } from './plan';
import {
  chevronPositions,
  forkPoints,
  sections,
  sharedSegments,
  slopeStats,
} from './routeShape';

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

  it('matches an out-and-back return with 5–8 m lateral wobble as one shared detour', () => {
    const outbound = [pt(0, 0), pt(100, 0), pt(200, 0), pt(300, 0)];
    const returning = [pt(300, 0), pt(200, 7), pt(100, -5), pt(0, 0)];
    const legs: PlanLeg[] = [
      { from: 'start', to: 'B', line: outbound, distance_m: 300, time_s: 240, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
      { from: 'B', to: 'start', line: returning, distance_m: 301, time_s: 241, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 },
    ];
    const shared = sharedSegments(legs, testOrigin);
    expect(shared).toHaveLength(1);
    expect(shared[0].legs).toEqual([0, 1]);
    expect(shared[0].directions).toEqual(['fwd', 'back']);
    expect(shared[0].line).toHaveLength(4);

    const plan: Plan = {
      version: 1, site: 'test-site',
      params: { crew: 2, time_limit_s: 3600, suit_mass_kg: 80, body_mass_kg: 75, stop_time_s: 300, solar_event: false },
      start: { lon: outbound[0][0], lat: outbound[0][1], label: 'Rover drop-off' },
      stops: [{ id: 'B', name: 'Stop B', lon: outbound[3][0], lat: outbound[3][1] }],
      route: { legs, returns_to_start: true, totals: { distance_m: 601, time_s: 481, climb_m: 0, descent_m: 0, energy_kj: 0, dose_mgy: 0 }, turn_back: null, feasible: true, warnings: [] },
    };
    expect(sections(plan, testOrigin)).toEqual([{
      id: 'section-0', fromStopId: 'start', toStopId: 'start', detourStopIds: ['B'], legIndices: [0, 1],
    }]);
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
});
