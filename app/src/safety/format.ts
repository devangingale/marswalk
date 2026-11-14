// Written with AI assistance, directed and reviewed by the team.

/**
 * Human number and time formatting for the safety layer (design: README section 2
 * "Numbers and units"). A no-break space (U+00A0) separates every number from its
 * unit and the real minus sign (U+2212) is used, so figures never jiggle or look
 * like hyphenated ranges.
 */

import { localMeanSolarTime } from '../lib/sun';

/** No-break space: always between a number and its unit. */
export const NBSP = ' ';
/** Real minus sign (U+2212), never a hyphen. */
export const MINUS = '−';

/** Pads an integer to two digits for a clock face. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Mars local mean solar time at `lonEastDeg` as a 24 h clock "HH:MM". Mission
 * clocks on Mars run on mean solar time (sun.ts localMeanSolarTime), the same
 * frame as the planned sunrise and sunset, so the strip and the ladder agree.
 */
export function formatLocalClock(utcMs: number, lonEastDeg: number): string {
  const hours = localMeanSolarTime(utcMs, lonEastDeg);
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) {
    m = 0;
    h = (h + 1) % 24;
  }
  return `${pad2(h)}:${pad2(m)}`;
}

/** A plain UTC 24 h clock "HH:MM", for the Earth-side receipt time. */
export function formatUtcClock(utcMs: number): string {
  const d = new Date(utcMs);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * A short duration as "H h MM min" / "N min" / "under 1 min", at minute
 * precision (these are live counters, not modelled estimates, so no "≈").
 * Negative inputs are clamped to zero.
 */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) return `under${NBSP}1${NBSP}min`;
  if (totalMin < 60) return `${totalMin}${NBSP}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h ${pad2(m)}${NBSP}min`;
}

/** A signed minute count as "N min" with a real minus sign for negatives. */
export function formatSignedMinutes(min: number): string {
  const r = Math.round(min);
  if (r < 0) return `${MINUS}${Math.abs(r)}${NBSP}min`;
  return `${r}${NBSP}min`;
}

/**
 * A signed duration from a minute count, humanised: "+2 h 05 min", "−20 min",
 * "0 min". Uses the real minus sign and rolls minutes into hours.
 */
export function formatSignedDuration(min: number): string {
  const r = Math.round(min);
  if (r === 0) return `0${NBSP}min`;
  const sign = r < 0 ? MINUS : '+';
  return `${sign}${formatDuration(Math.abs(r) * 60000)}`;
}

/**
 * Distance for a human: whole metres under 1 km, one decimal from 1 km
 * (design: README section 2). Measured on the ground, so no "≈".
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return `—`;
  if (metres < 1000) return `${Math.round(metres)}${NBSP}m`;
  return `${(metres / 1000).toFixed(1)}${NBSP}km`;
}
