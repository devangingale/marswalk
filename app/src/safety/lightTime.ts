// Written with AI assistance, directed and reviewed by the team.

/**
 * One-way Earth<->Mars light time, for the SOS Earth-arrival estimate
 * (design: "SOS and relay scheduler"; relay.md row 9 gives the physical band,
 * about 3 min at closest to 22.4 min at farthest).
 *
 * Mars's heliocentric ecliptic position comes from the Mars24 series already in
 * sun.ts (heliocentric longitude lM, latitude bM, distance rM in AU). Earth's
 * comes from the low-precision solar-coordinate formulae in the Astronomical
 * Almanac (U.S. Naval Observatory, "Approximate Solar Coordinates"), good to
 * about an arcminute. The light-time constant is 1 AU = 499.004784 s
 * (IAU 2012 / JPL): 8.31675 min per AU. No figure here is invented.
 */

import { calculateMarsParameters } from '../lib/sun';
import { degToRad } from '../lib/grid';

/** One-way light time for 1 AU, in minutes (499.004784 s). */
export const LIGHT_MINUTES_PER_AU = 499.004784 / 60;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Heliocentric ecliptic rectangular position from spherical (AU, degrees). */
function toRect(rAu: number, lonDeg: number, latDeg: number): Vec3 {
  const lon = degToRad(lonDeg);
  const lat = degToRad(latDeg);
  return {
    x: rAu * Math.cos(lat) * Math.cos(lon),
    y: rAu * Math.cos(lat) * Math.sin(lon),
    z: rAu * Math.sin(lat),
  };
}

/** Earth's heliocentric ecliptic position (AU) from the almanac solar formulae. */
function earthHeliocentric(utcMs: number): Vec3 {
  const { dtJ2000 } = calculateMarsParameters(utcMs, 0, 0);
  // Sun's geocentric mean anomaly and mean longitude (degrees).
  const g = degToRad(357.529 + 0.98560028 * dtJ2000);
  const L = 280.459 + 0.98564736 * dtJ2000;
  // Sun's apparent ecliptic longitude (degrees).
  const lambdaSun = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  // Earth-Sun distance (AU).
  const rEarth = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  // Earth sits opposite the Sun as seen from the Sun: heliocentric lon = lambda + 180.
  return toRect(rEarth, lambdaSun + 180, 0);
}

/** Mars's heliocentric ecliptic position (AU) from the Mars24 series. */
function marsHeliocentric(utcMs: number): Vec3 {
  const p = calculateMarsParameters(utcMs, 0, 0);
  return toRect(p.rMAu, p.lMDeg, p.bMDeg);
}

/** Earth<->Mars distance at `utcMs`, in AU. */
export function earthMarsDistanceAu(utcMs: number): number {
  const e = earthHeliocentric(utcMs);
  const m = marsHeliocentric(utcMs);
  return Math.hypot(m.x - e.x, m.y - e.y, m.z - e.z);
}

/** One-way Earth<->Mars light time at `utcMs`, in minutes. */
export function oneWayLightMinutes(utcMs: number): number {
  return earthMarsDistanceAu(utcMs) * LIGHT_MINUTES_PER_AU;
}
