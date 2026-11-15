// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { GridOrigin, localMetresToLonLat, lonlatToLocalMetres } from '../lib/grid';
import { densifyLine, Plan } from '../lib/plan';
import samplePlanJson from '../fixtures/plan.sample.json';
import { budgetRemaining, buildTrack, walkStateAt } from './track';

const origin: GridOrigin = { lon0: 137.0, lat0: -5.0, lat_c: -5.0 };

function at(x_m: number, y_m: number): [number, number] {
  const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);
  return [lon, lat];
}

function metres(lon: number, lat: number): { x_m: number; y_m: number } {
  return lonlatToLocalMetres(lon, lat, origin);
}

/**
 * Out 100 m due east to s1 (125 s, 50 kJ), 600 s at s1, back 100 m due west (125 s, 40 kJ).
 * Totals carry 30 kJ for the dwell. Turn-back is 40 m east of the start on the way home.
 */
function syntheticPlan(): Plan {
  const start = at(0, 0);
  const s1 = at(100, 0);
  const turnBack = at(40, 0);
  return {
    version: 1,
    site: 'test',
    params: { crew: 2, time_limit_s: 3600, suit_mass_kg: 120, body_mass_kg: 80, stop_time_s: 1200, solar_event: false },
    start: { lon: start[0], lat: start[1], label: 'Rover drop-off' },
    stops: [{ id: 's1', name: 'Ridge', lon: s1[0], lat: s1[1], note: 'Veins', dwell_s: 600 }],
    route: {
      legs: [
        { from: 'start', to: 's1', line: densifyLine([start, s1], origin), distance_m: 100, time_s: 125, climb_m: 0, descent_m: 0, energy_kj: 50, max_slope_deg: 0 },
        { from: 's1', to: 'start', line: densifyLine([s1, start], origin), distance_m: 100, time_s: 125, climb_m: 0, descent_m: 0, energy_kj: 40, max_slope_deg: 0 },
      ],
      returns_to_start: true,
      totals: { distance_m: 200, time_s: 850, climb_m: 0, descent_m: 0, energy_kj: 120, dose_mgy: 0.01 },
      turn_back: { leg: 1, lon: turnBack[0], lat: turnBack[1], reason: 'time' },
      feasible: true,
      warnings: [],
    },
  };
}

describe('marker interpolation along a densified line', () => {
  const plan = syntheticPlan();
  const track = buildTrack(plan, origin);

  it('densified line spacing is under 4 m and the track spans both legs', () => {
    expect(plan.route.legs[0].line.length).toBe(28);
    expect(track.vertices.length).toBe(56);
    expect(track.vertices[27].along_m).toBeCloseTo(100, 2);
    expect(track.vertices[55].along_m).toBeCloseTo(200, 2);
    expect(track.durationS).toBe(850);
  });

  it('places the marker by elapsed leg time between densified vertices', () => {
    const state = walkStateAt(plan, track, 12.5);
    const p = metres(state.lon, state.lat);
    expect(p.x_m).toBeCloseTo(10, 2);
    expect(p.y_m).toBeCloseTo(0, 2);
    expect(state.headingDeg).toBeCloseTo(90, 3);
    expect(state.alongM).toBeCloseTo(10, 2);
  });

  it('heads west on the way home', () => {
    const state = walkStateAt(plan, track, 725 + 62.5);
    const p = metres(state.lon, state.lat);
    expect(p.x_m).toBeCloseTo(50, 2);
    expect(state.headingDeg).toBeCloseTo(270, 3);
  });

  it('holds the marker at the stop while dwelling', () => {
    const state = walkStateAt(plan, track, 425);
    const p = metres(state.lon, state.lat);
    expect(p.x_m).toBeCloseTo(100, 2);
    expect(state.atWaypointId).toBe('s1');
    expect(state.headingDeg).toBeCloseTo(90, 3);
  });

  it('clamps outside the replay window', () => {
    const before = walkStateAt(plan, track, -10);
    expect(metres(before.lon, before.lat).x_m).toBeCloseTo(0, 2);
    const after = walkStateAt(plan, track, 9999);
    expect(after.elapsedS).toBe(850);
    expect(metres(after.lon, after.lat).x_m).toBeCloseTo(0, 2);
  });
});

describe('next stop and distance to it', () => {
  const plan = syntheticPlan();
  const track = buildTrack(plan, origin);

  it('at the start, the whole first leg is ahead', () => {
    expect(walkStateAt(plan, track, 0).next).toEqual({ id: 's1', distanceM: 100, timeS: 125 });
  });

  it('halfway out, half the leg distance and time remain', () => {
    expect(walkStateAt(plan, track, 62.5).next).toEqual({ id: 's1', distanceM: 50, timeS: 62.5 });
  });

  it('while dwelling, the next leg is ahead plus the dwell still to run', () => {
    expect(walkStateAt(plan, track, 425).next).toEqual({ id: 'start', distanceM: 100, timeS: 425 });
  });

  it('back at the start there is no next stop', () => {
    const state = walkStateAt(plan, track, 850);
    expect(state.next).toBeNull();
    expect(state.atWaypointId).toBe('start');
  });
});

describe('budget used and remaining', () => {
  const plan = syntheticPlan();
  const track = buildTrack(plan, origin);

  it('accrues walking energy by leg fraction and dwell energy by dwell fraction', () => {
    expect(walkStateAt(plan, track, 62.5).used.energy_kj).toBe(25);
    expect(walkStateAt(plan, track, 425).used.energy_kj).toBe(65);
    expect(walkStateAt(plan, track, 725 + 62.5).used.energy_kj).toBe(100);
  });

  it('accrues dose linearly with elapsed time', () => {
    expect(walkStateAt(plan, track, 425).used.dose_mgy).toBeCloseTo(0.005, 12);
  });

  it('ends exactly on the plan totals', () => {
    const end = walkStateAt(plan, track, 850);
    expect(end.used).toEqual({ time_s: 850, energy_kj: 120, dose_mgy: 0.01 });
    const remaining = budgetRemaining(plan, end.used);
    expect(remaining.time).toEqual({ used: 850, total: 3600, remaining: 2750, basis: 'limit' });
    expect(remaining.energy).toEqual({ used: 120, total: 120, remaining: 0, basis: 'plan' });
    expect(remaining.dose).toEqual({ used: 0.01, total: 0.01, remaining: 0, basis: 'plan' });
  });

  it('measures energy against the energy limit when the plan sets one', () => {
    const plan2 = syntheticPlan();
    plan2.params.energy_limit_kj = 500;
    const remaining = budgetRemaining(plan2, walkStateAt(plan2, track, 62.5).used);
    expect(remaining.energy).toEqual({ used: 25, total: 500, remaining: 475, basis: 'limit' });
  });
});

describe('turn-back point', () => {
  const plan = syntheticPlan();
  const track = buildTrack(plan, origin);

  it('snaps to the nearest return-leg vertex, 16 densified steps from s1', () => {
    expect(track.turnBackAlongM).toBeCloseTo(100 + (16 * 100) / 27, 2);
  });

  it('is not passed on the way out, at the stop, or 44 m from home', () => {
    expect(walkStateAt(plan, track, 62.5).turnBackPassed).toBe(false);
    expect(walkStateAt(plan, track, 425).turnBackPassed).toBe(false);
    expect(walkStateAt(plan, track, 725 + 0.56 * 125).turnBackPassed).toBe(false);
  });

  it('is passed 36 m from home and at the end', () => {
    expect(walkStateAt(plan, track, 725 + 0.64 * 125).turnBackPassed).toBe(true);
    expect(walkStateAt(plan, track, 850).turnBackPassed).toBe(true);
  });

  it('is reported as unknown when the plan has none', () => {
    const plan2 = syntheticPlan();
    plan2.route.turn_back = null;
    const track2 = buildTrack(plan2, origin);
    expect(track2.turnBackAlongM).toBeNull();
    expect(walkStateAt(plan2, track2, 62.5).turnBackPassed).toBeNull();
  });
});

describe('sample plan replay (app/src/fixtures/plan.sample.json)', () => {
  const plan = samplePlanJson as unknown as Plan;
  const galeOrigin: GridOrigin = { lon0: 137.3628, lat0: -4.825, lat_c: -4.7913 };
  const track = buildTrack(plan, galeOrigin);

  it('runs for the plan total time', () => {
    expect(track.durationS).toBe(2636);
  });

  it('returns the marker to the start with the plan totals used', () => {
    const end = walkStateAt(plan, track, track.durationS);
    expect(end.lon).toBeCloseTo(plan.start.lon, 7);
    expect(end.lat).toBeCloseTo(plan.start.lat, 7);
    // Legs 695 kJ + 20 min at Boxwork ridge standing at 1.5 MET (147.06 W x 1200 s = 176 kJ).
    expect(end.used).toEqual({ time_s: 2636, energy_kj: 871, dose_mgy: 0.006 });
    expect(end.turnBackPassed).toBe(true);
  });

  it('arrives at Boxwork ridge after the first leg', () => {
    const arrival = walkStateAt(plan, track, 1318);
    expect(arrival.atWaypointId).toBe('s1');
    expect(arrival.lon).toBe(plan.stops[0].lon);
    expect(arrival.lat).toBe(plan.stops[0].lat);
    expect(arrival.next).toEqual({ id: 'start', distanceM: 503, timeS: 1318 });
  });
});
