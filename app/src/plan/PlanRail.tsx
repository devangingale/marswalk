import React, { useMemo, useState } from 'react';
import type { Plan, PlanParams, PlanStop } from '../lib/plan';
import type { RouteGrid } from '../lib/grid';
import { validatePlan } from '../lib/plan';
import { budgetFractions, removeStop, reorderStop, sampleProfile, updateStop } from './planLogic';

interface Props {
  plan: Plan; grid: RouteGrid | null; computing: boolean; onChange: (plan: Plan) => void;
  onImport: (plan: Plan) => void;
}

const fmtDistance = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)}\u00a0km` : `${Math.round(m)}\u00a0m`;
const fmtTime = (s: number) => {
  const minutes = Math.max(0, Math.round(s / 300) * 5);
  if (minutes === 0) return `0\u00a0min`;
  return minutes < 60 ? `${minutes}\u00a0min` : `${Math.floor(minutes / 60)}\u00a0h ${String(minutes % 60).padStart(2, '0')}\u00a0min`;
};
const fmtDose = (dose: number) => dose === 0 ? `0\u00a0mGy` : dose < 0.001 ? `< 0.001\u00a0mGy` : `≈ ${Number(dose.toPrecision(2))}\u00a0mGy`;
const fmtEnergy = (energy: number) => `≈ ${Math.round(energy / 50) * 50}\u00a0kJ`;
const fmtElevation = (metres: number, sign: '+' | '−') => Math.round(metres) === 0 ? `0\u00a0m` : `${sign}${Math.round(metres)}\u00a0m`;
const clone = (plan: Plan, patch: Partial<Pick<Plan, 'params' | 'start' | 'stops'>>) => ({ ...plan, ...patch });

export const PlanRail: React.FC<Props> = ({ plan, grid, computing, onChange, onImport }) => {
  const [paramsOpen, setParamsOpen] = useState(false);
  const fractions = budgetFractions(plan.route.totals, plan.params);
  const line = useMemo(() => plan.route.legs.flatMap((leg, index) => index ? leg.line.slice(1) : leg.line), [plan.route.legs]);
  const profile = useMemo(() => grid ? sampleProfile(grid, line) : [], [grid, line]);
  const maxDistance = profile.at(-1)?.distanceM ?? 0;
  const turnbackIndex = plan.route.turn_back && grid && profile.length ? profile.reduce((best, sample, index) => {
    const target = grid.lonlatToLocalMetres(plan.route.turn_back!.lon, plan.route.turn_back!.lat);
    const point = grid.lonlatToLocalMetres(sample.lon, sample.lat);
    const bestPoint = grid.lonlatToLocalMetres(profile[best].lon, profile[best].lat);
    return Math.hypot(target.x_m - point.x_m, target.y_m - point.y_m) < Math.hypot(target.x_m - bestPoint.x_m, target.y_m - bestPoint.y_m) ? index : best;
  }, 0) : -1;
  const elevations = profile.map((sample) => sample.elevationM);
  const minElev = elevations.length ? Math.min(...elevations) : 0;
  const maxElev = elevations.length ? Math.max(...elevations) : 0;
  const plotLeft = 38;
  const plotRight = 350;
  const plotTop = 12;
  const plotBottom = 64;
  const xAt = (distance: number) => plotLeft + (maxDistance ? distance / maxDistance : 0) * (plotRight - plotLeft);
  const yAt = (elevation: number) => plotBottom - ((elevation - minElev) / Math.max(1, maxElev - minElev)) * (plotBottom - plotTop);
  const points = profile.map((sample) => `${xAt(sample.distanceM)},${yAt(sample.elevationM)}`).join(' ');
  const stopPositions = plan.stops.map((stop) => {
    if (!grid || !profile.length) return null;
    const target = grid.lonlatToLocalMetres(stop.lon, stop.lat);
    let closestIndex = 0;
    let closestDistance = Infinity;
    profile.forEach((sample, index) => {
      const point = grid.lonlatToLocalMetres(sample.lon, sample.lat);
      const distance = Math.hypot(target.x_m - point.x_m, target.y_m - point.y_m);
      if (distance < closestDistance) { closestDistance = distance; closestIndex = index; }
    });
    return closestDistance <= 45 ? closestIndex : null;
  });
  const turnbackFits = Boolean(plan.route.turn_back && plan.route.totals.time_s <= plan.params.time_limit_s && (!plan.params.energy_limit_kj || plan.route.totals.energy_kj <= plan.params.energy_limit_kj));
  const turnbackElapsed = useMemo(() => {
    if (!plan.route.turn_back) return 0;
    const legIndex = Math.max(0, Math.min(plan.route.turn_back.leg, plan.route.legs.length - 1));
    const leg = plan.route.legs[legIndex];
    if (!leg) return 0;
    const before = plan.route.legs.slice(0, legIndex).reduce((sum, item) => sum + item.time_s, 0)
      + plan.stops.slice(0, legIndex).reduce((sum, stop) => sum + (stop.dwell_s ?? plan.params.stop_time_s), 0);
    let traveled = 0;
    let closestAlong = 0;
    let closest = Infinity;
    let previous: { x_m: number; y_m: number } | undefined;
    for (const [lon, lat] of leg.line) {
      const local = grid?.lonlatToLocalMetres(lon, lat);
      if (!local) continue;
      if (previous) traveled += Math.hypot(local.x_m - previous.x_m, local.y_m - previous.y_m);
      const target = grid!.lonlatToLocalMetres(plan.route.turn_back.lon, plan.route.turn_back.lat);
      const distance = Math.hypot(target.x_m - local.x_m, target.y_m - local.y_m);
      if (distance < closest) { closest = distance; closestAlong = traveled; }
      previous = local;
    }
    return before + (leg.distance_m ? leg.time_s * Math.min(1, closestAlong / leg.distance_m) : 0);
  }, [grid, plan]);
  const patchParams = (patch: Partial<PlanParams>) => onChange(clone(plan, { params: { ...plan.params, ...patch } }));
  const patchStop = (id: string, patch: Partial<PlanStop>) => onChange(clone(plan, { stops: updateStop(plan.stops, id, patch) }));
  const exportPlan = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'plan.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const importPlan = async (file?: File) => {
    if (!file) return;
    try { const value = JSON.parse(await file.text()) as Plan; if (value.site === plan.site && validatePlan(value).valid) onImport(value); } catch { /* invalid JSON stays local */ }
  };

  return <aside className="plan-rail" aria-label="Route plan">
    <section className="plan-section plan-stops" aria-labelledby="plan-stops-heading">
      <div className="plan-rail__head"><h2 id="plan-stops-heading">Stops</h2><span aria-live="polite">{computing ? 'Computing' : ''}</span></div>
      {plan.stops.length === 0
        ? <p className="plan-rail__empty">Click the map to add a stop</p>
        : <ol className="plan-stop-list">{plan.stops.map((stop, index) => <li key={stop.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onChange(clone(plan, { stops: reorderStop(plan.stops, Number(e.dataTransfer.getData('text/plain')), index) })); }}>
          <span className="plan-stop-list__number">{index + 1}</span>
          <input className="plan-stop-list__name" aria-label={`Stop ${index + 1} name`} value={stop.name} onChange={(e) => patchStop(stop.id, { name: e.target.value })} />
          <span className="plan-stop-list__dwell-wrap"><input className="plan-stop-list__dwell" aria-label={`${stop.name} dwell minutes`} title="Dwell minutes" type="number" min="0" value={Math.round((stop.dwell_s ?? plan.params.stop_time_s) / 60)} onChange={(e) => patchStop(stop.id, { dwell_s: Number(e.target.value) * 60 })} /><small>min</small></span>
          <div className="plan-stop-list__actions">
            <button type="button" aria-label={`Move ${stop.name} up`} disabled={index === 0} onClick={() => onChange(clone(plan, { stops: reorderStop(plan.stops, index, index - 1) }))}>↑</button>
            <button type="button" aria-label={`Move ${stop.name} down`} disabled={index === plan.stops.length - 1} onClick={() => onChange(clone(plan, { stops: reorderStop(plan.stops, index, index + 1) }))}>↓</button>
            <button type="button" aria-label={`Remove ${stop.name}`} onClick={() => onChange(clone(plan, { stops: removeStop(plan.stops, stop.id) }))}>×</button>
          </div>
        </li>)}</ol>}
      {!!plan.route.warnings.length && <p className="plan-rail__warning">{plan.route.warnings[0]}</p>}
    </section>

    <section className="plan-section plan-budget" aria-labelledby="plan-budget-heading">
      <div className="plan-rail__head"><h2 id="plan-budget-heading">Budget</h2></div>
      <Budget label="Distance" value={fmtDistance(plan.route.totals.distance_m)} />
      <Budget label="Time" value={`≈ ${fmtTime(plan.route.totals.time_s)}`} limit={fmtTime(plan.params.time_limit_s)} fraction={fractions.time} />
      <div className="plan-budget__pair"><span>Climb</span><b>{fmtElevation(plan.route.totals.climb_m, '+')}</b><span>Descent</span><b>{fmtElevation(plan.route.totals.descent_m, '−')}</b></div>
      <Budget label="Energy" value={fmtEnergy(plan.route.totals.energy_kj)} limit={plan.params.energy_limit_kj ? `${Math.round(plan.params.energy_limit_kj)}\u00a0kJ` : undefined} fraction={plan.params.energy_limit_kj ? fractions.energy : undefined} />
      <Budget label="Radiation dose" value={fmtDose(plan.route.totals.dose_mgy)} />
      <div className="plan-turnback"><span>Turn-back</span><b>{!plan.route.turn_back || turnbackFits ? 'Not needed' : `Turn back by ${fmtTime(turnbackElapsed)} (${plan.route.turn_back.reason} limit)`}</b></div>
    </section>

    <section className="plan-section plan-profile" aria-labelledby="plan-profile-heading">
      <div className="plan-rail__head"><h2 id="plan-profile-heading">Elevation profile</h2></div>
      <svg viewBox="0 0 360 88" role="img" aria-label="Elevation along route">
        <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} className="profile-axis" />
        <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} className="profile-axis" />
        {elevations.length > 0 && <><text x="0" y={plotTop + 4} className="profile-label">{`${maxElev.toFixed(0)}\u00a0m`}</text><text x="0" y={plotBottom} className="profile-label">{`${minElev.toFixed(0)}\u00a0m`}</text></>}
        {profile.length > 1 && <polyline points={points} className="profile-line" />}
        {stopPositions.map((sampleIndex, index) => sampleIndex !== null && <g key={plan.stops[index].id}>
          <line x1={xAt(profile[sampleIndex].distanceM)} x2={xAt(profile[sampleIndex].distanceM)} y1={plotTop} y2={plotBottom} className="profile-stop" />
          <text x={xAt(profile[sampleIndex].distanceM)} y={plotTop + 10} textAnchor="middle" className="profile-stop-label">{index + 1}</text>
        </g>)}
        {turnbackIndex >= 0 && !turnbackFits && <g><path d={`M ${xAt(profile[turnbackIndex].distanceM) - 4} 2 l 8 0 l -4 6 z`} className="profile-turn" /><text x={xAt(profile[turnbackIndex].distanceM)} y="10" textAnchor="middle" className="profile-turn-label">T</text></g>}
        <text x={plotLeft} y="82" className="profile-label">0</text><text x={plotRight} y="82" textAnchor="end" className="profile-label">{fmtDistance(maxDistance)}</text>
      </svg>
      {turnbackIndex >= 0 && !turnbackFits && <p className="plan-profile__turnback">T · Turn-back point</p>}
    </section>

    <details className="plan-params" open={paramsOpen} onToggle={(event) => setParamsOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>Parameters</summary>
      <div className="plan-params__grid">
        <label>Crew<input type="number" min="1" max="8" value={plan.params.crew} onChange={(e) => patchParams({ crew: Number(e.target.value) })} /></label>
        <label>Time limit (h)<input type="number" min="1" max="24" value={plan.params.time_limit_s / 3600} onChange={(e) => patchParams({ time_limit_s: Number(e.target.value) * 3600 })} /></label>
        <label>Suit mass (kg)<input type="number" min="0" value={plan.params.suit_mass_kg} onChange={(e) => patchParams({ suit_mass_kg: Number(e.target.value) })} /></label>
        <label>Body mass (kg)<input type="number" min="1" value={plan.params.body_mass_kg} onChange={(e) => patchParams({ body_mass_kg: Number(e.target.value) })} /></label>
        <label>Stop dwell (min)<input type="number" min="0" value={(plan.params.stop_time_s ?? 1200) / 60} onChange={(e) => patchParams({ stop_time_s: Number(e.target.value) * 60 })} /></label>
        <label>Energy limit (kJ)<input type="number" min="1" value={plan.params.energy_limit_kj ?? ''} onChange={(e) => patchParams({ energy_limit_kj: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label className="plan-check"><input type="checkbox" checked={plan.params.solar_event} onChange={(e) => patchParams({ solar_event: e.target.checked })} /> Solar event</label>
      </div>
    </details>
    <div className="plan-rail__actions"><button type="button" onClick={exportPlan}>Export plan.json</button><label className="plan-import">Import<input type="file" accept="application/json,.json" onChange={(e) => void importPlan(e.target.files?.[0])} /></label></div>
  </aside>;
};

const Budget: React.FC<{ label: string; value: string; limit?: string; fraction?: number }> = ({ label, value, limit, fraction }) => <div className={`plan-budget__row${fraction !== undefined && fraction > 1 ? ' is-over' : ''}`}>
  <div className="plan-budget__values"><span>{label}</span><b>{value}</b>{limit && <small>{limit}</small>}</div>
  {fraction !== undefined && <div className="budget-track"><span style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} /></div>}
</div>;
