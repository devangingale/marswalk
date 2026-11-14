// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  calculateMetabolicPower,
  standingMetabolicPower,
  walkingSpeed,
  evaluateStep,
  calculateRadiationDose,
  dwellEnergyKj,
  MARS_GRAVITY,
  GRAVITY_RATIO,
  MARS_SOL_HOURS,
  DEFAULT_BODY_MASS_KG,
  DEFAULT_SUIT_MASS_KG,
} from './energy';

describe('Mars walking energy model (Pandolf-Santee + Mars gravity scaling)', () => {
  const W = DEFAULT_BODY_MASS_KG; // 80 kg
  const L = DEFAULT_SUIT_MASS_KG; // 120 kg
  const V = 0.8; // m/s

  it('gravity scaling constant reflects Mars vs Earth gravity (3.71 / 9.80665)', () => {
    expect(MARS_GRAVITY).toBe(3.71);
    expect(GRAVITY_RATIO).toBeCloseTo(3.71 / 9.80665, 5);
  });

  it('computes positive standing power on Mars with suited astronaut', () => {
    const pStanding = standingMetabolicPower(W, L);
    expect(pStanding).toBeGreaterThan(0);
    // Effective Mars total mass = 200 * 0.3783 ~ 75.66 kg
    // Standing power ~ 385 W
    expect(pStanding).toBeGreaterThan(300);
    expect(pStanding).toBeLessThan(500);
  });

  it('calculates higher power for uphill walking compared to level ground', () => {
    const levelPower = calculateMetabolicPower(W, L, V, 0.0, 1.0);
    const uphillPower = calculateMetabolicPower(W, L, V, 10.0, 1.0); // +10% grade

    expect(levelPower).toBeGreaterThan(0);
    expect(uphillPower).toBeGreaterThan(levelPower);
  });

  it('applies Santee downhill correction on descents', () => {
    const levelPower = calculateMetabolicPower(W, L, V, 0.0, 1.0);
    const shallowDownhillPower = calculateMetabolicPower(W, L, V, -6.0, 1.0); // -6% grade (optimum descent)
    const steepDownhillPower = calculateMetabolicPower(W, L, V, -20.0, 1.0); // -20% grade (requires braking)

    // Shallow descent requires less metabolic energy than level walking
    expect(shallowDownhillPower).toBeLessThan(levelPower);

    // Steep descent triggers muscular braking and stability cost (J-curve), thus higher than shallow descent
    expect(steepDownhillPower).toBeGreaterThan(shallowDownhillPower);
  });

  it('terrain multiplier increases dynamic power expenditure', () => {
    const smoothPower = calculateMetabolicPower(W, L, V, 5.0, 1.0);
    const roughPower = calculateMetabolicPower(W, L, V, 5.0, 2.5); // multiplier 2.5

    expect(roughPower).toBeGreaterThan(smoothPower);
  });

  it('reduces walking speed with slope and cuts off at max slope', () => {
    const vFlat = walkingSpeed(0, 20, 0.8);
    expect(vFlat).toBeCloseTo(0.8, 4);

    const v10Deg = walkingSpeed(10, 20, 0.8);
    expect(v10Deg).toBeLessThan(0.8);
    expect(v10Deg).toBeGreaterThan(0.2);

    const v20Deg = walkingSpeed(20, 20, 0.8);
    expect(v20Deg).toBe(0.0);

    const vSteep = walkingSpeed(25, 20, 0.8);
    expect(vSteep).toBe(0.0);
  });

  it('evaluateStep returns impassable when slope exceeds max_slope_deg', () => {
    // 2m horizontal, 2m vertical -> slope = 45 deg > 20 deg
    const step = evaluateStep(2.0, 2.0, 1.0, { maxSlopeDeg: 20 });
    expect(step.passable).toBe(false);
    expect(step.speedMs).toBe(0.0);
    expect(step.energyKj).toBe(Infinity);
  });

  it('dwellEnergyKj scales with dwell time and body+suit load', () => {
    const dwell1200 = dwellEnergyKj(1200, W, L);
    const dwell600 = dwellEnergyKj(600, W, L);

    expect(dwell1200).toBeGreaterThan(0);
    expect(dwell1200).toBeCloseTo(dwell600 * 2, 2);
  });

  it('calculates radiation dose with Mars sol length 24.66 hours and solar event swap', () => {
    const fullSolSeconds = MARS_SOL_HOURS * 3600;

    // Over 1 full sol, nominal surface dose = 0.21 mGy
    const nominalDose = calculateRadiationDose(fullSolSeconds, false, 0.21, 1.0);
    expect(nominalDose).toBeCloseTo(0.21, 4);

    // Over 1 full sol with solar event, dose = 1.0 mGy
    const solarDose = calculateRadiationDose(fullSolSeconds, true, 0.21, 1.0);
    expect(solarDose).toBeCloseTo(1.0, 4);

    // For an 8-hour walk (28800 s):
    const eightHourDose = calculateRadiationDose(28800, false, 0.21, 1.0);
    // (0.21 * 8) / 24.66 ~ 0.0681 mGy
    expect(eightHourDose).toBeCloseTo((0.21 * 8) / 24.66, 4);
  });
});
