// Written with AI assistance, directed and reviewed by the team.

/**
 * Replays a plan (contracts section 7) along route.legs[].line.
 * Positions and headings come from the line in local metres (contracts section 3);
 * distances, times and budgets come from the leg fields and route totals,
 * never from the map library.
 */

import { GridOrigin, lonlatToLocalMetres } from '../lib/grid';
import { Plan, PlanLeg } from '../lib/plan';

export const START_ID = 'start';

export interface TrackVertex {
  lon: number;
  lat: number;
  x_m: number;
  y_m: number;
  /** Distance along the line from the route start, in metres. */
  along_m: number;
}

export interface TrackLeg {
  legIndex: number;
  leg: PlanLeg;
  firstVertex: number;
  lastVertex: number;
  startTimeS: number;
  /** Time spent at `leg.to` after arriving; 0 when `leg.to` is the start. */
  dwellS: number;
  dwellEnergyKj: number;
}

export interface RouteTrack {
  vertices: TrackVertex[];
  legs: TrackLeg[];
  durationS: number;
  turnBackAlongM: number | null;
}

export interface Waypoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  note?: string;
}

export interface BudgetUse {
  time_s: number;
  energy_kj: number;
  dose_mgy: number;
}

export interface NextWaypoint {
  id: string;
  distanceM: number;
  timeS: number;
}

export interface WalkState {
  elapsedS: number;
  lon: number;
  lat: number;
  headingDeg: number;
  alongM: number;
  /** The waypoint the walker is standing at (dwelling, or back at the start), else null. */
  atWaypointId: string | null;
  next: NextWaypoint | null;
  used: BudgetUse;
  /** null when the plan has no turn-back point. */
  turnBackPassed: boolean | null;
}

export interface BudgetLine {
  used: number;
  total: number;
  remaining: number;
  /** Whether `total` is a plan limit or the planned total. */
  basis: 'limit' | 'plan';
}

export interface BudgetRemaining {
  time: BudgetLine;
  energy: BudgetLine;
  dose: BudgetLine;
}

function dwellFor(plan: Plan, waypointId: string): number {
  const stop = plan.stops.find((s) => s.id === waypointId);
  if (!stop) return 0;
  return stop.dwell_s ?? plan.params.stop_time_s;
}

export function waypointById(plan: Plan, id: string): Waypoint {
  if (id === START_ID) {
    return { id, name: plan.start.label, lon: plan.start.lon, lat: plan.start.lat };
  }
  const stop = plan.stops.find((s) => s.id === id);
  if (!stop) {
    throw new Error(`Plan has no stop with id '${id}'`);
  }
  return { id, name: stop.name, lon: stop.lon, lat: stop.lat, note: stop.note };
}

/**
 * Builds the replay track. Legs without a line (unreachable stops) are left out.
 * Energy spent while dwelling is the part of `totals.energy_kj` not carried by the
 * legs, shared between stops in proportion to their dwell time, so the replay ends
 * exactly on the plan totals.
 */
export function buildTrack(plan: Plan, origin: GridOrigin): RouteTrack {
  const walkable = plan.route.legs
    .map((leg, legIndex) => ({ leg, legIndex }))
    .filter(({ leg }) => leg.line.length >= 2);

  const legEnergyKj = plan.route.legs.reduce((sum, leg) => sum + leg.energy_kj, 0);
  const dwellEnergyPoolKj = plan.route.totals.energy_kj - legEnergyKj;
  const totalDwellS = walkable.reduce((sum, { leg }) => sum + dwellFor(plan, leg.to), 0);

  const vertices: TrackVertex[] = [];
  const legs: TrackLeg[] = [];
  let alongM = 0;
  let timeS = 0;

  for (const { leg, legIndex } of walkable) {
    const firstVertex = vertices.length;
    leg.line.forEach(([lon, lat], j) => {
      const { x_m, y_m } = lonlatToLocalMetres(lon, lat, origin);
      if (j > 0) {
        const prev = vertices[vertices.length - 1];
        alongM += Math.hypot(x_m - prev.x_m, y_m - prev.y_m);
      }
      vertices.push({ lon, lat, x_m, y_m, along_m: alongM });
    });

    const dwellS = dwellFor(plan, leg.to);
    legs.push({
      legIndex,
      leg,
      firstVertex,
      lastVertex: vertices.length - 1,
      startTimeS: timeS,
      dwellS,
      dwellEnergyKj: totalDwellS > 0 ? (dwellEnergyPoolKj * dwellS) / totalDwellS : 0,
    });
    timeS += leg.time_s + dwellS;
  }

  return {
    vertices,
    legs,
    durationS: timeS,
    turnBackAlongM: turnBackAlong(plan, legs, vertices, origin),
  };
}

function turnBackAlong(
  plan: Plan,
  legs: TrackLeg[],
  vertices: TrackVertex[],
  origin: GridOrigin
): number | null {
  const turnBack = plan.route.turn_back;
  if (!turnBack) return null;
  const trackLeg = legs.find((l) => l.legIndex === turnBack.leg);
  if (!trackLeg) return null;

  const target = lonlatToLocalMetres(turnBack.lon, turnBack.lat, origin);
  let best = trackLeg.firstVertex;
  let bestDist = Infinity;
  for (let i = trackLeg.firstVertex; i <= trackLeg.lastVertex; i++) {
    const d = Math.hypot(vertices[i].x_m - target.x_m, vertices[i].y_m - target.y_m);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return vertices[best].along_m;
}

function bearingDeg(a: TrackVertex, b: TrackVertex): number {
  const deg = (Math.atan2(b.x_m - a.x_m, b.y_m - a.y_m) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Heading of the last segment of positive length ending at or before `index`. */
function headingInto(vertices: TrackVertex[], first: number, index: number): number {
  for (let i = index; i > first; i--) {
    if (vertices[i].along_m > vertices[i - 1].along_m) {
      return bearingDeg(vertices[i - 1], vertices[i]);
    }
  }
  return 0;
}

/** Position and heading at `alongM`, clamped to the vertex range of one leg. */
export function pointAlong(
  vertices: TrackVertex[],
  first: number,
  last: number,
  alongM: number
): { lon: number; lat: number; headingDeg: number } {
  for (let i = first; i < last; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (b.along_m > a.along_m && b.along_m >= alongM) {
      const f = Math.min(1, Math.max(0, (alongM - a.along_m) / (b.along_m - a.along_m)));
      return {
        lon: a.lon + f * (b.lon - a.lon),
        lat: a.lat + f * (b.lat - a.lat),
        headingDeg: bearingDeg(a, b),
      };
    }
  }
  const end = vertices[last];
  return { lon: end.lon, lat: end.lat, headingDeg: headingInto(vertices, first, last) };
}

/** Where the walker is, what comes next and what has been used, `elapsedS` into the replay. */
export function walkStateAt(plan: Plan, track: RouteTrack, elapsedS: number): WalkState {
  const t = Math.min(Math.max(elapsedS, 0), track.durationS);
  const totals = plan.route.totals;
  const doseMgy = track.durationS > 0 ? totals.dose_mgy * (t / track.durationS) : 0;

  let energyBeforeKj = 0;
  for (let k = 0; k < track.legs.length; k++) {
    const tl = track.legs[k];
    const walkEndS = tl.startTimeS + tl.leg.time_s;
    const dwellEndS = walkEndS + tl.dwellS;
    const firstAlong = track.vertices[tl.firstVertex].along_m;
    const lastAlong = track.vertices[tl.lastVertex].along_m;

    if (t < walkEndS) {
      const f = (t - tl.startTimeS) / tl.leg.time_s;
      const alongM = firstAlong + f * (lastAlong - firstAlong);
      const point = pointAlong(track.vertices, tl.firstVertex, tl.lastVertex, alongM);
      return {
        elapsedS: t,
        ...point,
        alongM,
        atWaypointId: null,
        next: { id: tl.leg.to, distanceM: tl.leg.distance_m * (1 - f), timeS: tl.leg.time_s * (1 - f) },
        used: { time_s: t, energy_kj: energyBeforeKj + f * tl.leg.energy_kj, dose_mgy: doseMgy },
        turnBackPassed: passed(track, alongM),
      };
    }

    if (t < dwellEndS) {
      const following = track.legs[k + 1];
      const dwellFraction = (t - walkEndS) / tl.dwellS;
      const end = track.vertices[tl.lastVertex];
      return {
        elapsedS: t,
        lon: end.lon,
        lat: end.lat,
        headingDeg: headingInto(track.vertices, tl.firstVertex, tl.lastVertex),
        alongM: lastAlong,
        atWaypointId: tl.leg.to,
        next: following
          ? { id: following.leg.to, distanceM: following.leg.distance_m, timeS: dwellEndS - t + following.leg.time_s }
          : null,
        used: {
          time_s: t,
          energy_kj: energyBeforeKj + tl.leg.energy_kj + dwellFraction * tl.dwellEnergyKj,
          dose_mgy: doseMgy,
        },
        turnBackPassed: passed(track, lastAlong),
      };
    }

    energyBeforeKj += tl.leg.energy_kj + tl.dwellEnergyKj;
  }

  const lastLeg = track.legs[track.legs.length - 1];
  if (!lastLeg) {
    return {
      elapsedS: 0,
      lon: plan.start.lon,
      lat: plan.start.lat,
      headingDeg: 0,
      alongM: 0,
      atWaypointId: START_ID,
      next: null,
      used: { time_s: 0, energy_kj: 0, dose_mgy: 0 },
      turnBackPassed: null,
    };
  }
  const end = track.vertices[lastLeg.lastVertex];
  return {
    elapsedS: t,
    lon: end.lon,
    lat: end.lat,
    headingDeg: headingInto(track.vertices, lastLeg.firstVertex, lastLeg.lastVertex),
    alongM: end.along_m,
    atWaypointId: lastLeg.leg.to,
    next: null,
    used: { time_s: t, energy_kj: energyBeforeKj, dose_mgy: doseMgy },
    turnBackPassed: passed(track, end.along_m),
  };
}

function passed(track: RouteTrack, alongM: number): boolean | null {
  return track.turnBackAlongM === null ? null : alongM > track.turnBackAlongM;
}

/**
 * Remaining budget. Time is measured against the plan's time limit; energy against
 * its energy limit when one is set, otherwise against the planned total; dose against
 * the planned total (the plan carries no dose limit).
 */
export function budgetRemaining(plan: Plan, used: BudgetUse): BudgetRemaining {
  const line = (u: number, total: number, basis: BudgetLine['basis']): BudgetLine => ({
    used: u,
    total,
    remaining: total - u,
    basis,
  });
  const energyLimit = plan.params.energy_limit_kj;
  return {
    time: line(used.time_s, plan.params.time_limit_s, 'limit'),
    energy:
      energyLimit === undefined
        ? line(used.energy_kj, plan.route.totals.energy_kj, 'plan')
        : line(used.energy_kj, energyLimit, 'limit'),
    dose: line(used.dose_mgy, plan.route.totals.dose_mgy, 'plan'),
  };
}
