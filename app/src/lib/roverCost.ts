// Written with AI assistance, directed and reviewed by the team.

/**
 * Rover mobility cost model for Marswalk route planning.
 *
 * Two rover profiles share one `RoverLimits` shape:
 *   - CREW_ROVER   : the pressurised, crewed rover the crew actually drives.
 *                    This is the DEFAULT for every function here, because the
 *                    app plans crew drives. Most published figures for a
 *                    pressurised crewed rover are lunar concepts, so each value
 *                    is labelled "lunar concept" or "assumption".
 *   - SCIENCE_ROVER: a robotic science rover (Curiosity / Perseverance class).
 *                    A secondary profile only. Never use these values for the
 *                    crew rover.
 *
 * Sources:
 *   rover-mobility.md      (docs/research, origin/dev/research-mission)
 *   positioning-hardware.md (docs/research, origin/dev/research-mission)
 * Status marks ("confirmed" / "secondary" / "notional" / "assumption") are the
 * ones recorded in those research tables.
 *
 * NOTE ON planner.ts: findPath() is intentionally NOT modified to route rovers.
 * Its accumulated path cost is walker metabolic energy (kJ) from evaluateStep(),
 * its A* heuristic is scaled to that energy (MIN_ENERGY_PER_METRE_KJ), and every
 * PathStepDetail field (energyKj, timeS, slopeDeg) is defined by the walker
 * energy model. A rover cost multiplier has different units and no energy/time
 * meaning in that frame, so injecting it would change walker routing behaviour
 * and produce meaningless result fields. roverCostMultiplier is therefore a
 * standalone heuristic for a future rover-specific planner, not a drop-in cost
 * function for the walker findPath().
 */

export interface RoverLimits {
  /** Plan routes at or below this tilt (deg); cost is nominal up to here. */
  planSlopeDeg: number;
  /** Hard tilt cap (deg); steeper than this is impassable (null). */
  maxTiltDeg: number;
  /** Obstacle/roughness height (m) at or above which terrain is impassable. */
  rockHazardM: number;
  /** Effective drive speed (m/s) used for drive-time estimates. */
  speedMS: number;
  /** Typical distance driven in one sol (m), used for the sol count. */
  typicalSolDriveM: number;
}

/**
 * Pressurised crewed rover — the default profile (the app plans crew drives).
 * Mars has no flown crewed-rover specs; values are drawn from published
 * crewed-rover concepts (chiefly the JAXA/Toyota pressurised "Lunar Cruiser")
 * and are labelled lunar-concept or assumption.
 */
export const CREW_ROVER: RoverLimits = {
  // Assumption: plan crew drives below the rated slope for tip-over margin.
  // No published Mars crewed-rover route-planning tilt limit exists; the
  // nearest analogue is the EVA "within 2 km" safe-return doctrine
  // (positioning-hardware.md #8, confirmed), not a slope number.
  planSlopeDeg: 15,
  // JAXA/Toyota pressurised rover rated slope ±20° (lunar concept, notional).
  // positioning-hardware.md T7 / rover-mobility.md row 31.
  maxTiltDeg: 20,
  // JAXA/Toyota rated obstacle clearance 30 cm on flat ground (7 cm at 20°).
  // Lunar concept, notional. positioning-hardware.md T7.
  rockHazardM: 0.3,
  // JAXA/Toyota rated max speed 15 km/h = 15000/3600 m/s (lunar concept,
  // notional). positioning-hardware.md T7.
  speedMS: 15000 / 3600,
  // JAXA/Toyota crewed driving 26 km/sol (lunar concept, notional); consistent
  // with NASA small pressurised rover ">= 200 km over 1-2 weeks" (EZ-sizing
  // assumption, positioning-hardware.md T5). rover-mobility.md row 31 / T7.
  typicalSolDriveM: 26000,
};

/**
 * Robotic science rover (Curiosity / Perseverance class) — secondary profile.
 * All values from rover-mobility.md and are confirmed primary-source figures.
 */
export const SCIENCE_ROVER: RoverLimits = {
  // Perseverance AutoNav planning tilt limit raised to 20° on sol 1124
  // (Verma et al., IEEE Aerospace 2025). rover-mobility.md row 13, confirmed.
  planSlopeDeg: 20,
  // Perseverance reactive tilt fault limit, held at 25° (Verma et al. 2025).
  // rover-mobility.md row 14, confirmed. (Curiosity nominal cap is 30°, row 1.)
  maxTiltDeg: 25,
  // A rock taller than the wheel radius (25 cm) can wedge between Curiosity's
  // wheels (Rankin et al., J. Field Robotics 2021). rover-mobility.md row 4,
  // confirmed. (Perseverance can drive over rocks up to 40 cm, row 11.)
  rockHazardM: 0.25,
  // Perseverance effective full-autonomy (AVOIDALL) rate 91.83 m/h = 91.83/3600
  // m/s (Verma et al. 2025, Table 1). rover-mobility.md row 17, confirmed.
  speedMS: 91.83 / 3600,
  // Mean of 143 Perseverance AutoNav drives, 129.59 m/sol, rounded to 130
  // (Verma et al. 2025). rover-mobility.md row 19, confirmed.
  typicalSolDriveM: 130,
};

/**
 * Planning heuristic (not a measured cost). Shape:
 *   - Flat, smooth ground returns exactly 1.
 *   - Below planSlopeDeg the slope term is 1; from planSlopeDeg to maxTiltDeg it
 *     rises on a linear ramp to SLOPE_COST_AT_MAX at the cap.
 *   - Roughness term rises on a linear ramp from 1 (smooth) toward
 *     ROUGHNESS_COST_AT_HAZARD as height approaches rockHazardM.
 *   - The two terms multiply, so flat+smooth = 1.
 * The ramp top values are editable planning weights, not sourced measurements.
 */
const SLOPE_COST_AT_MAX = 8;
const ROUGHNESS_COST_AT_HAZARD = 4;

/**
 * Relative driving cost for a cell, or null when the cell is impassable.
 * Impassable when |slope| exceeds maxTiltDeg or roughness is at/above
 * rockHazardM. Returns 1 on flat smooth ground and rises smoothly toward the
 * limits. Slope is taken as magnitude (uphill and downhill treated alike for
 * tilt). Defaults to CREW_ROVER. This is a planning heuristic, not a measured
 * energy or time cost.
 */
export function roverCostMultiplier(
  slopeDeg: number,
  roughnessM: number,
  limits: RoverLimits = CREW_ROVER
): number | null {
  const absSlope = Math.abs(slopeDeg);
  if (absSlope > limits.maxTiltDeg) return null;
  if (roughnessM >= limits.rockHazardM) return null;

  let slopeTerm = 1;
  if (absSlope > limits.planSlopeDeg) {
    const span = limits.maxTiltDeg - limits.planSlopeDeg;
    const frac = span > 0 ? (absSlope - limits.planSlopeDeg) / span : 1;
    slopeTerm = 1 + frac * (SLOPE_COST_AT_MAX - 1);
  }

  const roughFrac = roughnessM > 0 ? roughnessM / limits.rockHazardM : 0;
  const roughnessTerm = 1 + roughFrac * (ROUGHNESS_COST_AT_HAZARD - 1);

  return slopeTerm * roughnessTerm;
}

/**
 * Estimated driving time in seconds for a distance, at the profile's effective
 * speed. Defaults to CREW_ROVER. Non-positive distance returns 0.
 */
export function roverDriveTimeS(distanceM: number, limits: RoverLimits = CREW_ROVER): number {
  if (distanceM <= 0) return 0;
  return distanceM / limits.speedMS;
}

/**
 * Number of sols to cover a distance, as the ceiling of distance divided by the
 * profile's typical per-sol drive. Defaults to CREW_ROVER. Non-positive
 * distance returns 0.
 */
export function roverSols(distanceM: number, limits: RoverLimits = CREW_ROVER): number {
  if (distanceM <= 0) return 0;
  return Math.ceil(distanceM / limits.typicalSolDriveM);
}
