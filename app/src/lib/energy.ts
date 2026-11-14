// Written with AI assistance, directed and reviewed by the team.

/**
 * Mars walking energy, speed, and radiation dose model.
 * Implements Contracts Section 10 (Budgets) and Section 7.
 *
 * CITATIONS:
 * 1. Pandolf Load-Carriage Equation:
 *    Pandolf, K. B., Givoni, B., & Goldman, R. F. (1977).
 *    "Predicting energy expenditure with loads while standing or walking very slowly to moderate walking speeds."
 *    Journal of Applied Physiology: Respiratory, Environmental and Exercise Physiology, 43(4), 577-581.
 *    DOI: 10.1152/jappl.1977.43.4.577
 *
 *    Base formula for metabolic power M (Watts) on level or uphill terrain:
 *    M = 1.5*W + 2.0*(W + L)*(L/W)^2 + eta*(W + L)*[1.5*V^2 + 0.35*V*G]
 *    where:
 *      W = body mass (kg)
 *      L = external load / suit mass (kg)
 *      V = walking velocity (m/s)
 *      G = grade (% slope, signed)
 *      eta = terrain factor multiplier
 *
 * 2. Downhill Correction Factor:
 *    Santee, W. R., Allison, W. F., Blanchard, L. A., & Small, M. G. (2001).
 *    "A proposed model for load carriage on sloped terrain."
 *    Aviation, Space, and Environmental Medicine, 72(6), 562-566.
 *
 *    For negative grade (G < 0), downhill metabolic expenditure follows a J-shaped curve
 *    (minimum around -6% to -8%, rising on steeper descents due to muscular braking).
 *    Total power: M_T = M_Pandolf - CF
 *    where CF = eta * [ (G*(W + L)*V)/3.5 - ((W + L)*(G + 6)^2)/W + (25 - V^2) ]
 *
 * 3. Gravity Scaling Simplification:
 *    Earth standard gravity g_earth = 9.80665 m/s^2; Mars surface gravity g_mars = 3.71 m/s^2.
 *    Gravity scaling ratio: r_g = g_mars / g_earth = 3.71 / 9.80665 ~ 0.3783.
 *    Simplification: We scale body mass W and suit mass L by r_g to obtain effective Martian
 *    weights (W_mars = W * r_g, L_mars = L * r_g). This preserves the biomechanical load ratio
 *    (L/W) while scaling the weight and gravitational work (m*g*h) down to Mars surface gravity.
 */

export const MARS_GRAVITY = 3.71; // m/s^2
export const EARTH_GRAVITY = 9.80665; // m/s^2
export const GRAVITY_RATIO = MARS_GRAVITY / EARTH_GRAVITY; // ~0.378314

export const DEFAULT_BODY_MASS_KG = 80.0;
export const DEFAULT_SUIT_MASS_KG = 120.0;
export const DEFAULT_FLAT_SPEED_MS = 0.8;
export const DEFAULT_MAX_SLOPE_DEG = 20.0;

export const DEFAULT_SURFACE_DOSE_MGY_PER_DAY = 0.21;
export const DEFAULT_SOLAR_EVENT_MGY_PER_DAY = 1.0;
export const MARS_SOL_HOURS = 24.66; // Martian sol length in hours

export interface EnergyModelParams {
  bodyMassKg?: number;
  suitMassKg?: number;
  vFlat?: number;
  maxSlopeDeg?: number;
}

/**
 * Calculates walking speed (m/s) as a function of slope angle in degrees.
 * Flat firm ground speed is 0.8 m/s by default, reduced with slope.
 * Returns 0 m/s for slopes at or exceeding maxSlopeDeg.
 */
export function walkingSpeed(
  slopeDeg: number,
  maxSlopeDeg: number = DEFAULT_MAX_SLOPE_DEG,
  vFlat: number = DEFAULT_FLAT_SPEED_MS
): number {
  const absSlope = Math.abs(slopeDeg);
  if (absSlope >= maxSlopeDeg) {
    return 0.0;
  }
  // Reduce speed smoothly with slope; astronaut retains at least 0.1 m/s until cutoff
  const slopeRatio = absSlope / maxSlopeDeg;
  const factor = Math.max(0.1, 1.0 - slopeRatio);
  return vFlat * factor;
}

/**
 * Calculates metabolic power (Watts = Joules/second) using the Pandolf equation
 * with Santee downhill correction and Mars gravity scaling.
 *
 * @param W Body mass (kg) on Earth
 * @param L Suit mass (kg) on Earth
 * @param V Walking speed (m/s)
 * @param G Grade in percent (signed: positive for uphill, negative for downhill)
 * @param eta Terrain multiplier (>= 1.0, e.g. 1 + cost/50)
 */
export function calculateMetabolicPower(
  W: number,
  L: number,
  V: number,
  G: number,
  eta: number = 1.0
): number {
  if (W <= 0) throw new Error('Body mass must be greater than zero.');
  if (L < 0) throw new Error('Suit mass cannot be negative.');
  if (V <= 0) {
    return standingMetabolicPower(W, L);
  }

  // Scale masses to Mars surface gravity
  const W_mars = W * GRAVITY_RATIO;
  const L_mars = L * GRAVITY_RATIO;
  const totalMass = W_mars + L_mars;
  const loadRatio = L / W; // Invariant under uniform gravity scaling

  // Base Pandolf formula (Watts)
  const standingTerm = 1.5 * W_mars;
  const loadCarriageTerm = 2.0 * totalMass * (loadRatio * loadRatio);
  const dynamicTerm = eta * totalMass * (1.5 * V * V + 0.35 * V * G);

  const basePower = standingTerm + loadCarriageTerm + dynamicTerm;

  // Level or uphill (G >= 0): standard Pandolf
  if (G >= 0) {
    return Math.max(standingTerm, basePower);
  }

  // Downhill (G < 0): apply Santee et al. (2001) correction factor
  // CF = eta * [ (G*(W + L)*V)/3.5 - ((W + L)*(G + 6)^2)/W + (25 - V^2) ]
  const cfTerm1 = (G * totalMass * V) / 3.5;
  const cfTerm2 = (totalMass * Math.pow(G + 6.0, 2)) / W_mars;
  const cfTerm3 = 25.0 - V * V;
  const correctionFactor = eta * (cfTerm1 - cfTerm2 + cfTerm3);

  const correctedPower = basePower - correctionFactor;

  // Never drop below resting/standing power
  return Math.max(standingTerm, correctedPower);
}

/**
 * Standing metabolic power (Watts) with suit on Mars.
 */
export function standingMetabolicPower(W: number, L: number): number {
  const W_mars = W * GRAVITY_RATIO;
  const L_mars = L * GRAVITY_RATIO;
  const totalMass = W_mars + L_mars;
  const loadRatio = L / W;
  return 1.5 * W_mars + 2.0 * totalMass * (loadRatio * loadRatio);
}

/**
 * Calculates energy expenditure in kilojoules (kJ) during stationary dwell at a stop.
 */
export function dwellEnergyKj(
  dwellS: number,
  bodyMassKg: number = DEFAULT_BODY_MASS_KG,
  suitMassKg: number = DEFAULT_SUIT_MASS_KG
): number {
  if (dwellS <= 0) return 0.0;
  const powerW = standingMetabolicPower(bodyMassKg, suitMassKg);
  return (powerW * dwellS) / 1000.0;
}

export interface StepEvaluation {
  horizontalDistM: number;
  dzM: number;
  distance3dM: number;
  slopeDeg: number;
  gradePercent: number;
  speedMs: number;
  timeS: number;
  energyKj: number;
  passable: boolean;
}

/**
 * Evaluates a single movement step between two cell locations.
 */
export function evaluateStep(
  horizontalDistM: number,
  dzM: number,
  terrainMultiplier: number,
  params?: EnergyModelParams
): StepEvaluation {
  const bodyMass = params?.bodyMassKg ?? DEFAULT_BODY_MASS_KG;
  const suitMass = params?.suitMassKg ?? DEFAULT_SUIT_MASS_KG;
  const vFlat = params?.vFlat ?? DEFAULT_FLAT_SPEED_MS;
  const maxSlope = params?.maxSlopeDeg ?? DEFAULT_MAX_SLOPE_DEG;

  const distance3dM = Math.hypot(horizontalDistM, dzM);
  const slopeRad = Math.atan2(Math.abs(dzM), horizontalDistM);
  const slopeDeg = (slopeRad * 180.0) / Math.PI;

  if (slopeDeg >= maxSlope || !Number.isFinite(terrainMultiplier) || terrainMultiplier <= 0) {
    return {
      horizontalDistM,
      dzM,
      distance3dM,
      slopeDeg,
      gradePercent: (dzM / horizontalDistM) * 100.0,
      speedMs: 0.0,
      timeS: Infinity,
      energyKj: Infinity,
      passable: false,
    };
  }

  const speedMs = walkingSpeed(slopeDeg, maxSlope, vFlat);
  const timeS = distance3dM / speedMs;
  const gradePercent = (dzM / horizontalDistM) * 100.0;

  const powerW = calculateMetabolicPower(bodyMass, suitMass, speedMs, gradePercent, terrainMultiplier);
  const energyKj = (powerW * timeS) / 1000.0;

  return {
    horizontalDistM,
    dzM,
    distance3dM,
    slopeDeg,
    gradePercent,
    speedMs,
    timeS,
    energyKj,
    passable: true,
  };
}

/**
 * Calculates radiation dose in milligray (mGy).
 * Dose = surface_dose_mgy_per_day * walk_hours / 24.66
 * If solarEvent is true, solar_event_mgy_per_day replaces the surface rate.
 */
export function calculateRadiationDose(
  walkDurationSeconds: number,
  solarEvent: boolean,
  surfaceDoseRate: number = DEFAULT_SURFACE_DOSE_MGY_PER_DAY,
  solarEventRate: number = DEFAULT_SOLAR_EVENT_MGY_PER_DAY
): number {
  if (walkDurationSeconds <= 0) return 0.0;
  const walkHours = walkDurationSeconds / 3600.0;
  const rate = solarEvent ? solarEventRate : surfaceDoseRate;
  const dose = (rate * walkHours) / MARS_SOL_HOURS;
  return dose;
}
