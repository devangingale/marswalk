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
 *    Santee, W. R., Blanchard, L. A., Speckman, K. L., Gonzalez, J. A., & Wallace, R. F. (2003).
 *    "Load carriage model development and testing with field data."
 *    USARIEM Technical Note TN03-3 (DTIC ADA415788); form restated in Potter et al. (2013),
 *    Journal of Sport and Human Performance, 1(3), 34-42, doi:10.12922/jshp.0009.2013.
 *    The operator before V^2 in Potter et al.'s review PDF is unverified.
 *
 *    For negative grade (G < 0), downhill metabolic expenditure follows a J-shaped curve
 *    (minimum around -6% to -8%, rising on steeper descents due to muscular braking).
 *    Total power: M_T = M_Pandolf - CF
 *    where CF = eta * [ (G*(W + L)*V)/3.5 - ((W + L)*(G + 6)^2)/W + (25 - V^2) ]
 *    The implementation uses Mars-scaled masses: its first CF term is scaled by GRAVITY_RATIO;
 *    that factor cancels from the second term because both its numerator and denominator are scaled.
 *    Santee et al. fitted grades from -12 % to +12 % (docs/research/eva-limits.md row 5). Beyond
 *    -12 % the (G + 6)^2 term grows without bound (1,420 W at a 15 deg descent), so downhill grades
 *    are held at SANTEE_MIN_GRADE_PERCENT for both Pandolf and the correction. Steeper descents still
 *    cost more per metre because walking speed falls with slope.
 *
 * 3. Gravity Scaling Simplification:
 *    Earth standard gravity g_earth = 9.80665 m/s^2; Mars surface gravity g_mars = 3.71 m/s^2.
 *    Gravity scaling ratio: r_g = g_mars / g_earth = 3.71 / 9.80665 ~ 0.3783.
 *    Simplification: We scale body mass W and suit mass L by r_g to obtain effective Martian
 *    weights (W_mars = W * r_g, L_mars = L * r_g). This preserves the biomechanical load ratio
 *    (L/W) while scaling the weight and gravitational work (m*g*h) down to Mars surface gravity.
 *
 * 4. Standing and stop power:
 *    Pandolf's standing terms treat the suit as a carried load; with a 120 kg suit on an 80 kg body
 *    (L/W = 1.5) they give about 386 W while standing still, far above rest. Standing and dwell use
 *    1.5 MET instead, converted with the NASA suit team's equation
 *    MetRate(BTU/h) = (0.961 + 0.275*RER) * VO2(ml/min/kg) * mass(kg)
 *    (Ogilvie et al., Mars Spacesuit Mass Requirements, ICES-2026-127, NTRS 20260005410; research row 22),
 *    with 1 MET = 3.5 ml/min/kg and RER 0.85: about 147 W for 80 kg. It is also the floor for walking.
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

/** Lowest grade in the Santee et al. data (percent); steeper descents are held here. */
export const SANTEE_MIN_GRADE_PERCENT = -12;
/** Standing in a suit, in metabolic equivalents (1 MET = 3.5 ml O2 per minute per kg). */
export const STANDING_MET = 1.5;
const ML_O2_PER_MIN_PER_KG_PER_MET = 3.5;
const RESPIRATORY_EXCHANGE_RATIO = 0.85;
const WATTS_PER_BTU_PER_HOUR = 0.29307107;

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
 * with the Santee et al. (2003, USARIEM TN03-3) downhill correction and Mars gravity scaling.
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

  // Santee et al. fitted -12 % to +12 %; hold steeper descents at the bound.
  const grade = Math.max(G, SANTEE_MIN_GRADE_PERCENT);
  const floor = standingMetabolicPower(W, L);

  // Base Pandolf formula (Watts)
  const standingTerm = 1.5 * W_mars;
  const loadCarriageTerm = 2.0 * totalMass * (loadRatio * loadRatio);
  const dynamicTerm = eta * totalMass * (1.5 * V * V + 0.35 * V * grade);

  const basePower = standingTerm + loadCarriageTerm + dynamicTerm;

  // Level or uphill (G >= 0): standard Pandolf
  if (grade >= 0) {
    return Math.max(floor, basePower);
  }

  // Downhill (G < 0): apply Santee et al. (2003, USARIEM TN03-3) correction factor
  // CF = eta * [ (G*(W + L)*V)/3.5 - ((W + L)*(G + 6)^2)/W + (25 - V^2) ]
  const cfTerm1 = (grade * totalMass * V) / 3.5;
  const cfTerm2 = (totalMass * Math.pow(grade + 6.0, 2)) / W_mars;
  const cfTerm3 = 25.0 - V * V;
  const correctionFactor = eta * (cfTerm1 - cfTerm2 + cfTerm3);

  const correctedPower = basePower - correctionFactor;

  // Never drop below standing power
  return Math.max(floor, correctedPower);
}

/**
 * Standing metabolic power (Watts) in a suit: STANDING_MET for the body mass, converted with the
 * NASA suit team's MetRate equation. The suit mass does not change oxygen use while standing.
 */
export function standingMetabolicPower(W: number, _suitMassKg?: number): number {
  const btuPerHour =
    (0.961 + 0.275 * RESPIRATORY_EXCHANGE_RATIO) * ML_O2_PER_MIN_PER_KG_PER_MET * STANDING_MET * W;
  return btuPerHour * WATTS_PER_BTU_PER_HOUR;
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
