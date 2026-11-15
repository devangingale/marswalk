// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  calculateMetabolicPower,
  standingMetabolicPower,
  walkingSpeed,
  evaluateStep,
  calculateRadiationDose,
  dwellEnergyKj,
  SANTEE_MIN_GRADE_PERCENT,
  MARS_GRAVITY,
  GRAVITY_RATIO,
  MARS_SOL_HOURS,
  DEFAULT_BODY_MASS_KG,
  DEFAULT_SUIT_MASS_KG,
} from './energy';

describe('Mars walking energy model (Pandolf 1977 + Santee et al. 2003 + Mars gravity scaling)', () => {
  const W = DEFAULT_BODY_MASS_KG; // 80 kg
  const L = DEFAULT_SUIT_MASS_KG; // 120 kg
  const V = 0.8; // m/s

  it('gravity scaling constant reflects Mars vs Earth gravity (3.71 / 9.80665)', () => {
    expect(MARS_GRAVITY).toBe(3.71);
    expect(GRAVITY_RATIO).toBeCloseTo(3.71 / 9.80665, 5);
  });

  it('standing power is 1.5 MET for the body mass (NASA MetRate conversion)', () => {
    // (0.961 + 0.275 * 0.85) * 3.5 ml/min/kg * 1.5 MET * 80 kg = 501.8 BTU/h = 147.06 W
    expect(standingMetabolicPower(W, L)).toBeCloseTo(147.0616, 3);
    expect(standingMetabolicPower(W)).toBeCloseTo(147.0616, 3);
    expect(standingMetabolicPower(60, L)).toBeCloseTo(110.2962, 3);
  });

  it('walking power is exact on flat ground, uphill and at the -8 % minimum', () => {
    expect(calculateMetabolicPower(W, L, 0.8, 0)).toBeCloseTo(458.517, 2);
    expect(calculateMetabolicPower(W, L, 0.6, 8.75)).toBeCloseTo(565.770, 2);
    expect(calculateMetabolicPower(W, L, 0.62, -8)).toBeCloseTo(390.767, 2);
  });

  it('holds descents steeper than the Santee data (-12 %) at the bound', () => {
    expect(SANTEE_MIN_GRADE_PERCENT).toBe(-12);
    const atBound = calculateMetabolicPower(W, L, 0.4, -12);
    expect(atBound).toBeCloseTo(445.853, 2);
    // 10 deg (-17.6 %) and 15 deg (-26.8 %) descents no longer blow up (it was 683 W and 1,420 W)
    expect(calculateMetabolicPower(W, L, 0.4, -17.63)).toBeCloseTo(atBound, 6);
    expect(calculateMetabolicPower(W, L, 0.2, -26.79)).toBeCloseTo(443.787, 2);
  });

  it('never drops below standing power while walking', () => {
    expect(calculateMetabolicPower(W, L, 0.05, -12)).toBeGreaterThanOrEqual(standingMetabolicPower(W) - 1e-9);
  });

  it('calculates higher power for uphill walking compared to level ground', () => {
    const levelPower = calculateMetabolicPower(W, L, V, 0.0, 1.0);
    const uphillPower = calculateMetabolicPower(W, L, V, 10.0, 1.0); // +10% grade

    expect(levelPower).toBeGreaterThan(0);
    expect(uphillPower).toBeGreaterThan(levelPower);
  });

  it('applies the Santee et al. 2003 (USARIEM TN03-3) downhill correction on descents', () => {
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
