// Written with AI assistance, directed and reviewed by the team.

import { useMemo } from 'react';
import './directions.css';
import type { GridOrigin } from '../lib/grid';
import type { Plan } from '../lib/plan';
import { solStartAt, sunEvents, sunPosition } from '../lib/sun';
import { formatLocalClock } from '../safety/format';
import {
  buildDirections,
  directionsAt,
  formatBearing,
  instructionText,
  sunSide,
  sunText,
  type DirectionsNow,
  type RouteDirections,
} from '../walk/directions';
import { formatDistance } from '../walk/format';
import type { RouteTrack, WalkState } from '../walk/track';

/** Tooltip wording for every bearing: Mars has no magnetic field, so bearings are true north. */
export function trueNorthTitle(deg: number, compass: string): string {
  return `Bearing ${formatBearing(deg)} ${compass} (true north). Mars has no magnetic field, so bearings are measured from true north.`;
}

export function useRouteDirections(plan: Plan, track: RouteTrack, origin: GridOrigin): RouteDirections {
  return useMemo(() => buildDirections(plan, track, origin), [plan, track, origin]);
}

export function useDirectionsNow(
  plan: Plan,
  track: RouteTrack,
  origin: GridOrigin,
  state: Pick<WalkState, 'lon' | 'lat' | 'alongM' | 'next'>,
): DirectionsNow {
  const directions = useRouteDirections(plan, track, origin);
  return directionsAt(directions, track, state, plan, origin);
}

/** An arrow turned by the relative turn: straight up is straight on. */
export function TurnArrow({ deg, className }: { deg: number; className?: string }) {
  return (
    <svg className={className} viewBox="-24 -24 48 48" aria-hidden="true" focusable="false">
      <g transform={`rotate(${Math.round(deg)})`}>
        <path d="M0 -20 L13 -4 L5 -4 L5 18 L-5 18 L-5 -4 L-13 -4 Z" />
      </g>
    </svg>
  );
}

/** Short words for the Visor: "40 m · turn right". */
export function compactDirections(now: DirectionsNow): string {
  return instructionText(now, formatDistance).replace(/^In (.+?), /, '$1 · ').replace(/^Now, /, 'Now · ');
}

interface DirectionsPanelProps {
  plan: Plan;
  track: RouteTrack;
  origin: GridOrigin;
  state: WalkState;
  /** Mission clock (UTC ms) for the Sun; omitted while the safety layer is not ready. */
  nowUtcMs?: number;
  lat: number;
  lonEast: number;
}

/** The Directions block at the top of the Walk Stop panel. */
export function DirectionsPanel({ plan, track, origin, state, nowUtcMs, lat, lonEast }: DirectionsPanelProps) {
  const now = useDirectionsNow(plan, track, origin, state);
  const instruction = instructionText(now, formatDistance);
  const target = now.target;

  return (
    <section className="s48-walk-section s48-directions" aria-label="Directions">
      <h3>Directions</h3>
      <div className="s48-directions-main">
        <TurnArrow deg={now.next ? now.relativeTurnDeg : 0} className="s48-directions-arrow" />
        <p className="s48-directions-instruction" aria-live="polite">
          {instruction}
        </p>
      </div>
      {target && (
        <p className="s48-directions-target" title={trueNorthTitle(target.bearingDeg, target.compass)}>
          {target.label === 'the shelter' ? 'Shelter' : target.label} · {formatDistance(target.distanceM)} · bearing{' '}
          {formatBearing(target.bearingDeg)} {target.compass}
        </p>
      )}
      {nowUtcMs !== undefined && <SunLine nowUtcMs={nowUtcMs} lat={lat} lonEast={lonEast} walkingBearingDeg={now.walkingBearingDeg} />}
    </section>
  );
}

function SunLine({
  nowUtcMs,
  lat,
  lonEast,
  walkingBearingDeg,
}: {
  nowUtcMs: number;
  lat: number;
  lonEast: number;
  walkingBearingDeg: number;
}) {
  const sun = sunPosition(nowUtcMs, lat, lonEast);
  const side = sunSide(sun.azimuthDeg, sun.elevationDeg, walkingBearingDeg);
  // The sol's sunrise and sunset, recomputed only when the walk crosses into another sol.
  const solKey = Math.round(solStartAt(nowUtcMs, lonEast) / 60000);
  const events = useMemo(() => sunEvents(solKey * 60000, lat, lonEast), [solKey, lat, lonEast]);

  return (
    <div className="s48-directions-sun">
      <p
        title={`Sun azimuth ${formatBearing(sun.azimuthDeg)} (true north), ${Math.round(sun.elevationDeg)}° above the horizon. Relative to the way you are walking.`}
      >
        {sunText(side)}
        {side && <span> · azimuth {formatBearing(sun.azimuthDeg)}</span>}
      </p>
      {(events.sunriseUtcMs !== null || events.sunsetUtcMs !== null) && (
        <p className="s48-directions-sol" title="Local mean solar time at the site">
          {events.sunriseUtcMs !== null && <>Sunrise {formatLocalClock(events.sunriseUtcMs, lonEast)}</>}
          {events.sunriseUtcMs !== null && events.sunsetUtcMs !== null && ' · '}
          {events.sunsetUtcMs !== null && <>Sunset {formatLocalClock(events.sunsetUtcMs, lonEast)}</>}
        </p>
      )}
    </div>
  );
}
