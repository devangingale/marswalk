import React, { useMemo, useState } from 'react';
import type { Plan } from '../../lib/plan';
import { deadline, paceCheck } from '../../lib/pace';
import { localMeanSolarTime, sunEvents, MARS_SOL_MS } from '../../lib/sun';

interface Props { plan: Plan; moverTimeS: number }
const formatClock = (hours: number) => `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`;
const paceLabel = (secondsPerKm: number) => {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60 / 5) * 5;
  return `${minutes}:${String(seconds).padStart(2, '0')} min/km`;
};

export const PlanPace: React.FC<Props> = ({ plan, moverTimeS }) => {
  const [now] = useState(() => Date.now());
  const lmst = localMeanSolarTime(now, plan.start.lon);
  const solStart = now - lmst / 24 * MARS_SOL_MS;
  const events = useMemo(() => sunEvents(solStart, plan.start.lat, plan.start.lon), [solStart, plan.start.lat, plan.start.lon]);
  const sunrise = events.sunriseUtcMs;
  const sunset = events.sunsetUtcMs;
  const start = sunrise ?? solStart;
  const end = sunset ?? solStart + MARS_SOL_MS;
  const initial = sunrise === null ? start : sunrise + 30 * 60_000;
  const [depart, setDepart] = useState(initial);
  const walkTime = Math.max(0, plan.route.totals.time_s - plan.stops.reduce((sum, stop) => sum + (stop.dwell_s ?? plan.params.stop_time_s), 0));
  const stopsTime = plan.route.totals.time_s - walkTime;
  const backBy = deadline(sunset, depart, plan.params.time_limit_s, 1800);
  const pace = backBy === null || !Number.isFinite(moverTimeS) || !plan.route.feasible || plan.route.totals.distance_m <= 0
    ? null : paceCheck(plan.route.totals.distance_m, Math.max(0, moverTimeS - stopsTime), stopsTime, depart, backBy);
  const departLmst = localMeanSolarTime(depart, plan.start.lon);
  const sunsetLmst = events.sunsetLmst;
  const daylight = sunrise !== null && sunset !== null;
  const sliderValue = Math.max(0, Math.min(1000, (depart - start) / Math.max(1, end - start) * 1000));
  const verdict = !plan.route.feasible ? 'Blocked' : pace ? (pace.fits ? 'Fits' : 'Late') : events.polar === 'night' ? 'Dark' : 'Open';

  return <section className="plan-section globe-plan-pace" aria-labelledby="globe-pace-title">
    <div className="globe-plan-heading"><h2 id="globe-pace-title">Pace</h2><b className={pace?.fits ? 'is-ok' : 'is-caution'}>{verdict}</b></div>
    <div className="globe-pace-window" aria-label={daylight ? `Sunrise ${formatClock(events.sunriseLmst ?? 0)}, sunset ${formatClock(sunsetLmst ?? 0)}` : 'No daylight window'}>
      <span>{daylight ? formatClock(events.sunriseLmst ?? 0) : 'No daylight'}</span>
      <input type="range" min="0" max="1000" step="1" value={sliderValue} onChange={(event) => setDepart(start + Number(event.target.value) / 1000 * (end - start))} aria-label="Departure time" />
      <span>{daylight ? formatClock(sunsetLmst ?? 0) : 'window'}</span>
    </div>
    <div className="globe-pace-values"><span>Depart <b>{formatClock(departLmst)}</b></span><span>Needed <b>{pace ? paceLabel(pace.requiredSPerKm) : '—'}</b></span><span>Expected <b>{pace ? paceLabel(pace.expectedSPerKm) : '—'}</b></span></div>
    <small>Back by {backBy === null ? '—' : formatClock(localMeanSolarTime(backBy, plan.start.lon))} · 30 min reserve</small>
  </section>;
};
