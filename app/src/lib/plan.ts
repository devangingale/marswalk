// Written with AI assistance, directed and reviewed by the team.

/**
 * Plan builder and schema validation for Marswalk.
 * Implements Contracts Section 7 (plan.json) and Section 10 (Budgets).
 *
 * Constructs the plan.json object:
 * - per-leg distance/time/climb/descent/energy/max_slope
 * - totals, radiation dose
 * - densified line (no two points > 4 m apart)
 * - turn_back point: last point from which walking home still fits the binding limit (time or energy) with 15% reserve
 * - route feasibility and warnings
 */

import { GridOrigin, lonlatToLocalMetres, localMetresToLonLat, RouteGrid } from './grid';
import {
  calculateRadiationDose,
  dwellEnergyKj,
  evaluateStep,
  DEFAULT_SURFACE_DOSE_MGY_PER_DAY,
  DEFAULT_SOLAR_EVENT_MGY_PER_DAY,
} from './energy';
import { findPath, LegPathResult, PathStepDetail } from './planner';

export interface PlanParams {
  crew: number;
  time_limit_s: number;
  energy_limit_kj?: number;
  suit_mass_kg: number;
  body_mass_kg: number;
  stop_time_s: number;
  solar_event: boolean;
}

export interface PlanStart {
  lon: number;
  lat: number;
  label: string;
}

export interface PlanStop {
  id: string;
  name: string;
  lon: number;
  lat: number;
  note?: string;
  dwell_s?: number;
}

export interface PlanLeg {
  from: string;
  to: string;
  line: [number, number][]; // [lon, lat] pairs, densified <= 4m
  distance_m: number;
  time_s: number;
  climb_m: number;
  descent_m: number;
  energy_kj: number;
  max_slope_deg: number;
}

export interface PlanTotals {
  distance_m: number;
  time_s: number;
  climb_m: number;
  descent_m: number;
  energy_kj: number;
  dose_mgy: number;
}

export interface PlanTurnBack {
  leg: number;
  lon: number;
  lat: number;
  reason: 'time' | 'energy';
}

export interface PlanRoute {
  legs: PlanLeg[];
  returns_to_start: boolean;
  totals: PlanTotals;
  turn_back: PlanTurnBack | null;
  feasible: boolean;
  warnings: string[];
}

export interface Plan {
  version: 1;
  site: string;
  params: PlanParams;
  start: PlanStart;
  stops: PlanStop[];
  route: PlanRoute;
}

export interface BuildPlanInput {
  site?: string;
  grid: RouteGrid;
  params: PlanParams;
  start: PlanStart;
  stops: PlanStop[];
  surfaceDoseRate?: number;
  solarEventRate?: number;
}

/**
 * Densifies a polyline of [lon, lat] coordinates so that no two consecutive
 * points are separated by more than maxSpacingM (default 4.0 m) in ground metres.
 */
export function densifyLine(
  line: [number, number][],
  origin: GridOrigin,
  maxSpacingM: number = 4.0
): [number, number][] {
  if (line.length <= 1) return [...line];

  const result: [number, number][] = [line[0]];
  // Use a conservative target spacing (e.g. 3.8 m) so coordinate rounding (to 7 decimals)
  // never causes any segment to exceed maxSpacingM (4.0 m).
  const targetSpacing = Math.min(maxSpacingM - 0.2, 3.8);

  for (let i = 0; i < line.length - 1; i++) {
    const p1 = line[i];
    const p2 = line[i + 1];

    const m1 = lonlatToLocalMetres(p1[0], p1[1], origin);
    const m2 = lonlatToLocalMetres(p2[0], p2[1], origin);

    const distM = Math.hypot(m2.x_m - m1.x_m, m2.y_m - m1.y_m);

    if (distM > maxSpacingM) {
      const segments = Math.ceil(distM / targetSpacing);
      for (let s = 1; s < segments; s++) {
        const frac = s / segments;
        const x_m = m1.x_m + frac * (m2.x_m - m1.x_m);
        const y_m = m1.y_m + frac * (m2.y_m - m1.y_m);
        const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);
        result.push([roundCoord(lon), roundCoord(lat)]);
      }
    }

    result.push([roundCoord(p2[0]), roundCoord(p2[1])]);
  }

  return result;
}

function roundCoord(val: number): number {
  return Math.round(val * 1e7) / 1e7;
}

function roundDose(val: number): number {
  return Number(val.toFixed(3));
}

interface StepWithContext {
  legIndex: number;
  stepIndex: number;
  step: PathStepDetail;
  row: number;
  col: number;
  lon: number;
  lat: number;
  cumElapsedWalkTimeS: number;
  cumElapsedWalkEnergyKj: number;
  cumElapsedDwellTimeS: number;
  cumElapsedDwellEnergyKj: number;
}

/**
 * Computes the turn-back point along the route:
 * The last point from which walking home still fits the binding limit (time or energy)
 * with a 15% reserve (effective budget = 85% of limit).
 */
export function computeTurnBack(
  legs: LegPathResult[],
  stops: PlanStop[],
  params: PlanParams,
  grid: RouteGrid
): PlanTurnBack | null {
  const RESERVE_FRACTION = 0.15;
  const EFFECTIVE_BUDGET = 1.0 - RESERVE_FRACTION; // 0.85

  const timeLimitS = params.time_limit_s * EFFECTIVE_BUDGET;
  const energyLimitKj = params.energy_limit_kj ? params.energy_limit_kj * EFFECTIVE_BUDGET : Infinity;

  const allSteps: StepWithContext[] = [];
  let cumWalkTime = 0;
  let cumWalkEnergy = 0;
  let cumDwellTime = 0;
  let cumDwellEnergy = 0;

  for (let l = 0; l < legs.length; l++) {
    const leg = legs[l];
    for (let s = 0; s < leg.steps.length; s++) {
      const step = leg.steps[s];
      cumWalkTime += step.timeS;
      cumWalkEnergy += step.energyKj;

      allSteps.push({
        legIndex: l,
        stepIndex: s,
        step,
        row: step.row,
        col: step.col,
        lon: step.lon,
        lat: step.lat,
        cumElapsedWalkTimeS: cumWalkTime,
        cumElapsedWalkEnergyKj: cumWalkEnergy,
        cumElapsedDwellTimeS: cumDwellTime,
        cumElapsedDwellEnergyKj: cumDwellEnergy,
      });
    }

    if (l < stops.length) {
      const dwellS = stops[l].dwell_s ?? params.stop_time_s;
      cumDwellTime += dwellS;
      cumDwellEnergy += dwellEnergyKj(dwellS, params.body_mass_kg, params.suit_mass_kg);
    }
  }

  if (allSteps.length === 0) return null;

  const diag_m = Math.hypot(grid.cell_x_m, grid.cell_y_m);
  const energyModelParams = {
    bodyMassKg: params.body_mass_kg,
    suitMassKg: params.suit_mass_kg,
  };

  let lastValidIndex = -1;
  let bindingReasonAtThreshold: 'time' | 'energy' = 'time';

  for (let i = 0; i < allSteps.length; i++) {
    const pt = allSteps[i];

    let returnTimeS = 0;
    let returnEnergyKj = 0;

    for (let r = i; r >= 1; r--) {
      const fromStep = allSteps[r];
      const toStep = allSteps[r - 1];

      if (fromStep.row === toStep.row && fromStep.col === toStep.col) continue;

      const fromElev = grid.getElevation(fromStep.row, fromStep.col);
      const toElev = grid.getElevation(toStep.row, toStep.col);
      const dz = toElev - fromElev;

      const isDiag = fromStep.row !== toStep.row && fromStep.col !== toStep.col;
      const hDist = isDiag ? diag_m : fromStep.row !== toStep.row ? grid.cell_y_m : grid.cell_x_m;
      const multiplier = grid.getCostMultiplier(toStep.row, toStep.col);

      const stepEval = evaluateStep(hDist, dz, multiplier, energyModelParams);
      returnTimeS += stepEval.timeS;
      returnEnergyKj += stepEval.energyKj;
    }

    const totalTime = pt.cumElapsedWalkTimeS + pt.cumElapsedDwellTimeS + returnTimeS;
    const totalEnergy = pt.cumElapsedWalkEnergyKj + pt.cumElapsedDwellEnergyKj + returnEnergyKj;

    const timeRatio = totalTime / timeLimitS;
    const energyRatio = Number.isFinite(energyLimitKj) ? totalEnergy / energyLimitKj : 0;

    const fitsBudget = totalTime <= timeLimitS && totalEnergy <= energyLimitKj;

    if (fitsBudget) {
      lastValidIndex = i;
    } else {
      bindingReasonAtThreshold = energyRatio > timeRatio ? 'energy' : 'time';
      break;
    }
  }

  if (lastValidIndex === -1) {
    const first = allSteps[0];
    return {
      leg: first.legIndex,
      lon: roundCoord(first.lon),
      lat: roundCoord(first.lat),
      reason: bindingReasonAtThreshold,
    };
  }

  if (lastValidIndex === allSteps.length - 1) {
    let maxCommitIndex = 0;
    let maxCommitRatio = 0;
    let commitReason: 'time' | 'energy' = 'time';

    for (let i = 0; i < allSteps.length; i++) {
      const pt = allSteps[i];
      let returnTimeS = 0;
      let returnEnergyKj = 0;
      for (let r = i; r >= 1; r--) {
        const fromStep = allSteps[r];
        const toStep = allSteps[r - 1];
        const fromElev = grid.getElevation(fromStep.row, fromStep.col);
        const toElev = grid.getElevation(toStep.row, toStep.col);
        const dz = toElev - fromElev;
        const isDiag = fromStep.row !== toStep.row && fromStep.col !== toStep.col;
        const hDist = isDiag ? diag_m : fromStep.row !== toStep.row ? grid.cell_y_m : grid.cell_x_m;
        const multiplier = grid.getCostMultiplier(toStep.row, toStep.col);
        const stepEval = evaluateStep(hDist, dz, multiplier, energyModelParams);
        returnTimeS += stepEval.timeS;
        returnEnergyKj += stepEval.energyKj;
      }
      const totalTime = pt.cumElapsedWalkTimeS + pt.cumElapsedDwellTimeS + returnTimeS;
      const totalEnergy = pt.cumElapsedWalkEnergyKj + pt.cumElapsedDwellEnergyKj + returnEnergyKj;

      const tRatio = totalTime / timeLimitS;
      const eRatio = Number.isFinite(energyLimitKj) ? totalEnergy / energyLimitKj : 0;
      const worstRatio = Math.max(tRatio, eRatio);

      if (worstRatio > maxCommitRatio) {
        maxCommitRatio = worstRatio;
        maxCommitIndex = i;
        commitReason = eRatio > tRatio ? 'energy' : 'time';
      }
    }

    const commitPt = allSteps[maxCommitIndex];
    return {
      leg: commitPt.legIndex,
      lon: roundCoord(commitPt.lon),
      lat: roundCoord(commitPt.lat),
      reason: commitReason,
    };
  }

  const tbPt = allSteps[lastValidIndex];
  return {
    leg: tbPt.legIndex,
    lon: roundCoord(tbPt.lon),
    lat: roundCoord(tbPt.lat),
    reason: bindingReasonAtThreshold,
  };
}

/**
 * Builds the complete plan.json object according to Contracts Section 7.
 */
export function buildPlan(input: BuildPlanInput): Plan {
  const { grid, params, start, stops } = input;
  const site = input.site || 'gale';
  const surfaceDoseRate = input.surfaceDoseRate ?? DEFAULT_SURFACE_DOSE_MGY_PER_DAY;
  const solarEventRate = input.solarEventRate ?? DEFAULT_SOLAR_EVENT_MGY_PER_DAY;

  const warnings: string[] = [];
  let overallFeasible = true;

  interface Waypoint {
    id: string;
    name: string;
    lon: number;
    lat: number;
    dwell_s: number;
  }

  const waypoints: Waypoint[] = [
    { id: 'start', name: start.label || 'Rover drop-off', lon: start.lon, lat: start.lat, dwell_s: 0 },
    ...stops.map((s) => ({
      id: s.id,
      name: s.name,
      lon: s.lon,
      lat: s.lat,
      dwell_s: s.dwell_s ?? params.stop_time_s,
    })),
  ];

  waypoints.push({ id: 'start', name: start.label || 'Rover drop-off', lon: start.lon, lat: start.lat, dwell_s: 0 });

  const rawLegResults: LegPathResult[] = [];
  const planLegs: PlanLeg[] = [];

  let totalDistanceM = 0;
  let totalWalkTimeS = 0;
  let totalClimbM = 0;
  let totalDescentM = 0;
  let totalEnergyKj = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const fromWp = waypoints[i];
    const toWp = waypoints[i + 1];

    const fromRc = grid.lonlatToRowCol(fromWp.lon, fromWp.lat);
    const toRc = grid.lonlatToRowCol(toWp.lon, toWp.lat);

    const legResult = findPath(grid, fromRc, toRc, {
      bodyMassKg: params.body_mass_kg,
      suitMassKg: params.suit_mass_kg,
    });

    rawLegResults.push(legResult);

    if (!legResult.feasible) {
      overallFeasible = false;
      const warnMsg = legResult.warning || `Cannot reach stop '${toWp.name}' (${toWp.id}) due to impassable terrain.`;
      warnings.push(warnMsg);

      planLegs.push({
        from: fromWp.id,
        to: toWp.id,
        line: [],
        distance_m: 0,
        time_s: 0,
        climb_m: 0,
        descent_m: 0,
        energy_kj: 0,
        max_slope_deg: 0,
      });
      continue;
    }

    const rawCoords: [number, number][] = legResult.steps.map((st) => [st.lon, st.lat]);
    if (rawCoords.length > 0) {
      rawCoords[0] = [fromWp.lon, fromWp.lat];
      rawCoords[rawCoords.length - 1] = [toWp.lon, toWp.lat];
    }

    const densifiedLine = densifyLine(rawCoords, grid.origin, 4.0);

    totalDistanceM += legResult.distance_m;
    totalWalkTimeS += legResult.time_s;
    totalClimbM += legResult.climb_m;
    totalDescentM += legResult.descent_m;
    totalEnergyKj += legResult.energy_kj;

    planLegs.push({
      from: fromWp.id,
      to: toWp.id,
      line: densifiedLine,
      distance_m: Math.round(legResult.distance_m),
      time_s: Math.round(legResult.time_s),
      climb_m: Math.round(legResult.climb_m),
      descent_m: Math.round(legResult.descent_m),
      energy_kj: Math.round(legResult.energy_kj),
      max_slope_deg: Number(legResult.max_slope_deg.toFixed(1)),
    });
  }

  let totalDwellTimeS = 0;
  let totalDwellEnergyKj = 0;
  for (const st of stops) {
    const dwellS = st.dwell_s ?? params.stop_time_s;
    totalDwellTimeS += dwellS;
    totalDwellEnergyKj += dwellEnergyKj(dwellS, params.body_mass_kg, params.suit_mass_kg);
  }

  const totalTimeS = totalWalkTimeS + totalDwellTimeS;
  const grandTotalEnergyKj = totalEnergyKj + totalDwellEnergyKj;

  const totalDoseMgy = calculateRadiationDose(totalTimeS, params.solar_event, surfaceDoseRate, solarEventRate);

  let turnBack: PlanTurnBack | null = null;
  if (overallFeasible) {
    turnBack = computeTurnBack(rawLegResults, stops, params, grid);
  }

  const totals: PlanTotals = {
    distance_m: Math.round(totalDistanceM),
    time_s: Math.round(totalTimeS),
    climb_m: Math.round(totalClimbM),
    descent_m: Math.round(totalDescentM),
    energy_kj: Math.round(grandTotalEnergyKj),
    dose_mgy: roundDose(totalDoseMgy),
  };

  return {
    version: 1,
    site,
    params,
    start,
    stops: stops.map((s) => ({
      id: s.id,
      name: s.name,
      lon: roundCoord(s.lon),
      lat: roundCoord(s.lat),
      ...(s.note ? { note: s.note } : {}),
      dwell_s: s.dwell_s ?? params.stop_time_s,
    })),
    route: {
      legs: planLegs,
      returns_to_start: true,
      totals,
      turn_back: turnBack,
      feasible: overallFeasible,
      warnings,
    },
  };
}

/**
 * Validates a plan object strictly against Contracts Section 7 schema.
 */
export function validatePlan(plan: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['Plan must be a non-null object.'] };
  }

  const p = plan as Partial<Plan>;

  if (p.version !== 1) errors.push(`Expected version 1, got ${p.version}`);
  if (typeof p.site !== 'string') errors.push('site must be a string');

  if (!p.params || typeof p.params !== 'object') {
    errors.push('params object is required');
  } else {
    if (typeof p.params.crew !== 'number') errors.push('params.crew must be a number');
    if (typeof p.params.time_limit_s !== 'number') errors.push('params.time_limit_s must be a number');
    if (typeof p.params.suit_mass_kg !== 'number') errors.push('params.suit_mass_kg must be a number');
    if (typeof p.params.body_mass_kg !== 'number') errors.push('params.body_mass_kg must be a number');
    if (typeof p.params.stop_time_s !== 'number') errors.push('params.stop_time_s must be a number');
    if (typeof p.params.solar_event !== 'boolean') errors.push('params.solar_event must be a boolean');
  }

  if (!p.start || typeof p.start !== 'object') {
    errors.push('start object is required');
  } else {
    if (typeof p.start.lon !== 'number') errors.push('start.lon must be a number');
    if (typeof p.start.lat !== 'number') errors.push('start.lat must be a number');
    if (typeof p.start.label !== 'string') errors.push('start.label must be a string');
  }

  if (!Array.isArray(p.stops)) {
    errors.push('stops must be an array');
  } else {
    for (let i = 0; i < p.stops.length; i++) {
      const s = p.stops[i];
      if (typeof s.id !== 'string') errors.push(`stops[${i}].id must be a string`);
      if (typeof s.name !== 'string') errors.push(`stops[${i}].name must be a string`);
      if (typeof s.lon !== 'number') errors.push(`stops[${i}].lon must be a number`);
      if (typeof s.lat !== 'number') errors.push(`stops[${i}].lat must be a number`);
      if (typeof s.dwell_s !== 'number') errors.push(`stops[${i}].dwell_s must be a number`);
    }
  }

  if (!p.route || typeof p.route !== 'object') {
    errors.push('route object is required');
  } else {
    if (!Array.isArray(p.route.legs)) {
      errors.push('route.legs must be an array');
    } else {
      for (let i = 0; i < p.route.legs.length; i++) {
        const leg = p.route.legs[i];
        if (typeof leg.from !== 'string') errors.push(`legs[${i}].from must be string`);
        if (typeof leg.to !== 'string') errors.push(`legs[${i}].to must be string`);
        if (!Array.isArray(leg.line)) errors.push(`legs[${i}].line must be array`);
        if (typeof leg.distance_m !== 'number') errors.push(`legs[${i}].distance_m must be number`);
        if (typeof leg.time_s !== 'number') errors.push(`legs[${i}].time_s must be number`);
        if (typeof leg.climb_m !== 'number') errors.push(`legs[${i}].climb_m must be number`);
        if (typeof leg.descent_m !== 'number') errors.push(`legs[${i}].descent_m must be number`);
        if (typeof leg.energy_kj !== 'number') errors.push(`legs[${i}].energy_kj must be number`);
        if (typeof leg.max_slope_deg !== 'number') errors.push(`legs[${i}].max_slope_deg must be number`);
      }
    }

    if (p.route.returns_to_start !== true) {
      errors.push('route.returns_to_start must be true');
    }

    if (!p.route.totals || typeof p.route.totals !== 'object') {
      errors.push('route.totals object is required');
    } else {
      if (typeof p.route.totals.distance_m !== 'number') errors.push('totals.distance_m must be number');
      if (typeof p.route.totals.time_s !== 'number') errors.push('totals.time_s must be number');
      if (typeof p.route.totals.climb_m !== 'number') errors.push('totals.climb_m must be number');
      if (typeof p.route.totals.descent_m !== 'number') errors.push('totals.descent_m must be number');
      if (typeof p.route.totals.energy_kj !== 'number') errors.push('totals.energy_kj must be number');
      if (typeof p.route.totals.dose_mgy !== 'number') errors.push('totals.dose_mgy must be number');
    }

    if (p.route.turn_back !== null && p.route.turn_back !== undefined) {
      if (typeof p.route.turn_back.leg !== 'number') errors.push('turn_back.leg must be number');
      if (typeof p.route.turn_back.lon !== 'number') errors.push('turn_back.lon must be number');
      if (typeof p.route.turn_back.lat !== 'number') errors.push('turn_back.lat must be number');
      if (p.route.turn_back.reason !== 'time' && p.route.turn_back.reason !== 'energy') {
        errors.push('turn_back.reason must be "time" or "energy"');
      }
    }

    if (typeof p.route.feasible !== 'boolean') errors.push('route.feasible must be boolean');
    if (!Array.isArray(p.route.warnings)) errors.push('route.warnings must be array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
