// Written with AI assistance, directed and reviewed by the team.

/**
 * Simulated telemetry adapter (design: "Hardware links" -> "Simulated (demo)").
 *
 * Replays the plan with plausible suit readings and a rover that waits at the
 * drop-off. Every value is plain data and `simulated` is true, so screens can
 * label it "simulated". No React, no DOM, no timers: snapshots are a pure
 * function of the injected `clock()`.
 *
 * Sourced constants (see docs/research):
 * - EVA duration: planned walk time plus 1 h secondary O2 that is NOT planned
 *   into the walk. NASA Exploration EVA System ConOps, EVA-EXP-0042 Rev B
 *   (NTRS 20205008200): "EVAs of up to 8 hours ... with an additional 1 hour of
 *   secondary/backup O2 for off-nominal operations" (eva-limits.md row 7). O2
 *   and suit power fall linearly to zero across planned-duration + 1 h.
 * - Dead-reckoning drift: foot-IMU ZUPT dead reckoning is 1.5-2.3 % of distance
 *   walked (positioning-hardware.md row 5); we use 2 %.
 * - Re-fix floor: Perseverance resets position uncertainty to 1-2 m by matching
 *   its camera panorama to the HiRISE orbital map (positioning-hardware.md row
 *   1); we floor uncertainty at 2 m and reset near the rover/habitat.
 * - Rover speed: no NASA Mars crewed-rover speed is published; the only crewed
 *   pressurised-rover figure is the JAXA/Toyota lunar concept, 15 km/h max,
 *   explicitly notional (rover-mobility.md row 31 / positioning-hardware.md T7).
 *   We use it as the default and LABEL it as a lunar, notional assumption.
 */

import { Plan } from './plan';
import { MARS_R, degToRad, radToDeg } from './grid';
import { RouteTrack, walkStateAt, pointAlong } from '../walk/track';
import { TelemetryAdapter, TelemetrySnapshot, RoverCommand, CommandReceipt } from './telemetry';

/** 1 h secondary/backup O2 reserve, not planned into the walk (EVA-EXP-0042). */
export const EVA_SECONDARY_O2_S = 3600;

/** Dead-reckoning drift as a fraction of distance walked (2 %; positioning-hardware.md row 5). */
export const DEAD_RECKON_FRAC = 0.02;

/** Position uncertainty floor / re-fix value, metres (Perseverance 1-2 m; row 1). */
export const FIX_FLOOR_M = 2;

/**
 * Radius around the rover (and, where known, the habitat) within which the
 * crew gets a re-fix and uncertainty resets to the floor. PLACEHOLDER: no
 * sourced re-fix radius was found, so this is a labelled assumption.
 */
export const REFIX_RADIUS_M = 15;

/** Default crew spacing: the second crew member trails 3 m behind the lead. */
export const CREW_SPACING_M = 3;

/**
 * Default rover speed, m/s. 15 km/h from the JAXA/Toyota pressurised-rover
 * concept (lunar, notional; rover-mobility.md row 31). LABELLED assumption: no
 * published NASA Mars crewed-rover speed exists.
 */
export const DEFAULT_ROVER_SPEED_M_S = 15000 / 3600; // = 4.1666... m/s

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function longitudeDelta(delta: number): number {
  const wrapped = delta % 360;
  return wrapped >= 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped;
}

/**
 * Straight-line distance between two lon/lat points in the local-metre frame,
 * using the Mars sphere (radius MARS_R) and an equirectangular projection about
 * the mean latitude of the two points (design: local-metre frame, Mars radius
 * 3396190 m).
 */
export function localMetreDistance(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number }
): number {
  const latMid = degToRad((a.lat + b.lat) / 2);
  const east = MARS_R * Math.cos(latMid) * degToRad(longitudeDelta(b.lon - a.lon));
  const north = MARS_R * degToRad(a.lat - b.lat);
  return Math.hypot(east, north);
}

/** Bearing from `a` to `b`, degrees clockwise from north. */
function bearingDeg(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const latMid = degToRad((a.lat + b.lat) / 2);
  const east = MARS_R * Math.cos(latMid) * degToRad(longitudeDelta(b.lon - a.lon));
  const north = MARS_R * degToRad(b.lat - a.lat);
  if (east === 0 && north === 0) return 0;
  return (radToDeg(Math.atan2(east, north)) + 360) % 360;
}

export interface SimulatedAdapterOptions {
  /** Rover speed, m/s. Default DEFAULT_ROVER_SPEED_M_S. */
  roverSpeedMS?: number;
  /** Crew member ids. Default ['EV1', 'EV2'] (two crew). */
  crewIds?: string[];
}

/**
 * Builds a simulated telemetry adapter for `plan`/`track`. `clock()` returns the
 * current wall-clock time in milliseconds; elapsed walk time is measured from
 * the clock value captured at creation.
 */
export function createSimulatedAdapter(
  plan: Plan,
  track: RouteTrack,
  clock: () => number,
  options?: SimulatedAdapterOptions
): TelemetryAdapter {
  const roverSpeedMS = options?.roverSpeedMS ?? DEFAULT_ROVER_SPEED_M_S;
  const crewIds = options?.crewIds ?? ['EV1', 'EV2'];
  const t0 = clock();
  const lastVertex = track.vertices.length - 1;
  // The rover waits at the drop-off (the plan start).
  const rover = { lon: plan.start.lon, lat: plan.start.lat };

  const subscribers = new Set<(s: TelemetrySnapshot) => void>();
  let logSeq = 0;

  function crewPointAt(alongM: number): { lon: number; lat: number } {
    if (lastVertex < 1) return { lon: plan.start.lon, lat: plan.start.lat };
    const p = pointAlong(track.vertices, 0, lastVertex, Math.max(0, alongM));
    return { lon: p.lon, lat: p.lat };
  }

  function snapshot(tMs: number): TelemetrySnapshot {
    const elapsedS = (tMs - t0) / 1000;

    // Suit consumables fall linearly over planned duration + 1 h secondary O2.
    const lifeS = track.durationS + EVA_SECONDARY_O2_S;
    const usedFrac = clamp(elapsedS / lifeS, 0, 1);
    const o2Pct = 100 * (1 - usedFrac);
    const powerPct = 100 * (1 - usedFrac);

    const state = walkStateAt(plan, track, elapsedS);
    const moving = state.atWaypointId === null;
    const leadAlong = state.alongM;

    const crew = crewIds.map((id, i) => {
      const alongM = Math.max(0, leadAlong - i * CREW_SPACING_M);
      const pos = crewPointAt(alongM);
      const nearAnchor = localMetreDistance(pos, rover) <= REFIX_RADIUS_M;
      const uncertaintyM = nearAnchor ? FIX_FLOOR_M : FIX_FLOOR_M + DEAD_RECKON_FRAC * alongM;
      return {
        id,
        lon: pos.lon,
        lat: pos.lat,
        uncertaintyM,
        suit: {
          o2Pct,
          powerPct,
          tempC: 21, // SUITS suit-temperature range 10-32 C; steady nominal value
          heartRate: moving ? 108 : 72, // SUITS range 50-160 bpm; walking vs resting
        },
      };
    });

    const lead = crew.length > 0 ? { lon: crew[0].lon, lat: crew[0].lat } : rover;
    const roverToCrewM = localMetreDistance(rover, lead);

    return {
      tMs,
      crew,
      rover: {
        lon: rover.lon,
        lat: rover.lat,
        headingDeg: bearingDeg(rover, lead),
        batteryPct: 100,
        etaToCrewS: roverSpeedMS > 0 ? roverToCrewM / roverSpeedMS : null,
      },
      // The habitat receives everything live over the always-on local link.
      habitatLink: 'live',
    };
  }

  function emit(): void {
    const s = snapshot(clock());
    for (const cb of subscribers) cb(s);
  }

  function routeLengthM(route: [number, number][]): number {
    let total = 0;
    for (let i = 1; i < route.length; i++) {
      total += localMetreDistance(
        { lon: route[i - 1][0], lat: route[i - 1][1] },
        { lon: route[i][0], lat: route[i][1] }
      );
    }
    return total;
  }

  function command(c: RoverCommand): Promise<CommandReceipt> {
    const logId = `sim-cmd-${logSeq++}`;
    let receipt: CommandReceipt;

    if (c.kind === 'send_route') {
      if (c.route.length < 2) {
        receipt = { accepted: false, etaS: null, reason: 'route needs at least two points', logId };
      } else {
        receipt = { accepted: true, etaS: routeLengthM(c.route) / roverSpeedMS, logId };
      }
    } else {
      // come_to_me / drive_to: drive from the drop-off to the point.
      if (!Number.isFinite(c.lon) || !Number.isFinite(c.lat)) {
        receipt = { accepted: false, etaS: null, reason: 'target is not a valid position', logId };
      } else {
        const distanceM = localMetreDistance(rover, { lon: c.lon, lat: c.lat });
        receipt = { accepted: true, etaS: distanceM / roverSpeedMS, logId };
      }
    }

    // Issuing a command changes device state; push a fresh snapshot.
    emit();
    return Promise.resolve(receipt);
  }

  return {
    simulated: true,
    subscribe(cb: (s: TelemetrySnapshot) => void): () => void {
      subscribers.add(cb);
      cb(snapshot(clock()));
      return () => {
        subscribers.delete(cb);
      };
    },
    command,
  };
}
