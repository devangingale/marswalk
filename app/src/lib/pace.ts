// Written with AI assistance, directed and reviewed by the team.

/**
 * Pace, daylight window, and temperature modeling for Mars EVA planning.
 */

export interface SunEvents {
  sunriseUtcMs: number | null;
  sunsetUtcMs: number | null;
  sunriseLmst: number | null;
  sunsetLmst: number | null;
}

/**
 * Computes the return-to-base deadline (UTC timestamp in ms).
 * Returns the earlier of (sunset - reserve) and (depart + time limit).
 * When sunset is null (e.g. polar day), returns depart + time limit.
 */
export function deadline(
  sunsetUtcMs: number | null,
  departUtcMs: number,
  timeLimitS: number,
  reserveS = 1800
): number | null {
  const timeLimitDeadline = departUtcMs + timeLimitS * 1000;
  if (sunsetUtcMs === null) {
    return timeLimitDeadline;
  }
  const sunsetDeadline = sunsetUtcMs - reserveS * 1000;
  return Math.min(sunsetDeadline, timeLimitDeadline);
}

/**
 * Calculates the allowable departure window { earliestUtcMs, latestUtcMs }.
 *
 * Rules:
 * - earliest = sunrise + sunriseMarginS.
 * - latest = (sunset - reserveS) - totalTimeS.
 * - Requires totalTimeS <= timeLimitS.
 * - Returns null when latest < earliest or when there is no daylight window (polar night: both sunrise and sunset null).
 * - For polar day (no sunset): the window is [sunrise + margin, earliest + (timeLimitS - totalTimeS)].
 */
export function startWindow(
  events: SunEvents,
  totalTimeS: number,
  timeLimitS: number,
  reserveS = 1800,
  sunriseMarginS = 1800
): { earliestUtcMs: number; latestUtcMs: number } | null {
  if (totalTimeS > timeLimitS) {
    return null;
  }
  if (events.sunriseUtcMs === null) {
    return null;
  }

  const earliestUtcMs = events.sunriseUtcMs + sunriseMarginS * 1000;

  if (events.sunsetUtcMs === null) {
    // Polar day rule: with no sunset, departure window allows finishing within the EVA time limit
    const latestUtcMs = earliestUtcMs + (timeLimitS - totalTimeS) * 1000;
    if (latestUtcMs < earliestUtcMs) {
      return null;
    }
    return { earliestUtcMs, latestUtcMs };
  }

  const latestUtcMs = events.sunsetUtcMs - reserveS * 1000 - totalTimeS * 1000;
  if (latestUtcMs < earliestUtcMs) {
    return null;
  }

  return { earliestUtcMs, latestUtcMs };
}

/**
 * Recommends an optimal departure time (UTC ms) so that the walk's midpoint
 * coincides with the warmest time of day (warmestUtcMs), clamped to the allowable window.
 */
export function recommendedStart(
  window: { earliestUtcMs: number; latestUtcMs: number },
  totalTimeS: number,
  warmestUtcMs: number
): number {
  const midpointOffsetMs = (totalTimeS * 1000) / 2;
  const idealStartUtcMs = warmestUtcMs - midpointOffsetMs;
  return Math.min(Math.max(idealStartUtcMs, window.earliestUtcMs), window.latestUtcMs);
}

/**
 * Evaluates whether a planned route fits within the available daylight/EVA budget.
 *
 * - required = available walking time / km where available = deadline - depart - stopTime.
 * - expected = walkTimeS / km.
 * - spare = deadline - (depart + walkTime + stopTime).
 * - fits = spare >= 0.
 */
export function paceCheck(
  walkDistanceM: number,
  walkTimeS: number,
  stopTimeS: number,
  departUtcMs: number,
  deadlineUtcMs: number
): { requiredSPerKm: number; expectedSPerKm: number; spareS: number; fits: boolean } {
  const distanceKm = walkDistanceM / 1000;
  const availableTimeS = (deadlineUtcMs - departUtcMs) / 1000 - stopTimeS;
  const spareS = (deadlineUtcMs - departUtcMs) / 1000 - (walkTimeS + stopTimeS);
  const fits = spareS >= 0;

  const requiredSPerKm = distanceKm > 0 ? availableTimeS / distanceKm : 0;
  const expectedSPerKm = distanceKm > 0 ? walkTimeS / distanceKm : 0;

  return {
    requiredSPerKm,
    expectedSPerKm,
    spareS,
    fits,
  };
}

/**
 * Estimated surface temperature at a given Local Mean Solar Time (LMST) hour.
 *
 * Diurnal curve estimation: minimum at sunrise, maximum at warmestLmst,
 * with half-cosine rise between them and half-cosine fall from warmest to next sunrise (24 h later).
 *
 * NOTE: This is an idealized diurnal curve estimate from daily min/max, not an in-situ measurement.
 */
export function temperatureAt(
  lmstHours: number,
  tMinC: number,
  tMaxC: number,
  sunriseLmst: number,
  warmestLmst: number
): number {
  const h = ((lmstHours % 24) + 24) % 24;
  const elapsedSinceSunrise = ((h - sunriseLmst) % 24 + 24) % 24;
  const riseDuration = ((warmestLmst - sunriseLmst) % 24 + 24) % 24;
  const fallDuration = 24 - riseDuration;

  if (elapsedSinceSunrise <= riseDuration) {
    // Daytime warming: half-cosine rise from tMinC to tMaxC
    const u = riseDuration > 0 ? elapsedSinceSunrise / riseDuration : 0;
    return tMinC + ((tMaxC - tMinC) * (1 - Math.cos(u * Math.PI))) / 2;
  } else {
    // Afternoon / nocturnal cooling: half-cosine fall from tMaxC to tMinC
    const elapsedSinceWarmest = elapsedSinceSunrise - riseDuration;
    const v = fallDuration > 0 ? elapsedSinceWarmest / fallDuration : 0;
    return tMinC + ((tMaxC - tMinC) * (1 + Math.cos(v * Math.PI))) / 2;
  }
}

/**
 * Formats pace in seconds per kilometer as "MM:SS /km", rounding to the nearest second.
 */
export function formatPace(sPerKm: number): string {
  if (!Number.isFinite(sPerKm) || sPerKm < 0) {
    return '--:-- /km';
  }
  const totalSeconds = Math.round(sPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
}
