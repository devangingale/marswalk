import React, { useMemo, useState } from 'react';
import type { Plan, PlanParams, PlanStop } from '../lib/plan';
import type { RouteGrid } from '../lib/grid';
import { validatePlan } from '../lib/plan';
import { budgetFractions, removeStop, reorderStop, sampleProfile, updateStop } from './planLogic';

interface Props {
  plan: Plan; grid: RouteGrid | null; computing: boolean; onChange: (plan: Plan) => void;
  onImport: (plan: Plan) => void;
}

const fmtDistance = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const fmtTime = (s: number) => { const minutes = Math.round(s / 300) * 5; if (minutes === 0) return '0 min'; return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`; };
const fmtDose = (dose: number) => dose === 0 ? '0 mGy' : dose < 0.001 ? '< 0.001 mGy' : `≈ ${Number(dose.toPrecision(2))} mGy`;
const clone = (plan: Plan, patch: Partial<Pick<Plan, 'params' | 'start' | 'stops'>>) => ({ ...plan, ...patch });

export const PlanRail: React.FC<Props> = ({ plan, grid, computing, onChange, onImport }) => {
  const [paramsOpen, setParamsOpen] = useState(false);
  const fractions = budgetFractions(plan.route.totals, plan.params);
  const line = useMemo(() => plan.route.legs.flatMap((leg, index) => index ? leg.line.slice(1) : leg.line), [plan.route.legs]);
  const profile = useMemo(() => grid ? sampleProfile(grid, line) : [], [grid, line]);
  const maxDistance = profile.at(-1)?.distanceM ?? 0;
  const turnbackDistance = plan.stops.length && plan.route.turn_back && grid ? profile.reduce((best, sample) => {
    const target = grid.lonlatToLocalMetres(plan.route.turn_back!.lon, plan.route.turn_back!.lat);
    const point = grid.lonlatToLocalMetres(sample.lon, sample.lat);
    const bestPoint = grid.lonlatToLocalMetres(profile[best].lon, profile[best].lat);
    return Math.hypot(target.x_m - point.x_m, target.y_m - point.y_m) < Math.hypot(target.x_m - bestPoint.x_m, target.y_m - bestPoint.y_m) ? profile.indexOf(sample) : best;
  }, 0) : -1;
  const turnbackX = turnbackDistance >= 0 && maxDistance ? (profile[turnbackDistance].distanceM / maxDistance) * 300 : 0;
  const elevations = profile.map((sample) => sample.elevationM);
  const minElev = elevations.length ? Math.min(...elevations) : 0, maxElev = elevations.length ? Math.max(...elevations) : 0;
  const points = profile.map((sample) => `${maxDistance ? (sample.distanceM / maxDistance) * 300 : 0},${38 - ((sample.elevationM - minElev) / Math.max(1, maxElev - minElev)) * 30}`).join(' ');
  const stopPositions = plan.stops.map((stop) => {
    if (!grid || !profile.length) return null;
    const target = grid.lonlatToLocalMetres(stop.lon, stop.lat);
    let closestDistance = Infinity;
    const closestIndex = profile.reduce((best, sample, index) => {
      const p = grid.lonlatToLocalMetres(sample.lon, sample.lat);
      const distance = Math.hypot(target.x_m - p.x_m, target.y_m - p.y_m);
      if (distance < closestDistance) closestDistance = distance;
      return distance < Math.hypot(target.x_m - grid.lonlatToLocalMetres(profile[best].lon, profile[best].lat).x_m, target.y_m - grid.lonlatToLocalMetres(profile[best].lon, profile[best].lat).y_m) ? index : best;
    }, 0);
    return closestDistance <= 45 ? closestIndex : null;
  });
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
    <div className="plan-rail__head"><h2>Route budget</h2><span aria-live="polite">{computing ? 'Computing' : ''}</span></div>
    {plan.stops.length === 0 && <p className="plan-rail__empty">No stops yet. Click the map to drop one.</p>}
    {plan.stops.length > 0 && <ol className="plan-stop-list">{plan.stops.map((stop, index) => <li key={stop.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onChange(clone(plan, { stops: reorderStop(plan.stops, Number(e.dataTransfer.getData('text/plain')), index) })); }}>
      <span className="plan-stop-list__number">{index + 1}</span><input aria-label={`Stop ${index + 1} name`} value={stop.name} onChange={(e) => patchStop(stop.id, { name: e.target.value })} />
      <span className="plan-stop-list__dwell-wrap"><input className="plan-stop-list__dwell" aria-label={`${stop.name} dwell minutes`} title="Dwell min" type="number" min="0" value={Math.round((stop.dwell_s ?? plan.params.stop_time_s) / 60)} onChange={(e) => patchStop(stop.id, { dwell_s: Number(e.target.value) * 60 })} /><small>min</small></span>
      <button type="button" aria-label={`Move ${stop.name} up`} disabled={index === 0} onClick={() => onChange(clone(plan, { stops: reorderStop(plan.stops, index, index - 1) }))}>↑</button>
      <button type="button" aria-label={`Move ${stop.name} down`} disabled={index === plan.stops.length - 1} onClick={() => onChange(clone(plan, { stops: reorderStop(plan.stops, index, index + 1) }))}>↓</button>
      <button type="button" aria-label={`Remove ${stop.name}`} onClick={() => onChange(clone(plan, { stops: removeStop(plan.stops, stop.id) }))}>×</button>
    </li>)}</ol>}
    {!!plan.route.warnings.length && <p className="plan-rail__warning">{plan.route.warnings[0]}</p>}
    <div className="plan-budget">
      <Budget label="Distance" value={fmtDistance(plan.route.totals.distance_m)} fraction={null} />
      <Budget label="Walking time" value={`${fmtTime(plan.route.totals.time_s)} / ${fmtTime(plan.params.time_limit_s)}`} fraction={fractions.time} />
      <div className="plan-budget__pair"><span>Climb</span><b>+{Math.round(plan.route.totals.climb_m)} m</b><span>Descent</span><b>−{Math.round(plan.route.totals.descent_m)} m</b></div>
      <Budget label="Energy" value={`≈ ${Math.round(plan.route.totals.energy_kj / 50) * 50} kJ`} fraction={fractions.energy} />
      <Budget label="Radiation dose" value={fmtDose(plan.route.totals.dose_mgy)} fraction={null} />
      <div className="plan-turnback"><span>Turn-back point</span><b>{plan.stops.length && plan.route.turn_back ? `${plan.route.turn_back.reason} · leg ${plan.route.turn_back.leg + 1}` : '—'}</b></div>
    </div>
    <div className="plan-profile"><div className="plan-rail__head"><h3>Elevation profile</h3><span>{fmtDistance(maxDistance)}</span></div>
      <svg viewBox="0 0 300 46" role="img" aria-label="Elevation along route"><line x1="0" y1="40" x2="300" y2="40" className="profile-axis" />{profile.length > 1 && <polyline points={points} className="profile-line" />}{stopPositions.map((sampleIndex, index) => sampleIndex !== null && <line key={plan.stops[index].id} x1={maxDistance ? profile[sampleIndex]?.distanceM / maxDistance * 300 : 0} x2={maxDistance ? profile[sampleIndex]?.distanceM / maxDistance * 300 : 0} y1="3" y2="43" className="profile-stop" />)}{plan.stops.length > 0 && plan.route.turn_back && <path d={`M ${turnbackX - 3.5} 2 l 7 0 l -3.5 5 z`} className="profile-turn" />}</svg>
      <div className="plan-profile__ends"><span>{elevations.length ? `${maxElev.toFixed(0)} m` : ''}</span><span>{elevations.length ? `${minElev.toFixed(0)} m` : ''}</span></div>
    </div>
    <details className="plan-params" open={paramsOpen} onToggle={(event) => setParamsOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>Plan parameters</summary>
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

const Budget: React.FC<{ label: string; value: string; fraction: number | null }> = ({ label, value, fraction }) => <div className={`plan-budget__row${fraction !== null && fraction > 1 ? ' is-over' : ''}`}><div><span>{label}</span><b>{value}</b></div>{fraction !== null && <div className="budget-track"><span style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} /></div>}</div>;
