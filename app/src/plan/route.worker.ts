import { buildPlan } from '../lib/plan';
import { createGrid, type GridHeader } from '../lib/grid';
import type { PlanParams, PlanStart, PlanStop } from '../lib/plan';

type Request = { id: number; header: GridHeader; origin: { lon0: number; lat0: number; lat_c: number }; elev: Uint16Array; cost: Uint8Array; site: string; params: PlanParams; start: PlanStart; stops: PlanStop[]; dose: number; solarDose: number };
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const grid = createGrid(request.header, request.elev, request.cost, request.origin);
    const plan = buildPlan({
      grid,
      site: request.site,
      params: request.params,
      start: request.start,
      stops: request.stops,
      surfaceDoseRate: request.dose,
      solarEventRate: request.solarDose,
    });
    self.postMessage({ id: request.id, plan });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
};
