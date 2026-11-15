// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { Plan, PlanLeg } from '../lib/plan';
import type { Section, SlopeStats } from '../lib/routeShape';
import {
  branchAnchor,
  branchLabel,
  branchLabelSides,
  chevronsFor,
  distanceAlong,
  formatElevation,
  formatGraticule,
  formatLatLon,
  gradeBin,
  gradeRuns,
  graticuleStep,
  graticuleValues,
  hoverMode,
  needsFinish,
  routeLabel,
  routeLine,
  screenSpan,
  sectionForLegs,
  sectionLabel,
  slopeLabels,
  showSummaryLabels,
  stretchStyles,
  waypointLabel,
} from './routeLook';

const ORIGIN = { lon0: 137.36045619776752, lat0: -4.765947140908848, lat_c: -4.761729489694319 };

function leg(from: string, to: string, distance_m: number, time_s: number, line: [number, number][] = []): PlanLeg {
  return { from, to, line, distance_m, time_s, climb_m: 0, descent_m: 0, energy_kj: 0, max_slope_deg: 0 };
}

function plan(legs: PlanLeg[], stopIds: string[]): Plan {
  return {
    version: 1,
    site: 'gale',
    params: { crew: 2, time_limit_s: 0, suit_mass_kg: 0, body_mass_kg: 0, stop_time_s: 0, solar_event: false },
    start: { lon: 0, lat: 0, label: 'Rover drop-off' },
    stops: stopIds.map((id) => ({ id, name: `Name ${id}`, lon: 0, lat: 0 })),
    route: {
      legs,
      returns_to_start: legs.at(-1)?.to === 'start',
      totals: {
        distance_m: legs.reduce((s, l) => s + l.distance_m, 0),
        time_s: legs.reduce((s, l) => s + l.time_s, 0),
        climb_m: 0,
        descent_m: 0,
        energy_kj: 0,
        dose_mgy: 0,
      },
      turn_back: null,
      feasible: true,
      warnings: [],
    },
  };
}

const LOOP = plan(
  [leg('start', 'a', 800, 1000), leg('a', 'b', 700, 900), leg('b', 'c', 900, 1400), leg('c', 'start', 1200, 1500)],
  ['a', 'b', 'c'],
);

describe('coordinates', () => {
  it('formats latitude and longitude to 4 decimals with hemispheres', () => {
    expect(formatLatLon(137.36468863872997, -4.761729489694319)).toBe('4.7617° S, 137.3647° E');
    expect(formatLatLon(-77.45, 18.4)).toBe('18.4000° N, 77.4500° W');
  });

  it('wraps longitudes past 180 degrees', () => {
    expect(formatLatLon(200, 0)).toBe('0.0000° N, 160.0000° W');
  });

  it('formats elevations to the metre with thousands separators', () => {
    expect(formatElevation(-4412.4)).toBe('-4,412 m');
    expect(formatElevation(21229)).toBe('21,229 m');
    expect(formatElevation(-87.6)).toBe('-88 m');
  });
});

describe('labels', () => {
  it('names the drop-off and numbers stops in plan order', () => {
    expect(waypointLabel('start', LOOP)).toBe('Drop-off');
    expect(waypointLabel('c', LOOP)).toBe('3');
  });

  it('labels a section with its detours, distance and time', () => {
    const section: Section = { id: 'section-1', fromStopId: 'start', toStopId: 'c', detourStopIds: ['b'], legIndices: [1, 2] };
    expect(sectionLabel(section, LOOP)).toBe('Drop-off → 3 via 2 · 1.6 km · 38 min');
  });

  it('labels a section without detours', () => {
    const section: Section = { id: 'section-0', fromStopId: 'start', toStopId: 'a', detourStopIds: [], legIndices: [0] };
    expect(sectionLabel(section, LOOP)).toBe('Drop-off → 1 · 800 m · 16 min');
  });

  it('labels the whole route as the chain of stops', () => {
    expect(routeLabel(LOOP)).toBe('Drop-off → 1 → 2 → 3 → Drop-off · 3.6 km · 1 h 20 min');
  });

  it('labels fork branches by destination', () => {
    expect(branchLabel('b', LOOP)).toBe('to Stop 2');
    expect(branchLabel('drop-off', LOOP)).toBe('back to drop-off');
  });

  it('needs a finish marker only when the route ends away from the drop-off', () => {
    expect(needsFinish(LOOP)).toBe(false);
    expect(needsFinish(plan([leg('start', 'a', 1, 1)], ['a']))).toBe(true);
    expect(needsFinish(plan([], []))).toBe(false);
  });
});

describe('hover', () => {
  it('highlights the whole route under 400 px on screen and sections above', () => {
    expect(hoverMode(399)).toBe('route');
    expect(hoverMode(400)).toBe('section');
  });

  it('measures the larger side of the screen bounding box', () => {
    expect(screenSpan([{ x: 10, y: 20 }, { x: 310, y: 60 }, { x: 200, y: 420 }])).toBe(400);
    expect(screenSpan([])).toBe(0);
  });

  it('highlights stretches walked by the section and dims the rest', () => {
    const legs = [[0], [0, 3], [1, 2], [2], [3]];
    expect(stretchStyles(legs, null)).toEqual(['normal', 'normal', 'normal', 'normal', 'normal']);
    expect(stretchStyles(legs, { mode: 'route' })).toEqual(['highlight', 'highlight', 'highlight', 'highlight', 'highlight']);
    expect(stretchStyles(legs, { mode: 'section', legIndices: [1, 2] })).toEqual([
      'dim',
      'dim',
      'highlight',
      'highlight',
      'dim',
    ]);
  });

  it('finds the first section walking any of a stretch’s legs', () => {
    const sections: Section[] = [
      { id: 'section-0', fromStopId: 'start', toStopId: 'a', detourStopIds: [], legIndices: [0] },
      { id: 'section-1', fromStopId: 'a', toStopId: 'c', detourStopIds: ['b'], legIndices: [1, 2] },
      { id: 'section-2', fromStopId: 'c', toStopId: 'start', detourStopIds: [], legIndices: [3] },
    ];
    expect(sectionForLegs(sections, [2, 3])?.id).toBe('section-1');
    expect(sectionForLegs(sections, [3, 0])?.id).toBe('section-0');
    expect(sectionForLegs(sections, [9])).toBeNull();
  });
});

describe('summary labels', () => {
  it('hides route summaries below 150 screen pixels', () => {
    expect([149, 150, 151].map(showSummaryLabels)).toEqual([false, true, true]);
  });
});

describe('gradient', () => {
  it('bins absolute gradients at 5, 10, 15 and 20 degrees', () => {
    expect([0, 4.99, 5, -9, 10, 14.9, 15, -19.99, 20, 35].map(gradeBin)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('splits a line into runs of one bin, sharing the vertex between runs', () => {
    const line: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    expect(gradeRuns(line, [1, -2, 7, 21])).toEqual([
      { bin: 1, line: [[0, 0], [1, 0], [2, 0]] },
      { bin: 2, line: [[2, 0], [3, 0]] },
      { bin: 5, line: [[3, 0], [4, 0]] },
    ]);
  });

  it('labels the high, low and steepest points', () => {
    const stats: SlopeStats = {
      highM: -4402.2,
      highAt: [0, 0],
      lowM: -4460.7,
      lowAt: [0, 0],
      steepestDeg: 17.6,
      steepestAt: [0, 0],
      climbM: 0,
      descentM: 0,
      gradientDeg: [],
    };
    expect(slopeLabels(stats, 118)).toEqual({
      high: 'High -4,402 m',
      low: 'Low -4,461 m',
      steepest: 'Steepest 18° · 118 m from drop-off',
    });
  });
});

describe('route geometry', () => {
  it('joins legs without repeating the shared stop vertex', () => {
    const p = plan(
      [leg('start', 'a', 0, 0, [[0, 0], [1, 0]]), leg('a', 'start', 0, 0, [[1, 0], [1, 1], [0, 0]])],
      ['a'],
    );
    expect(routeLine(p)).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it('measures distance along a line to the vertex nearest a point', () => {
    // 100 m east then 50 m north of the origin.
    const east = 100 / (3396190 * Math.cos((ORIGIN.lat_c * Math.PI) / 180)) * (180 / Math.PI);
    const north = 50 / 3396190 * (180 / Math.PI);
    const line: [number, number][] = [
      [ORIGIN.lon0, ORIGIN.lat0],
      [ORIGIN.lon0 + east, ORIGIN.lat0],
      [ORIGIN.lon0 + east, ORIGIN.lat0 + north],
    ];
    expect(distanceAlong(line, [ORIGIN.lon0 + east, ORIGIN.lat0 + north], ORIGIN)).toBeCloseTo(150, 6);
    expect(distanceAlong(line, [ORIGIN.lon0 + east * 1.01, ORIGIN.lat0], ORIGIN)).toBeCloseTo(100, 6);
  });

  it('anchors a branch label a set distance along the leg after the fork', () => {
    const east = 100 / (3396190 * Math.cos((ORIGIN.lat_c * Math.PI) / 180)) * (180 / Math.PI);
    const line: [number, number][] = [
      [ORIGIN.lon0, ORIGIN.lat0],
      [ORIGIN.lon0 + east, ORIGIN.lat0],
      [ORIGIN.lon0 + 2 * east, ORIGIN.lat0],
    ];
    const [lon, lat] = branchAnchor(line, [ORIGIN.lon0 + east, ORIGIN.lat0], 40, ORIGIN);
    expect(lon).toBeCloseTo(ORIGIN.lon0 + 1.4 * east, 10);
    expect(lat).toBeCloseTo(ORIGIN.lat0, 10);
  });
});

describe('branchLabelSides', () => {
  it('puts each branch label on the side away from the other branches', () => {
    // Two branches leaving a spur junction south-east and south-west.
    expect(branchLabelSides([156, 208])).toEqual([66, 298]);
    // To a stop north-east and back south to the drop-off.
    expect(branchLabelSides([36, 180])).toEqual([306, 270]);
  });

  it('uses the right-hand side for a lone branch', () => {
    expect(branchLabelSides([10])).toEqual([100]);
  });
});

describe('chevronsFor', () => {
  const metresEast = (m: number) => (m / (3396190 * Math.cos((ORIGIN.lat_c * Math.PI) / 180))) * (180 / Math.PI);
  const line: [number, number][] = [
    [ORIGIN.lon0, ORIGIN.lat0],
    [ORIGIN.lon0 + metresEast(400), ORIGIN.lat0],
  ];
  const along = (c: { lon: number }) => Math.round(((c.lon - ORIGIN.lon0) / metresEast(1)) * 1000) / 1000;

  it('points one way along a stretch walked one way', () => {
    expect(chevronsFor(line, ['fwd'], ORIGIN).map((c) => [along(c), Math.round(c.bearingDeg)])).toEqual([
      [75, 90],
      [225, 90],
    ]);
    expect(chevronsFor(line, ['back', 'back'], ORIGIN).map((c) => [along(c), Math.round(c.bearingDeg)])).toEqual([
      [325, 270],
      [175, 270],
    ]);
  });

  it('interleaves both directions on a stretch walked out and back', () => {
    expect(chevronsFor(line, ['fwd', 'back'], ORIGIN).map((c) => [along(c), Math.round(c.bearingDeg)])).toEqual([
      [75, 90],
      [225, 90],
      [150, 270],
      [300, 270],
    ]);
  });
});

describe('graticule', () => {
  it('steps from 10 degrees on the globe down to 0.001 degrees in a site', () => {
    expect([9_000_000, 3_000_000, 1_000_000, 50_000, 8_000, 1_000].map(graticuleStep)).toEqual([
      10, 10, 1, 0.1, 0.01, 0.001,
    ]);
  });

  it('lists the multiples of the step inside a range', () => {
    expect(graticuleValues(-23, 31, 10)).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(graticuleValues(137.3604, 137.3631, 0.001)).toEqual([137.361, 137.362, 137.363]);
  });

  it('labels lines with as many decimals as the step needs', () => {
    expect(formatGraticule(-20, 'lat', 10)).toBe('20° S');
    expect(formatGraticule(0, 'lon', 10)).toBe('0°');
    expect(formatGraticule(180, 'lon', 10)).toBe('180°');
    expect(formatGraticule(137.362, 'lon', 0.001)).toBe('137.362° E');
    expect(formatGraticule(-4.76, 'lat', 0.01)).toBe('4.76° S');
  });
});
