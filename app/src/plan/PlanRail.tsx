import React, { useEffect, useMemo, useState } from 'react';
import type { Plan, PlanParams, PlanStop, ShelterType } from '../lib/plan';
import type { RouteGrid } from '../lib/grid';
import { SHELTER_TYPES, SHELTER_TYPE_HINTS, SHELTER_TYPE_NAMES, setShelterType, shelterType, validatePlan } from '../lib/plan';
import { budgetFractions, removeStop, reorderStop, updateStop, type ShelterMoveState } from './planLogic';
import { formatLatLon } from '../globe/routeLook';
import { PlanProfile } from '../globe/plan/PlanProfile';
import { PlanPace } from '../globe/plan/PlanPace';
import { MoverPicker, moverBudget, type Mover } from '../globe/plan/MoverPicker';
import '../globe/plan/plan.css';
import './snap.css';

interface Props {
  plan: Plan; grid: RouteGrid | null; computing: boolean; onChange: (plan: Plan) => void;
  onImport: (plan: Plan) => void;
  mover: Mover; onMoverChange: (mover: Mover) => void;
  activePoint: { lon: number; lat: number } | null;
  onProfileHover: (point: { lon: number; lat: number } | null) => void;
  stopNotices?: Record<string, string>;
  /** Move-shelter mode and the last placement's snap notice. */
  shelterMove?: ShelterMoveState;
  onMoveShelter?: () => void;
  onCancelMoveShelter?: () => void;
}

const fmtDistance = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)}\u00a0km` : `${Math.round(m)}\u00a0m`;
const fmtTime = (s: number) => {
  const minutes = Math.max(0, Math.round(s / 300) * 5);
  if (minutes === 0) return `0\u00a0min`;
  return minutes < 60 ? `${minutes}\u00a0min` : `${Math.floor(minutes / 60)}\u00a0h ${String(minutes % 60).padStart(2, '0')}\u00a0min`;
};
const fmtDose = (dose: number) => dose === 0 ? `0\u00a0mGy` : dose < 0.001 ? `< 0.001\u00a0mGy` : `${Number(dose.toPrecision(2))}\u00a0mGy`;
const fmtEnergy = (energy: number) => `${Math.round(energy / 50) * 50}\u00a0kJ`;
const fmtElevation = (metres: number, sign: '+' | '−') => Math.round(metres) === 0 ? `0\u00a0m` : `${sign}${Math.round(metres)}\u00a0m`;
const clone = (plan: Plan, patch: Partial<Pick<Plan, 'params' | 'start' | 'stops'>>) => ({ ...plan, ...patch });

export const PlanRail: React.FC<Props> = ({ plan, grid, computing, onChange, onImport, mover, onMoverChange, activePoint, onProfileHover, stopNotices, shelterMove, onMoveShelter, onCancelMoveShelter }) => {
  const [paramsOpen, setParamsOpen] = useState(false);
  const fractions = budgetFractions(plan.route.totals, plan.params);
  const selectedBudget = moverBudget(plan, mover);
  const turnbackFits = Boolean(plan.route.turn_back && plan.route.totals.time_s <= plan.params.time_limit_s && (!plan.params.energy_limit_kj || plan.route.totals.energy_kj <= plan.params.energy_limit_kj));
  const turnbackElapsed = useMemo(() => {
    if (!plan.route.turn_back) return 0;
    const legIndex = Math.max(0, Math.min(plan.route.turn_back.leg, plan.route.legs.length - 1));
    const leg = plan.route.legs[legIndex];
    if (!leg) return 0;
    const before = plan.route.legs.slice(0, legIndex).reduce((sum, item) => {
      const stop = plan.stops.find((s) => s.id === item.to);
      const dwell = stop ? (stop.dwell_s ?? plan.params.stop_time_s) : 0;
      return sum + item.time_s + dwell;
    }, 0);
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
    <ShelterSection plan={plan} onChange={onChange} move={shelterMove} onMove={onMoveShelter} onCancel={onCancelMoveShelter} />

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
          {stopNotices?.[stop.id] && <p className="plan-stop-notice">{stopNotices[stop.id]}</p>}
        </li>)}</ol>}
      {!!plan.route.warnings.length && plan.route.warnings.map((w, idx) => <p key={idx} className="plan-rail__warning">{w}</p>)}
    </section>

    {plan.stops.length > 0 && <section className="plan-section plan-budget" aria-labelledby="plan-budget-heading">
      <div className="plan-rail__head"><h2 id="plan-budget-heading">Budget</h2></div>
      <Budget label="Distance" value={fmtDistance(plan.route.totals.distance_m)} />
      <Budget label="Time" value={selectedBudget.feasible || plan.route.legs.length > 0 ? fmtTime(selectedBudget.timeS) : 'Impassable'} limit={fmtTime(plan.params.time_limit_s)} fraction={selectedBudget.feasible || plan.route.legs.length > 0 ? selectedBudget.timeS / plan.params.time_limit_s : 2} />
      <div className="plan-budget__pair"><span>Climb</span><b>{fmtElevation(plan.route.totals.climb_m, '+')}</b><span>Descent</span><b>{fmtElevation(plan.route.totals.descent_m, '−')}</b></div>
      <Budget label="Energy" value={fmtEnergy(plan.route.totals.energy_kj)} limit={plan.params.energy_limit_kj ? `${Math.round(plan.params.energy_limit_kj)}\u00a0kJ` : undefined} fraction={plan.params.energy_limit_kj ? fractions.energy : undefined} />
      <Budget label="Radiation dose" value={fmtDose(plan.route.totals.dose_mgy)} />
      <div className="plan-turnback"><span>Turn-back</span><b>{!plan.route.turn_back || turnbackFits ? 'Not needed' : `Turn back by ${fmtTime(turnbackElapsed)} (${plan.route.turn_back.reason} limit)`}</b></div>
    </section>}

    <MoverPicker plan={plan} mover={mover} onChange={onMoverChange} />
    {plan.stops.length > 0 && <PlanProfile plan={plan} grid={grid} activePoint={activePoint} onHover={onProfileHover} />}
    {plan.stops.length > 0 && <PlanPace plan={plan} moverTimeS={selectedBudget.timeS} />}

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

/**
 * The shelter the walk starts from and returns to: its type, name and position, and
 * "Move shelter" (the next map click places it; Esc cancels). Not a stop.
 */
const ShelterSection: React.FC<{ plan: Plan; onChange: (plan: Plan) => void; move?: ShelterMoveState; onMove?: () => void; onCancel?: () => void }> = ({ plan, onChange, move, onMove, onCancel }) => {
  const active = !!move?.active;
  useEffect(() => {
    if (!active || !onCancel) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onCancel]);
  const kind = shelterType(plan.start);
  return <section className="plan-section plan-shelter" aria-labelledby="plan-shelter-heading">
    <div className="plan-rail__head"><h2 id="plan-shelter-heading">Shelter</h2><span>Start and finish of the walk</span></div>
    <div className="plan-shelter__grid">
      <label>Type<select aria-label="Shelter type" value={kind} onChange={(e) => onChange({ ...plan, start: setShelterType(plan.start, e.target.value as ShelterType) })}>
        {SHELTER_TYPES.map((value) => <option key={value} value={value}>{SHELTER_TYPE_NAMES[value]}</option>)}
      </select></label>
      <label>Name<input aria-label="Shelter name" value={plan.start.label} onChange={(e) => onChange({ ...plan, start: { ...plan.start, label: e.target.value } })} /></label>
    </div>
    <p className="plan-shelter__hint">{SHELTER_TYPE_HINTS[kind]}</p>
    <div className="plan-shelter__position">
      <span>Position</span><b>{formatLatLon(plan.start.lon, plan.start.lat)}</b>
    </div>
    <button type="button" className={`plan-shelter__move${active ? ' is-active' : ''}`} aria-pressed={active} onClick={onMove} disabled={!onMove}>
      {active ? 'Click the map to place · Esc cancels' : 'Move shelter'}
    </button>
    {move?.notice && <p className="plan-stop-notice">{move.notice}</p>}
  </section>;
};
