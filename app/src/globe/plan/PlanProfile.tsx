import React, { useMemo } from 'react';
import type { RouteGrid } from '../../lib/grid';
import type { Plan } from '../../lib/plan';
import { sampleProfile } from '../../plan/planLogic';

interface Props {
  plan: Plan;
  grid: RouteGrid | null;
  activePoint: { lon: number; lat: number } | null;
  onHover: (point: { lon: number; lat: number } | null) => void;
}

export const PlanProfile: React.FC<Props> = ({ plan, grid, activePoint, onHover }) => {
  const profile = useMemo(() => {
    if (!grid) return [];
    const line = plan.route.legs.flatMap((leg, index) => index ? leg.line.slice(1) : leg.line);
    return sampleProfile(grid, line);
  }, [grid, plan.route.legs]);
  const maxDistance = profile.at(-1)?.distanceM ?? 0;
  const minElevation = profile.length ? Math.min(...profile.map((sample) => sample.elevationM)) : 0;
  const maxElevation = profile.length ? Math.max(...profile.map((sample) => sample.elevationM)) : 0;
  const x = (distance: number) => 38 + (maxDistance ? distance / maxDistance : 0) * 312;
  const y = (elevation: number) => 65 - ((elevation - minElevation) / Math.max(1, maxElevation - minElevation)) * 48;
  const points = profile.map((sample) => `${x(sample.distanceM)},${y(sample.elevationM)}`).join(' ');
  const activeSample = activePoint && grid ? profile.reduce<{ lon: number; lat: number; distance: number } | null>((best, sample) => {
    const p = grid.lonlatToLocalMetres(sample.lon, sample.lat);
    const h = grid.lonlatToLocalMetres(activePoint.lon, activePoint.lat);
    const distance = Math.hypot(p.x_m - h.x_m, p.y_m - h.y_m);
    return !best || distance < best.distance ? { lon: sample.lon, lat: sample.lat, distance } : best;
  }, null) : null;
  const activeIndex = activeSample ? profile.findIndex((sample) => sample.lon === activeSample.lon && sample.lat === activeSample.lat) : -1;

  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!profile.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const target = ratio * maxDistance;
    const nearest = profile.reduce((best, sample) => Math.abs(sample.distanceM - target) < Math.abs(best.distanceM - target) ? sample : best);
    onHover({ lon: nearest.lon, lat: nearest.lat });
  };

  return <section className="plan-section globe-plan-profile" aria-labelledby="globe-profile-title">
    <h2 id="globe-profile-title">Elevation</h2>
    <svg viewBox="0 0 360 88" role="img" aria-label="Elevation along route" onPointerMove={pick} onPointerLeave={() => onHover(null)}>
      <defs><linearGradient id="profile-grade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--map-grade-3)" stopOpacity=".65" /><stop offset="100%" stopColor="var(--map-grade-1)" stopOpacity=".12" /></linearGradient></defs>
      <line x1="38" y1="12" x2="38" y2="65" className="profile-axis" />
      <line x1="38" y1="65" x2="350" y2="65" className="profile-axis" />
      {profile.length > 1 && <>
        <polygon points={`38,65 ${points} 350,65`} fill="url(#profile-grade)" />
        <polyline points={points} className="profile-line" />
        {activeIndex >= 0 && <circle cx={x(profile[activeIndex].distanceM)} cy={y(profile[activeIndex].elevationM)} r="4" className="globe-profile-cursor" />}
        <text x="0" y="16" className="profile-label">{Math.round(maxElevation)} m</text>
        <text x="0" y="65" className="profile-label">{Math.round(minElevation)} m</text>
        <text x="38" y="82" className="profile-label">0 m</text>
        <text x="350" y="82" textAnchor="end" className="profile-label">{maxDistance >= 1000 ? `${(maxDistance / 1000).toFixed(1)} km` : `${Math.round(maxDistance)} m`}</text>
      </>}
    </svg>
  </section>;
};
