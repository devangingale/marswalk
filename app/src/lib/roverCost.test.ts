// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  CREW_ROVER,
  SCIENCE_ROVER,
  RoverLimits,
  roverCostMultiplier,
  roverDriveTimeS,
  roverSols,
} from './roverCost';

describe('RoverLimits profile values (sourced in roverCost.ts comments)', () => {
  it('SCIENCE_ROVER carries the confirmed robotic figures', () => {
    expect(SCIENCE_ROVER.planSlopeDeg).toBe(20);
    expect(SCIENCE_ROVER.maxTiltDeg).toBe(25);
    expect(SCIENCE_ROVER.rockHazardM).toBe(0.25);
    expect(SCIENCE_ROVER.typicalSolDriveM).toBe(130);
    expect(SCIENCE_ROVER.speedMS).toBeCloseTo(91.83 / 3600, 10);
  });

  it('CREW_ROVER carries the crewed-rover concept figures', () => {
    expect(CREW_ROVER.planSlopeDeg).toBe(15);
    expect(CREW_ROVER.maxTiltDeg).toBe(20);
    expect(CREW_ROVER.rockHazardM).toBe(0.3);
    expect(CREW_ROVER.typicalSolDriveM).toBe(26000);
    expect(CREW_ROVER.speedMS).toBeCloseTo(15000 / 3600, 10);
  });

  it('the crew rover is faster than the science rover', () => {
    expect(CREW_ROVER.speedMS).toBeGreaterThan(SCIENCE_ROVER.speedMS);
  });
});

describe('roverCostMultiplier edge behaviour', () => {
  it('flat smooth ground costs exactly 1 for both profiles', () => {
    expect(roverCostMultiplier(0, 0)).toBe(1); // default (crew)
    expect(roverCostMultiplier(0, 0, CREW_ROVER)).toBe(1);
    expect(roverCostMultiplier(0, 0, SCIENCE_ROVER)).toBe(1);
  });

  it('defaults to CREW_ROVER limits', () => {
    // 21 deg is impassable for the crew rover (cap 20) but fine for the
    // science rover (cap 25): this pins the default profile to CREW_ROVER.
    expect(roverCostMultiplier(21, 0)).toBeNull();
    expect(roverCostMultiplier(21, 0, SCIENCE_ROVER)).not.toBeNull();
  });

  describe('SCIENCE_ROVER', () => {
    it('slope exactly at maxTiltDeg passes, just above returns null', () => {
      expect(roverCostMultiplier(25, 0, SCIENCE_ROVER)).toBe(8);
      expect(roverCostMultiplier(25.0001, 0, SCIENCE_ROVER)).toBeNull();
    });

    it('roughness just below rockHazardM passes, at it returns null', () => {
      expect(roverCostMultiplier(0, 0.24, SCIENCE_ROVER)).not.toBeNull();
      expect(roverCostMultiplier(0, 0.24, SCIENCE_ROVER)).toBeCloseTo(3.88, 10);
      expect(roverCostMultiplier(0, SCIENCE_ROVER.rockHazardM, SCIENCE_ROVER)).toBeNull();
    });

    it('rises on the linear ramp between planSlopeDeg and maxTiltDeg', () => {
      // midpoint 22.5 deg -> halfway up the 1..8 ramp = 4.5
      expect(roverCostMultiplier(22.5, 0, SCIENCE_ROVER)).toBe(4.5);
      // half the hazard roughness -> halfway up the 1..4 ramp = 2.5
      expect(roverCostMultiplier(0, 0.125, SCIENCE_ROVER)).toBe(2.5);
    });
  });

  describe('CREW_ROVER', () => {
    it('slope exactly at maxTiltDeg passes, just above returns null', () => {
      expect(roverCostMultiplier(20, 0, CREW_ROVER)).toBe(8);
      expect(roverCostMultiplier(20.0001, 0, CREW_ROVER)).toBeNull();
    });

    it('roughness just below rockHazardM passes, at it returns null', () => {
      expect(roverCostMultiplier(0, 0.29, CREW_ROVER)).not.toBeNull();
      expect(roverCostMultiplier(0, CREW_ROVER.rockHazardM, CREW_ROVER)).toBeNull();
    });

    it('rises on the linear ramp between planSlopeDeg and maxTiltDeg', () => {
      // midpoint 17.5 deg -> halfway up the 1..8 ramp = 4.5
      expect(roverCostMultiplier(17.5, 0, CREW_ROVER)).toBe(4.5);
      // half the hazard roughness -> halfway up the 1..4 ramp = 2.5
      expect(roverCostMultiplier(0, 0.15, CREW_ROVER)).toBeCloseTo(2.5, 10);
    });

    it('treats descent tilt the same as climb tilt (magnitude)', () => {
      expect(roverCostMultiplier(-20, 0, CREW_ROVER)).toBe(8);
      expect(roverCostMultiplier(-20.0001, 0, CREW_ROVER)).toBeNull();
    });
  });
});

describe('roverDriveTimeS', () => {
  it('uses the crew rover by default: 920 m at 15 km/h = 220.8 s', () => {
    expect(roverDriveTimeS(920)).toBeCloseTo(220.8, 6);
    expect(roverDriveTimeS(920, CREW_ROVER)).toBe(roverDriveTimeS(920));
  });

  it('the science rover is much slower over the same distance', () => {
    expect(roverDriveTimeS(920, SCIENCE_ROVER)).toBeGreaterThan(roverDriveTimeS(920));
  });

  it('returns 0 for a non-positive distance', () => {
    expect(roverDriveTimeS(0)).toBe(0);
    expect(roverDriveTimeS(-5)).toBe(0);
  });
});

describe('roverSols', () => {
  it('uses the crew rover by default: 400 m fits in a single sol', () => {
    expect(roverSols(400)).toBe(1);
  });

  it('the science rover needs 4 sols for 400 m (ceil 400 / 130)', () => {
    expect(roverSols(400, SCIENCE_ROVER)).toBe(4);
  });

  it('returns 0 for a non-positive distance', () => {
    expect(roverSols(0)).toBe(0);
  });

  it('accepts a custom RoverLimits object', () => {
    const custom: RoverLimits = {
      planSlopeDeg: 10,
      maxTiltDeg: 15,
      rockHazardM: 0.2,
      speedMS: 1,
      typicalSolDriveM: 100,
    };
    expect(roverSols(250, custom)).toBe(3); // ceil(250 / 100)
    expect(roverDriveTimeS(250, custom)).toBe(250);
  });
});
