// Written with AI assistance, directed and reviewed by the team.

/**
 * Demo mission timing for the safety layer. Anchors a believable daytime EVA at
 * the crew's site: a dawn-plus-margin departure, the real sunrise and sunset
 * from sun.ts, the turn-back deadline from pace.ts, and a "now" set partway
 * through the walk. Pure over its inputs, so the anchor is deterministic and the
 * screenshots are stable. Every value it produces is a simulated-mission value.
 */

import { MARS_SOL_MS, localMeanSolarTime, sunEvents } from '../lib/sun';
import { deadline } from '../lib/pace';

/** Minutes after sunrise that the EVA departs (start window = sunrise + 30 min). */
export const DEPART_AFTER_SUNRISE_MIN = 90;
/** Fraction of the walk already completed at the anchored "now". */
export const NOW_WALK_FRACTION = 0.4;
/** Return-to-base reserve before sunset, seconds (pace.ts default). */
export const RESERVE_S = 1800;

export interface MissionTiming {
  solStartUtcMs: number;
  sunriseUtcMs: number;
  sunsetUtcMs: number;
  /** EVA departure (UTC ms). */
  departUtcMs: number;
  /** Turn-back deadline (UTC ms): latest time to start home within the budget. */
  backByMs: number;
  /** Anchored current mission time (UTC ms), partway through the walk. */
  missionNowMs: number;
}

/**
 * Builds the mission timing for a site. `baseUtcMs` seeds the sol (the real
 * clock, clamped by the caller into the passes window); the sol is shifted so it
 * starts near local 04:00, giving a clean dawn-to-dusk bracket.
 */
export function computeMissionTiming(opts: {
  lat: number;
  lonEastDeg: number;
  baseUtcMs: number;
  walkDurationS: number;
  timeLimitS: number;
}): MissionTiming {
  const lmst = localMeanSolarTime(opts.baseUtcMs, opts.lonEastDeg);
  const shiftHours = ((lmst - 4) % 24 + 24) % 24;
  const solStartUtcMs = opts.baseUtcMs - shiftHours * (MARS_SOL_MS / 24);

  const ev = sunEvents(solStartUtcMs, opts.lat, opts.lonEastDeg);
  // Gale and Jezero are near the equator, so both events exist every sol.
  const sunriseUtcMs = ev.sunriseUtcMs ?? solStartUtcMs + MARS_SOL_MS * 0.25;
  const sunsetUtcMs = ev.sunsetUtcMs ?? solStartUtcMs + MARS_SOL_MS * 0.75;

  const departUtcMs = sunriseUtcMs + DEPART_AFTER_SUNRISE_MIN * 60000;
  const backByMs = deadline(sunsetUtcMs, departUtcMs, opts.timeLimitS, RESERVE_S) ?? sunsetUtcMs;
  const missionNowMs = departUtcMs + NOW_WALK_FRACTION * opts.walkDurationS * 1000;

  return { solStartUtcMs, sunriseUtcMs, sunsetUtcMs, departUtcMs, backByMs, missionNowMs };
}
