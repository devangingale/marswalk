// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { forkPoints, sections, sharedSegments } from '../lib/routeShape';
import { buildCornerPlan } from './cornerPlan';
import { branchLabel, sectionLabel } from './routeLook';

const ORIGIN = { lon0: 137.36045619776752, lat0: -4.765947140908848, lat_c: -4.761729489694319 };

describe('buildCornerPlan', () => {
  const plan = buildCornerPlan(ORIGIN);
  const legs = plan.route.legs;

  it('starts and ends at the sample drop-off', () => {
    expect(plan.start.lon).toBeCloseTo(137.36468864, 6);
    expect(plan.start.lat).toBeCloseTo(-4.76172949, 6);
    expect(legs[0].line[0]).toEqual([plan.start.lon, plan.start.lat]);
    expect(legs.at(-1)!.line.at(-1)).toEqual([plan.start.lon, plan.start.lat]);
  });

  it('measures each leg in the local-metre frame', () => {
    expect(legs.map((l) => l.distance_m)).toEqual([216, 309, 613, 574]);
    expect(plan.route.totals.distance_m).toBe(1712);
  });

  it('walks the spur both ways and the drop-off stretch out and home', () => {
    const shared = sharedSegments(legs, ORIGIN, 3).filter((s) => s.legs.length > 1);
    expect(shared.map((s) => [s.legs, s.directions])).toEqual([
      [[0, 3], ['fwd', 'back']],
      [[1, 2], ['fwd', 'back']],
    ]);
  });

  it('forks where the way home joins and where the spur leaves', () => {
    const forks = forkPoints(legs, ORIGIN, 3);
    expect(forks.map((f) => f.branches.map((b) => branchLabel(b.toLabel, plan)))).toEqual([
      ['to Stop 1', 'back to shelter'],
      ['to Stop 2', 'to Stop 3'],
    ]);
  });

  it('makes stop 2 a detour of the middle section', () => {
    expect(sections(plan, ORIGIN).map((s) => sectionLabel(s, plan))).toEqual([
      'Shelter → 1 · 216 m · 8 min',
      '1 → 3 via 2 · 922 m · 34 min',
      '3 → Shelter · 574 m · 21 min',
    ]);
  });
});
