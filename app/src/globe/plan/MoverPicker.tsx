import React from 'react';
import type { Plan } from '../../lib/plan';
import { CREW_ROVER, SCIENCE_ROVER, roverCostMultiplier, roverDriveTimeS } from '../../lib/roverCost';

export type Mover = 'walker' | 'crew' | 'science';
interface Props { plan: Plan; mover: Mover; onChange: (mover: Mover) => void }

export function moverBudget(plan: Plan, mover: Mover): { distanceM: number; timeS: number; feasible: boolean } {
  if (mover === 'walker') return { distanceM: plan.route.totals.distance_m, timeS: plan.route.totals.time_s, feasible: plan.route.feasible };
  const limits = mover === 'crew' ? CREW_ROVER : SCIENCE_ROVER;
  const factors = plan.route.legs.map((leg) => roverCostMultiplier(leg.max_slope_deg, 0, limits));
  const feasible = factors.every((factor) => factor !== null);
  const dwell = plan.stops.reduce((sum, stop) => sum + (stop.dwell_s ?? plan.params.stop_time_s), 0);
  const timeS = feasible
    ? plan.route.legs.reduce((sum, leg, index) => sum + roverDriveTimeS(leg.distance_m, limits) * (factors[index] ?? 1), dwell)
    : Infinity;
  return { distanceM: plan.route.totals.distance_m, timeS, feasible };
}

export const MoverPicker: React.FC<Props> = ({ plan, mover, onChange }) => <fieldset className="globe-mover">
  <legend>Mover</legend>
  <div role="group" aria-label="Mover">
    {([['walker', 'Walker'], ['crew', 'Crew rover'], ['science', 'Science rover']] as const).map(([value, label]) => <button key={value} type="button" className={mover === value ? 'is-selected' : ''} aria-pressed={mover === value} onClick={() => onChange(value)}>{label}</button>)}
  </div>
  <span className="globe-mover__budget">{(() => { const budget = moverBudget(plan, mover); if (!budget.feasible) return 'Impassable'; const minutes = Math.round(budget.timeS / 60); return `${budget.distanceM >= 1000 ? `${(budget.distanceM / 1000).toFixed(1)} km` : `${Math.round(budget.distanceM)} m`} · ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`; })()}</span>
</fieldset>;
