// Written with AI assistance, directed and reviewed by the team.

/**
 * Turn-by-turn directions along the plan route, for Walk and Visor.
 *
 * The route lines are smoothed in the local-metre frame (lib/grid lonlatToLocalMetres,
 * through the replay track) so wiggles under SMOOTH_TOLERANCE_M are ignored; turn points
 * are where the smoothed bearing changes. Bearings are degrees clockwise from true north:
 * Mars has no global magnetic field, so there is no magnetic bearing to give.
 */

import type { GridOrigin } from '../lib/grid';
import { lonlatToLocalMetres } from '../lib/grid';
import type { Plan } from '../lib/plan';
import { bearingDeg } from '../globe/routeLook';
import { headingFromTrack } from '../globe/walk/cameraMath';
import { START_ID, type RouteTrack, type TrackVertex, type WalkState } from './track';

/** Sideways wiggles smaller than this are smoothed away. */
export const SMOOTH_TOLERANCE_M = 10;
/** Bends closer together than this are read as one turn. */
export const MERGE_DISTANCE_M = 25;
/** Bearing changes under this are "continue": no turn point. */
export const CONTINUE_MAX_DEG = 20;
export const BEAR_MAX_DEG = 60;
export const TURN_MAX_DEG = 135;
/** From this change on the instruction reads "turn around". */
export const TURN_AROUND_DEG = 170;

export type TurnKind =
  | 'continue'
  | 'bear-left'
  | 'bear-right'
  | 'turn-left'
  | 'turn-right'
  | 'sharp-left'
  | 'sharp-right';

export type ManeuverKind = TurnKind | 'arrive-stop' | 'arrive-shelter';

export interface Maneuver {
  kind: ManeuverKind;
  /** Distance along the route from its start, in metres (the replay track's along_m). */
  alongM: number;
  lon: number;
  lat: number;
  /** Signed bearing change at this point, degrees, positive to the right; 0 on arrival. */
  turnDeg: number;
  /** Bearing after the maneuver (on arrival, the bearing walked into the stop), degrees from true north. */
  bearingDeg: number;
  /** 16-point text for bearingDeg (N, NNE, NE ...). */
  compass: string;
  /** The stop this maneuver leads to: a stop id, or 'start' for the shelter. */
  targetId: string;
  /** "Stop 2" or "the shelter". */
  targetLabel: string;
  /** The stop's name, or "Shelter". */
  targetName: string;
}

export interface SmoothedSegment {
  fromAlongM: number;
  toAlongM: number;
  bearingDeg: number;
}

export interface RouteDirections {
  maneuvers: Maneuver[];
  /** The smoothed route, in walking order. */
  segments: SmoothedSegment[];
}

export interface TargetBearing {
  id: string;
  label: string;
  name: string;
  /** Straight-line distance from the walker, metres. */
  distanceM: number;
  bearingDeg: number;
  compass: string;
}

export interface DirectionsNow {
  next: Maneuver | null;
  distanceToNextM: number;
  /** Bearing of the smoothed route under the walker, degrees from true north. */
  walkingBearingDeg: number;
  /** Signed change from the walking bearing to the bearing after the next maneuver, positive right. */
  relativeTurnDeg: number;
  /** The next stop (or the shelter) as the crow flies; null at the end of the route. */
  target: TargetBearing | null;
}

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed difference to - from in (-180, 180], positive clockwise (to the right). */
export function signedTurn(fromDeg: number, toDeg: number): number {
  const d = normalizeBearing(toDeg - fromDeg);
  return d > 180 ? d - 360 : d;
}

export function compass16(deg: number): string {
  return COMPASS_16[Math.round(normalizeBearing(deg) / 22.5) % 16];
}

/** "045°": a true-north bearing as three digits. */
export function formatBearing(deg: number): string {
  return `${String(Math.round(normalizeBearing(deg)) % 360).padStart(3, '0')}°`;
}

export function classifyTurn(turnDeg: number): TurnKind {
  const a = Math.abs(turnDeg);
  if (a < CONTINUE_MAX_DEG) return 'continue';
  const side = turnDeg > 0 ? 'right' : 'left';
  if (a < BEAR_MAX_DEG) return `bear-${side}`;
  if (a <= TURN_MAX_DEG) return `turn-${side}`;
  return `sharp-${side}`;
}

export function targetLabel(id: string, plan: Plan): { label: string; name: string } {
  if (id === START_ID) return { label: 'the shelter', name: 'Shelter' };
  const index = plan.stops.findIndex((s) => s.id === id);
  const stop = plan.stops[index];
  return { label: index >= 0 ? `Stop ${index + 1}` : id, name: stop?.name ?? id };
}

function offsetFromChord(p: TrackVertex, a: TrackVertex, b: TrackVertex): number {
  const dx = b.x_m - a.x_m;
  const dy = b.y_m - a.y_m;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x_m - a.x_m, p.y_m - a.y_m);
  return Math.abs(dx * (a.y_m - p.y_m) - dy * (a.x_m - p.x_m)) / len;
}

/** Douglas-Peucker over vertex indices first..last: the indices that survive the tolerance. */
export function simplifyIndices(vertices: TrackVertex[], first: number, last: number, toleranceM = SMOOTH_TOLERANCE_M): number[] {
  if (last <= first) return [first];
  const keep = new Set<number>([first, last]);
  const stack: [number, number][] = [[first, last]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let worstD = toleranceM;
    for (let k = i + 1; k < j; k++) {
      const d = offsetFromChord(vertices[k], vertices[i], vertices[j]);
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep.add(worst);
      stack.push([i, worst], [worst, j]);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

function lonlat(v: TrackVertex): [number, number] {
  return [v.lon, v.lat];
}

/**
 * Maneuvers for the whole route: turn points inside each leg, an arrival at the end of each
 * leg, and the turn on leaving a stop when the next leg sets off in a new direction.
 */
export function buildDirections(plan: Plan, track: RouteTrack, origin: GridOrigin): RouteDirections {
  const maneuvers: Maneuver[] = [];
  const segments: SmoothedSegment[] = [];
  const v = track.vertices;
  let previousArrivalBearing: number | null = null;

  for (const tl of track.legs) {
    const target = targetLabel(tl.leg.to, plan);
    const keep = simplifyIndices(v, tl.firstVertex, tl.lastVertex);
    const legSegments: SmoothedSegment[] = [];
    /** The vertex each segment starts at: corners[s] joins segment s-1 to segment s. */
    const corners: number[] = [];
    for (let n = 0; n + 1 < keep.length; n++) {
      const a = v[keep[n]];
      const b = v[keep[n + 1]];
      // Points on top of each other carry no bearing.
      if (b.along_m <= a.along_m) continue;
      legSegments.push({ fromAlongM: a.along_m, toAlongM: b.along_m, bearingDeg: bearingDeg(lonlat(a), lonlat(b), origin) });
      corners.push(keep[n]);
    }
    if (!legSegments.length) continue;

    const make = (kind: ManeuverKind, vertex: TrackVertex, turnDeg: number, bearing: number, alongM = vertex.along_m): Maneuver => ({
      kind,
      alongM,
      lon: vertex.lon,
      lat: vertex.lat,
      turnDeg,
      bearingDeg: bearing,
      compass: compass16(bearing),
      targetId: tl.leg.to,
      targetLabel: target.label,
      targetName: target.name,
    });

    // Leaving a stop: the turn from the bearing walked in to the bearing walked out.
    if (previousArrivalBearing !== null) {
      const turn = signedTurn(previousArrivalBearing, legSegments[0].bearingDeg);
      const kind = classifyTurn(turn);
      if (kind !== 'continue') maneuvers.push(make(kind, v[tl.firstVertex], turn, legSegments[0].bearingDeg));
    }

    // Bends: neighbouring corners closer than MERGE_DISTANCE_M are read as one turn.
    let s = 0;
    while (s < legSegments.length - 1) {
      let e = s + 1;
      while (e < legSegments.length - 1 && legSegments[e].toAlongM - legSegments[e].fromAlongM < MERGE_DISTANCE_M) e++;
      const turn = signedTurn(legSegments[s].bearingDeg, legSegments[e].bearingDeg);
      const kind = classifyTurn(turn);
      if (kind !== 'continue') maneuvers.push(make(kind, v[corners[s + 1]], turn, legSegments[e].bearingDeg));
      s = e;
    }

    const arrival = legSegments[legSegments.length - 1].bearingDeg;
    maneuvers.push(make(tl.leg.to === START_ID ? 'arrive-shelter' : 'arrive-stop', v[tl.lastVertex], 0, arrival));
    previousArrivalBearing = arrival;
    segments.push(...legSegments);
  }

  return { maneuvers, segments };
}

const EPS_M = 1e-6;

/**
 * Bearing of the smoothed route at alongM. On a corner (or standing at a stop) it is the
 * bearing walked in on; at the route start, the bearing walked out on. The raw track heading
 * if no segment covers alongM.
 */
export function walkingBearingAt(directions: RouteDirections, track: RouteTrack, alongM: number): number {
  const seg =
    directions.segments.find((g) => alongM > g.fromAlongM + EPS_M && alongM <= g.toAlongM + EPS_M) ??
    directions.segments.find((g) => alongM >= g.fromAlongM - EPS_M && alongM <= g.toAlongM + EPS_M);
  return seg ? seg.bearingDeg : headingFromTrack(track.vertices, alongM);
}

/**
 * Directions for the walker at a replay state (track.ts walkStateAt): the next maneuver and
 * the distance to it along the route, the walking bearing, the relative turn, and the next
 * stop as the crow flies.
 */
export function directionsAt(
  directions: RouteDirections,
  track: RouteTrack,
  state: Pick<WalkState, 'lon' | 'lat' | 'alongM' | 'next'>,
  plan: Plan,
  origin: GridOrigin,
): DirectionsNow {
  const along = state.alongM;
  // An arrival under the walker is done; a turn under the walker (leaving a stop) is still ahead.
  const next =
    directions.maneuvers.find(
      (m) => m.alongM > along + EPS_M || (m.alongM >= along - EPS_M && !m.kind.startsWith('arrive')),
    ) ?? null;
  const walkingBearingDeg = walkingBearingAt(directions, track, along);

  let target: TargetBearing | null = null;
  if (state.next) {
    const stop = state.next.id === START_ID ? plan.start : plan.stops.find((s) => s.id === state.next!.id);
    if (stop) {
      const a = lonlatToLocalMetres(state.lon, state.lat, origin);
      const b = lonlatToLocalMetres(stop.lon, stop.lat, origin);
      const distanceM = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
      const bearing = distanceM > 0 ? bearingDeg([state.lon, state.lat], [stop.lon, stop.lat], origin) : walkingBearingDeg;
      const { label, name } = targetLabel(state.next.id, plan);
      target = { id: state.next.id, label, name, distanceM, bearingDeg: bearing, compass: compass16(bearing) };
    }
  }

  return {
    next,
    distanceToNextM: next ? Math.max(0, next.alongM - along) : 0,
    walkingBearingDeg,
    relativeTurnDeg: next ? signedTurn(walkingBearingDeg, next.bearingDeg) : 0,
    target,
  };
}

const TURN_WORDS: Record<TurnKind, string> = {
  continue: 'continue',
  'bear-left': 'bear left',
  'bear-right': 'bear right',
  'turn-left': 'turn left',
  'turn-right': 'turn right',
  'sharp-left': 'sharp left',
  'sharp-right': 'sharp right',
};

/** The action alone: "turn right", "turn around", "arrive at Stop 2". */
export function maneuverAction(m: Maneuver): string {
  if (m.kind === 'arrive-stop' || m.kind === 'arrive-shelter') return `arrive at ${m.targetLabel}`;
  if (Math.abs(m.turnDeg) >= TURN_AROUND_DEG) return 'turn around';
  return TURN_WORDS[m.kind];
}

/** "In 40 m, turn right"; "Now, turn around" once the turn is under the walker. */
export function instructionText(now: DirectionsNow, formatDistance: (m: number) => string): string {
  if (!now.next) return 'Route complete';
  const action = maneuverAction(now.next);
  if (now.distanceToNextM < 2.5) return `Now, ${action}`;
  return `In ${formatDistance(now.distanceToNextM)}, ${action}`;
}

export type SunSide =
  | 'ahead'
  | 'ahead-right'
  | 'right'
  | 'behind-right'
  | 'behind'
  | 'behind-left'
  | 'left'
  | 'ahead-left';

/** Elevation under which the Sun is no help for finding the way. */
export const SUN_USEFUL_MIN_DEG = 5;

const SUN_SIDES: SunSide[] = ['ahead', 'ahead-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'ahead-left'];

const SUN_WORDS: Record<SunSide, string> = {
  ahead: 'Sun ahead',
  'ahead-right': 'Sun ahead-right',
  right: 'Sun on your right',
  'behind-right': 'Sun behind-right',
  behind: 'Sun behind you',
  'behind-left': 'Sun behind-left',
  left: 'Sun on your left',
  'ahead-left': 'Sun ahead-left',
};

/** Where the Sun is relative to the walking bearing, in eight 45-degree sectors; null when it is down or below 5 degrees. */
export function sunSide(sunAzimuthDeg: number, sunElevationDeg: number, walkingBearingDeg: number): SunSide | null {
  if (sunElevationDeg < SUN_USEFUL_MIN_DEG) return null;
  const rel = normalizeBearing(sunAzimuthDeg - walkingBearingDeg);
  return SUN_SIDES[Math.round(rel / 45) % 8];
}

export function sunText(side: SunSide | null): string {
  return side ? SUN_WORDS[side] : 'Sun below the horizon';
}
