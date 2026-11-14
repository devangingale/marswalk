// Written with AI assistance, directed and reviewed by the team.

/**
 * Night-contingency navigation (design: "Night contingency"). Pure functions:
 *  - distance and bearing between two fixes in the local-metre frame;
 *  - the way back for darkness, preferring the track already walked: the walked
 *    track reversed from the current position;
 *  - the next hazard on that way back;
 *  - whether the night contingency is triggered by the ladder's numbers.
 */

import { MARS_R, degToRad, radToDeg } from '../lib/grid';
import type { TrackVertex } from '../walk/track';

export interface LonLat {
  lon: number;
  lat: number;
}

function wrapLon(delta: number): number {
  const w = delta % 360;
  return w >= 180 ? w - 360 : w < -180 ? w + 360 : w;
}

/**
 * Straight-line distance (metres) and bearing (degrees clockwise from north)
 * from `a` to `b`, on the Mars sphere with an equirectangular projection about
 * the mean latitude (the same frame as the telemetry adapter).
 */
export function distanceBearing(a: LonLat, b: LonLat): { distanceM: number; bearingDeg: number } {
  const latMid = degToRad((a.lat + b.lat) / 2);
  const east = MARS_R * Math.cos(latMid) * degToRad(wrapLon(b.lon - a.lon));
  const north = MARS_R * degToRad(b.lat - a.lat);
  const distanceM = Math.hypot(east, north);
  if (distanceM === 0) return { distanceM: 0, bearingDeg: 0 };
  return { distanceM, bearingDeg: (radToDeg(Math.atan2(east, north)) + 360) % 360 };
}

export interface NightReturn {
  /** From the current fix back to the start of the walked track. */
  line: LonLat[];
  /** Length of `line`, metres. */
  lengthM: number;
}

/**
 * The way back for darkness over the walked track: the current fix, then every
 * walked vertex behind it (along the track, strictly before `alongM`) in reverse,
 * ending at the track start. Ground already walked is known ground, so the night
 * return prefers it to the rest of the planned loop.
 */
export function nightReturnRoute(walked: TrackVertex[], alongM: number, here: LonLat): NightReturn {
  const line: LonLat[] = [{ lon: here.lon, lat: here.lat }];
  for (let i = walked.length - 1; i >= 0; i--) {
    const v = walked[i];
    if (v.along_m >= alongM) continue;
    line.push({ lon: v.lon, lat: v.lat });
  }
  let lengthM = 0;
  for (let i = 1; i < line.length; i++) lengthM += distanceBearing(line[i - 1], line[i]).distanceM;
  return { line, lengthM };
}

export interface ReturnHazard extends LonLat {
  /** Distance along the way back to the hazard, metres. */
  alongReturnM: number;
}

/**
 * The first hazard on the way back: the flagged walked vertex nearest behind the
 * crew (along <= `alongM`), measured back along the track. Hazards still ahead
 * on the outward route are not on the way back. Null when there is none.
 */
export function nextHazardOnReturn(walked: TrackVertex[], flags: boolean[], alongM: number): ReturnHazard | null {
  for (let i = Math.min(walked.length, flags.length) - 1; i >= 0; i--) {
    const v = walked[i];
    if (v.along_m > alongM || !flags[i]) continue;
    return { lon: v.lon, lat: v.lat, alongReturnM: alongM - v.along_m };
  }
  return null;
}

export type NightTrigger = 'out-at-back-by' | 'arrival-after-sunset';

/**
 * Night contingency trigger (design): the crew is still out at the back-by time,
 * or the projected arrival is after sunset. Takes the ladder's signed minutes.
 */
export function nightTrigger(r: { minutesToBackBy: number; arrivalAfterSunsetMin: number }): NightTrigger | null {
  if (r.minutesToBackBy <= 0) return 'out-at-back-by';
  if (r.arrivalAfterSunsetMin > 0) return 'arrival-after-sunset';
  return null;
}
