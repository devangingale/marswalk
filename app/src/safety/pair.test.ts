// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { MARS_R } from '../lib/grid';
import { PAIR_LIMIT_M, pairSeparation, hazardMarginM, HAZARD_MARGIN_DAY_M, HAZARD_MARGIN_NIGHT_M } from './pair';

/** Degrees of latitude for `m` metres on the Mars sphere. */
const degFor = (m: number) => (m / (MARS_R * Math.PI)) * 180;

const ev = (id: string, northM: number, uncertaintyM = 2) => ({
  id,
  lon: 137.4,
  lat: degFor(northM),
  uncertaintyM,
});

describe('pairSeparation', () => {
  it('uses a 50 m limit by default', () => {
    expect(PAIR_LIMIT_M).toBe(50);
  });

  it('is together at 3 m apart', () => {
    const r = pairSeparation([ev('EV1', 3), ev('EV2', 0)]);
    expect(r).not.toBeNull();
    expect(r!.level).toBe('together');
    expect(r!.distanceM).toBeCloseTo(3, 6);
    expect(r!.a).toBe('EV1');
    expect(r!.b).toBe('EV2');
  });

  it('is together exactly at the limit', () => {
    expect(pairSeparation([ev('EV1', 50), ev('EV2', 0)])!.level).toBe('together');
  });

  it('warns past the limit', () => {
    const r = pairSeparation([ev('EV1', 0), ev('EV2', 80)]);
    expect(r!.level).toBe('separated');
    expect(r!.distanceM).toBeCloseTo(80, 6);
    expect(r!.overByM).toBeCloseTo(30, 6);
    // EV2 is due north of EV1.
    expect(r!.bearingDeg).toBeCloseTo(0, 6);
  });

  it('is far past twice the limit', () => {
    expect(pairSeparation([ev('EV1', 0), ev('EV2', 100.5)])!.level).toBe('far');
    expect(pairSeparation([ev('EV1', 0), ev('EV2', 100)])!.level).toBe('separated');
  });

  it('takes a custom limit', () => {
    expect(pairSeparation([ev('EV1', 0), ev('EV2', 30)], 20)!.level).toBe('separated');
  });

  it('measures the farthest pair of three', () => {
    const r = pairSeparation([ev('EV1', 0), ev('EV2', 10), ev('EV3', 80)]);
    expect(r!.a).toBe('EV1');
    expect(r!.b).toBe('EV3');
    expect(r!.distanceM).toBeCloseTo(80, 6);
  });

  it('is null with fewer than two crew', () => {
    expect(pairSeparation([ev('EV1', 0)])).toBeNull();
    expect(pairSeparation([])).toBeNull();
  });
});

describe('hazardMarginM', () => {
  it('adds the position uncertainty to the base margin', () => {
    expect(HAZARD_MARGIN_DAY_M).toBe(10);
    expect(HAZARD_MARGIN_NIGHT_M).toBe(20);
    expect(hazardMarginM(2, 'day')).toBe(12);
    expect(hazardMarginM(62, 'day')).toBe(72);
    expect(hazardMarginM(62, 'night')).toBe(82);
  });

  it('never shrinks below the base for a bad uncertainty', () => {
    expect(hazardMarginM(-5, 'day')).toBe(10);
    expect(hazardMarginM(Number.NaN, 'night')).toBe(20);
  });
});
