import type { Plan, PlanParams, PlanStart, PlanStop, PlanTotals } from '../lib/plan';
import type { RouteGrid } from '../lib/grid';

export const DEFAULT_PARAMS: PlanParams = {
  crew: 2, time_limit_s: 28_800, suit_mass_kg: 120, body_mass_kg: 80,
  stop_time_s: 1200, solar_event: false,
};

export function nextStopName(stops: PlanStop[]): string {
  const used = new Set(stops.map((stop) => stop.name));
  let n = 1;
  while (used.has(`Stop ${n}`)) n += 1;
  return `Stop ${n}`;
}

export function reorderStop(stops: PlanStop[], from: number, to: number): PlanStop[] {
  if (from < 0 || from >= stops.length || to < 0 || to >= stops.length || from === to) return stops;
  const result = [...stops];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function updateStop(stops: PlanStop[], id: string, patch: Partial<PlanStop>): PlanStop[] {
  return stops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop);
}

export function removeStop(stops: PlanStop[], id: string): PlanStop[] {
  return stops.filter((stop) => stop.id !== id);
}

export function sampleProfile(grid: RouteGrid, line: [number, number][], spacingM = 40) {
  const samples: { distanceM: number; elevationM: number; lon: number; lat: number }[] = [];
  let distanceM = 0;
  let previous: { x_m: number; y_m: number } | undefined;
  for (const [lon, lat] of line) {
    const local = grid.lonlatToLocalMetres(lon, lat);
    if (previous) distanceM += Math.hypot(local.x_m - previous.x_m, local.y_m - previous.y_m);
    previous = local;
    if (samples.length === 0 || distanceM - samples[samples.length - 1].distanceM >= spacingM) {
      const { row, col } = grid.lonlatToRowCol(lon, lat);
      const elevationM = grid.getElevation(row, col);
      if (Number.isFinite(elevationM)) samples.push({ distanceM, elevationM, lon, lat });
    }
  }
  if (line.length && samples[samples.length - 1]?.distanceM !== distanceM) {
    const [lon, lat] = line[line.length - 1];
    const { row, col } = grid.lonlatToRowCol(lon, lat);
    const elevationM = grid.getElevation(row, col);
    if (Number.isFinite(elevationM)) samples.push({ distanceM, elevationM, lon, lat });
  }
  return samples;
}

export function budgetFractions(totals: PlanTotals, params: PlanParams) {
  return {
    time: totals.time_s / params.time_limit_s,
    energy: params.energy_limit_kj ? totals.energy_kj / params.energy_limit_kj : 0,
  };
}

export function findWalkableCentre(grid: RouteGrid): PlanStart {
  const middle = { row: Math.floor(grid.height / 2), col: Math.floor(grid.width / 2) };
  for (let radius = 0; radius < Math.max(grid.width, grid.height); radius += 1) {
    for (let r = Math.max(0, middle.row - radius); r <= Math.min(grid.height - 1, middle.row + radius); r += 1) {
      for (let c = Math.max(0, middle.col - radius); c <= Math.min(grid.width - 1, middle.col + radius); c += 1) {
        if (Math.max(Math.abs(r - middle.row), Math.abs(c - middle.col)) !== radius) continue;
        if (grid.isPassable(r, c)) {
          const point = grid.rowColToLonLat(r, c);
          return { ...point, label: 'Rover drop-off' };
        }
      }
    }
  }
  const point = grid.rowColToLonLat(middle.row, middle.col);
  return { ...point, label: 'Rover drop-off' };
}

export function makeInitialPlan(site: string, start: PlanStart): Plan {
  return {
    version: 1, site, params: { ...DEFAULT_PARAMS }, start, stops: [],
    route: { legs: [], returns_to_start: true,
      totals: { distance_m: 0, time_s: 0, climb_m: 0, descent_m: 0, energy_kj: 0, dose_mgy: 0 },
      turn_back: null, feasible: true, warnings: [] },
  };
}
