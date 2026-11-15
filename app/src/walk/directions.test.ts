// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { GridOrigin, localMetresToLonLat } from '../lib/grid';
import type { Plan, PlanLeg } from '../lib/plan';
import { formatDistance } from './format';
import { buildTrack, walkStateAt } from './track';
import {
  buildDirections,
  classifyTurn,
  compass16,
  directionsAt,
  formatBearing,
  instructionText,
  maneuverAction,
  signedTurn,
  sunSide,
  sunText,
} from './directions';

const origin: GridOrigin = { lon0: 137.0, lat0: -5.0, lat_c: -5.0 };

function at(x_m: number, y_m: number): [number, number] {
  const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);
  return [lon, lat];
}

/**
 * A line through local-metre corners, densified to 4 m steps like planner output but
 * without lib/plan densifyLine's 7-decimal rounding, so expected values stay exact.
 */
function line(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [at(...points[0])];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let k = 1; k <= steps; k++) out.push(at(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps));
  }
  return out;
}

function lengthOf(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** Legs walked at 1 m/s; stops s1, s2 ... at the end of each leg except a leg back to start. */
function planFrom(legs: { to: string; points: [number, number][] }[], stops: { id: string; x: number; y: number }[]): Plan {
  const planLegs: PlanLeg[] = legs.map((l, i) => {
    const d = lengthOf(l.points);
    return {
      from: i === 0 ? 'start' : legs[i - 1].to,
      to: l.to,
      line: line(l.points),
      distance_m: d,
      time_s: d,
      climb_m: 0,
      descent_m: 0,
      energy_kj: d / 10,
      max_slope_deg: 0,
    };
  });
  const start = at(0, 0);
  return {
    version: 1,
    site: 'test',
    params: { crew: 2, time_limit_s: 7200, suit_mass_kg: 120, body_mass_kg: 80, stop_time_s: 600, solar_event: false },
    start: { lon: start[0], lat: start[1], label: 'Shelter' },
    stops: stops.map((s) => {
      const [lon, lat] = at(s.x, s.y);
      return { id: s.id, name: `Site ${s.id}`, lon, lat, dwell_s: 100 };
    }),
    route: {
      legs: planLegs,
      returns_to_start: legs.at(-1)?.to === 'start',
      totals: {
        distance_m: planLegs.reduce((a, l) => a + l.distance_m, 0),
        time_s: planLegs.reduce((a, l) => a + l.time_s, 0),
        climb_m: 0,
        descent_m: 0,
        energy_kj: planLegs.reduce((a, l) => a + l.energy_kj, 0),
        dose_mgy: 0.01,
      },
      turn_back: null,
      feasible: true,
      warnings: [],
    },
  };
}

function expectBearing(actual: number, expected: number, digits = 6) {
  expect(signedTurn(expected, actual)).toBeCloseTo(0, digits);
}

describe('helpers', () => {
  it('classifies bearing changes at the 20, 60 and 135 degree bounds', () => {
    expect(classifyTurn(19.9)).toBe('continue');
    expect(classifyTurn(-19.9)).toBe('continue');
    expect(classifyTurn(20)).toBe('bear-right');
    expect(classifyTurn(-59.9)).toBe('bear-left');
    expect(classifyTurn(60)).toBe('turn-right');
    expect(classifyTurn(-135)).toBe('turn-left');
    expect(classifyTurn(135.1)).toBe('sharp-right');
    expect(classifyTurn(-170)).toBe('sharp-left');
  });

  it('names 16 compass points and three-digit true-north bearings', () => {
    expect([0, 22.5, 45, 67.5, 90, 180, 247.5, 337.5, 348.75, 359.9].map(compass16)).toEqual([
      'N', 'NNE', 'NE', 'ENE', 'E', 'S', 'WSW', 'NNW', 'N', 'N',
    ]);
    expect(formatBearing(45)).toBe('045°');
    expect(formatBearing(359.6)).toBe('000°');
    expect(formatBearing(-90)).toBe('270°');
  });

  it('signs turns clockwise-positive in (-180, 180]', () => {
    expect(signedTurn(350, 10)).toBe(20);
    expect(signedTurn(10, 350)).toBe(-20);
    expect(signedTurn(0, 180)).toBe(180);
    expect(signedTurn(90, 0)).toBe(-90);
  });

  it('puts the Sun in eight sectors and below 5 degrees calls it down', () => {
    expect(sunSide(90, 30, 90)).toBe('ahead');
    expect(sunSide(135, 30, 90)).toBe('ahead-right');
    expect(sunSide(180, 30, 90)).toBe('right');
    expect(sunSide(270, 30, 90)).toBe('behind');
    expect(sunSide(0, 30, 90)).toBe('left');
    expect(sunSide(68, 30, 90)).toBe('ahead');
    expect(sunSide(67, 30, 90)).toBe('ahead-left');
    expect(sunSide(90, 4.9, 90)).toBeNull();
    expect(sunText(sunSide(0, 30, 90))).toBe('Sun on your left');
    expect(sunText(sunSide(270, 30, 90))).toBe('Sun behind you');
    expect(sunText(null)).toBe('Sun below the horizon');
  });
});

describe('L-shaped route: 100 m east, then 100 m north to Stop 1', () => {
  const plan = planFrom([{ to: 's1', points: [[0, 0], [100, 0], [100, 100]] }], [{ id: 's1', x: 100, y: 100 }]);
  const track = buildTrack(plan, origin);
  const dirs = buildDirections(plan, track, origin);

  it('has one left turn at 100 m and the arrival at 200 m', () => {
    expect(dirs.maneuvers.map((m) => m.kind)).toEqual(['turn-left', 'arrive-stop']);
    const [turn, arrive] = dirs.maneuvers;
    expect(turn.alongM).toBeCloseTo(100, 6);
    expect(turn.turnDeg).toBeCloseTo(-90, 6);
    expectBearing(turn.bearingDeg, 0);
    expect(turn.compass).toBe('N');
    expect(turn.targetLabel).toBe('Stop 1');
    expect(turn.targetName).toBe('Site s1');
    expect(arrive.alongM).toBeCloseTo(200, 6);
    expect(arrive.turnDeg).toBe(0);
    expect(maneuverAction(arrive)).toBe('arrive at Stop 1');
    expect(dirs.segments).toHaveLength(2);
  });

  it('40 m in: turn left in 60 m, walking east, Stop 1 at 031 degrees and 116.6 m', () => {
    const now = directionsAt(dirs, track, walkStateAt(plan, track, 40), plan, origin);
    expect(now.next?.kind).toBe('turn-left');
    expect(now.distanceToNextM).toBeCloseTo(60, 6);
    expectBearing(now.walkingBearingDeg, 90);
    expect(now.relativeTurnDeg).toBeCloseTo(-90, 6);
    expect(now.target?.label).toBe('Stop 1');
    expect(now.target?.distanceM).toBeCloseTo(Math.hypot(60, 100), 6);
    expectBearing(now.target!.bearingDeg, (Math.atan2(60, 100) * 180) / Math.PI);
    expect(now.target?.compass).toBe('NNE');
    expect(instructionText(now, formatDistance)).toBe('In 60 m, turn left');
  });

  it('150 m in: Stop 1 is the next maneuver, 50 m ahead and dead ahead', () => {
    const now = directionsAt(dirs, track, walkStateAt(plan, track, 150), plan, origin);
    expect(now.next?.kind).toBe('arrive-stop');
    expect(now.distanceToNextM).toBeCloseTo(50, 6);
    expect(now.relativeTurnDeg).toBeCloseTo(0, 6);
    expect(now.target?.distanceM).toBeCloseTo(50, 6);
    expectBearing(now.target!.bearingDeg, 0);
    expect(instructionText(now, formatDistance)).toBe('In 50 m, arrive at Stop 1');
  });

  it('at the end there is nothing left to do', () => {
    const now = directionsAt(dirs, track, walkStateAt(plan, track, track.durationS), plan, origin);
    expect(now.next).toBeNull();
    expect(now.target).toBeNull();
    expect(instructionText(now, formatDistance)).toBe('Route complete');
  });
});

describe('zigzag route', () => {
  it('ignores wiggles under 10 m on a straight 300 m walk east', () => {
    const points: [number, number][] = [[0, 0]];
    for (let x = 10; x < 300; x += 10) points.push([x, x % 20 === 0 ? 3 : -3]);
    points.push([300, 0]);
    const plan = planFrom([{ to: 's1', points }], [{ id: 's1', x: 300, y: 0 }]);
    const track = buildTrack(plan, origin);
    const dirs = buildDirections(plan, track, origin);
    expect(dirs.maneuvers.map((m) => m.kind)).toEqual(['arrive-stop']);
    expectBearing(dirs.maneuvers[0].bearingDeg, 90);
    expect(dirs.maneuvers[0].compass).toBe('E');
  });

  it('reads 100 m zigs as alternating right and left turns', () => {
    const plan = planFrom(
      [{ to: 's1', points: [[0, 0], [100, 100], [200, 0], [300, 100]] }],
      [{ id: 's1', x: 300, y: 100 }],
    );
    const track = buildTrack(plan, origin);
    const dirs = buildDirections(plan, track, origin);
    expect(dirs.maneuvers.map((m) => m.kind)).toEqual(['turn-right', 'turn-left', 'arrive-stop']);
    const leg = 100 * Math.SQRT2;
    expect(dirs.maneuvers[0].alongM).toBeCloseTo(leg, 6);
    expect(dirs.maneuvers[0].turnDeg).toBeCloseTo(90, 6);
    expectBearing(dirs.maneuvers[0].bearingDeg, 135);
    expect(dirs.maneuvers[0].compass).toBe('SE');
    expect(dirs.maneuvers[1].alongM).toBeCloseTo(2 * leg, 6);
    expect(dirs.maneuvers[1].turnDeg).toBeCloseTo(-90, 6);
    expect(dirs.maneuvers[1].compass).toBe('NE');
    expect(dirs.maneuvers[2].alongM).toBeCloseTo(3 * leg, 6);
  });

  it('bears right at 40 degrees and turns sharp left at 150 degrees', () => {
    const r = (deg: number) => (deg * Math.PI) / 180;
    // North 100 m, then bearing 040 for 100 m, then bearing 250 (150 to the left) for 100 m.
    const p1: [number, number] = [0, 100];
    const p2: [number, number] = [p1[0] + 100 * Math.sin(r(40)), p1[1] + 100 * Math.cos(r(40))];
    const p3: [number, number] = [p2[0] + 100 * Math.sin(r(250)), p2[1] + 100 * Math.cos(r(250))];
    const plan = planFrom([{ to: 's1', points: [[0, 0], p1, p2, p3] }], [{ id: 's1', x: p3[0], y: p3[1] }]);
    const track = buildTrack(plan, origin);
    const dirs = buildDirections(plan, track, origin);
    expect(dirs.maneuvers.map((m) => m.kind)).toEqual(['bear-right', 'sharp-left', 'arrive-stop']);
    expect(dirs.maneuvers[0].turnDeg).toBeCloseTo(40, 6);
    expect(dirs.maneuvers[0].compass).toBe('NE');
    expect(dirs.maneuvers[1].turnDeg).toBeCloseTo(-150, 6);
    expect(dirs.maneuvers[1].compass).toBe('WSW');
    expect(maneuverAction(dirs.maneuvers[1])).toBe('sharp left');
  });
});

describe('out-and-back: 200 m north to Stop 1 and back to the shelter', () => {
  const plan = planFrom(
    [
      { to: 's1', points: [[0, 0], [0, 200]] },
      { to: 'start', points: [[0, 200], [0, 0]] },
    ],
    [{ id: 's1', x: 0, y: 200 }],
  );
  const track = buildTrack(plan, origin);
  const dirs = buildDirections(plan, track, origin);

  it('arrives at Stop 1, turns around there and arrives at the shelter', () => {
    expect(dirs.maneuvers.map((m) => m.kind)).toEqual(['arrive-stop', expect.stringMatching(/^sharp-/), 'arrive-shelter']);
    const [arrive, turn, home] = dirs.maneuvers;
    expect(arrive.alongM).toBeCloseTo(200, 6);
    expect(turn.alongM).toBeCloseTo(200, 6);
    expect(Math.abs(turn.turnDeg)).toBeCloseTo(180, 6);
    expect(maneuverAction(turn)).toBe('turn around');
    expectBearing(turn.bearingDeg, 180);
    expect(turn.compass).toBe('S');
    expect(turn.targetLabel).toBe('the shelter');
    expect(home.alongM).toBeCloseTo(400, 6);
    expect(home.targetName).toBe('Shelter');
    expect(maneuverAction(home)).toBe('arrive at the shelter');
  });

  it('dwelling at Stop 1: the turn-around is now, and the shelter is 200 m due south', () => {
    const state = walkStateAt(plan, track, 250); // walk 200 s, dwell 100 s
    expect(state.atWaypointId).toBe('s1');
    const now = directionsAt(dirs, track, state, plan, origin);
    expect(now.next?.kind).toMatch(/^sharp-/);
    expect(now.distanceToNextM).toBe(0);
    expectBearing(now.walkingBearingDeg, 0);
    expect(Math.abs(now.relativeTurnDeg)).toBeCloseTo(180, 6);
    expect(now.target?.label).toBe('the shelter');
    expect(now.target?.distanceM).toBeCloseTo(200, 6);
    expectBearing(now.target!.bearingDeg, 180);
    expect(instructionText(now, formatDistance)).toBe('Now, turn around');
  });

  it('on the way back: the shelter in 120 m, straight on', () => {
    const now = directionsAt(dirs, track, walkStateAt(plan, track, 380), plan, origin);
    expect(now.next?.kind).toBe('arrive-shelter');
    expect(now.distanceToNextM).toBeCloseTo(120, 6);
    expect(now.relativeTurnDeg).toBeCloseTo(0, 6);
    expect(now.target?.distanceM).toBeCloseTo(120, 6);
    expect(instructionText(now, formatDistance)).toBe('In 120 m, arrive at the shelter');
  });
});
