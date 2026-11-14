import { buildPlan } from '../lib/plan';
import { createGrid, type GridHeader } from '../lib/grid';
import type { PlanParams, PlanStart, PlanStop } from '../lib/plan';
import { calculateRadiationDose, dwellEnergyKj } from '../lib/energy';

type Request = { id: number; header: GridHeader; origin: { lon0: number; lat0: number; lat_c: number }; elev: Uint16Array; cost: Uint8Array; site: string; params: PlanParams; start: PlanStart; stops: PlanStop[]; dose: number; solarDose: number };
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const grid = createGrid(request.header, request.elev, request.cost, request.origin);
    const plan = buildPlan({ grid, site: request.site, params: request.params, start: request.start, stops: request.stops, surfaceDoseRate: request.dose, solarEventRate: request.solarDose });
    const failedLeg = plan.route.legs.findIndex((leg) => leg.line.length === 0);
    if (failedLeg >= 0) {
      const reachedStops = request.stops.slice(0, Math.min(failedLeg, request.stops.length));
      const visibleLegs = plan.route.legs.slice(0, failedLeg + 1);
      const walked = visibleLegs.slice(0, failedLeg);
      const walkTime = walked.reduce((sum, leg) => sum + leg.time_s, 0);
      const dwellTime = reachedStops.reduce((sum, stop) => sum + (stop.dwell_s ?? request.params.stop_time_s), 0);
      const dwellEnergy = reachedStops.reduce((sum, stop) => sum + dwellEnergyKj(stop.dwell_s ?? request.params.stop_time_s, request.params.body_mass_kg, request.params.suit_mass_kg), 0);
      plan.route.legs = visibleLegs;
      plan.route.warnings = [failedLeg < request.stops.length ? `Can't reach ${request.stops[failedLeg].name}. Move or remove it.` : "Can't return to Rover drop-off. Move it."];
      plan.route.totals = {
        distance_m: Math.round(walked.reduce((sum, leg) => sum + leg.distance_m, 0)),
        time_s: Math.round(walkTime + dwellTime),
        climb_m: Math.round(walked.reduce((sum, leg) => sum + leg.climb_m, 0)),
        descent_m: Math.round(walked.reduce((sum, leg) => sum + leg.descent_m, 0)),
        energy_kj: Math.round(walked.reduce((sum, leg) => sum + leg.energy_kj, 0) + dwellEnergy),
        dose_mgy: Number(calculateRadiationDose(walkTime + dwellTime, request.params.solar_event, request.dose, request.solarDose).toFixed(3)),
      };
    }
    self.postMessage({ id: request.id, plan });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
};
