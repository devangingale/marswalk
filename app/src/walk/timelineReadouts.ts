// Written with AI assistance, directed and reviewed by the team.

/**
 * Pure timeline readouts: sunset countdown and temperature along the walk.
 * Consumes lib/sun.ts (Mars24 sun events and LMST) and lib/pace.ts (diurnal temperature curve).
 */

import { localMeanSolarTime, MARS_SOL_MS, sunEvents } from '../lib/sun';
import { recommendedStart, startWindow, temperatureAt } from '../lib/pace';

/** Standard epoch for Mars demo sol: Gale sol 4995 (2026-08-25). */
export const DEFAULT_SOL_START_UTC_MS = Date.UTC(2026, 7, 25, 0, 0, 0);

/** Default diurnal temperature extrema (°C) for Mars sites when unmeasured. */
export const SITE_TEMPERATURE_DEFAULTS_C: Record<string, { tMinC: number; tMaxC: number }> = {
  gale: { tMinC: -80, tMaxC: -14 },
  jezero: { tMinC: -79.3, tMaxC: -24.7 },
};

export const DEFAULT_TEMPERATURE_C = { tMinC: -80, tMaxC: -14 };

/** Mars warmest hour of sol in LMST (peak insolation and thermal response). */
export const WARMEST_LMST = 13.5;

/** Formats a sunset countdown in seconds into human-readable compact text. */
export function formatSunsetCountdown(remainingS: number | null): string {
  if (remainingS === null) return 'No sunset';
  if (remainingS <= 0) return 'Past sunset';
  const total = Math.round(remainingS);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min to sunset`;
  if (m > 0) return `${m} min to sunset`;
  return `${s} s to sunset`;
}

/** Formats an estimated temperature in Celsius into human-readable compact text. */
export function formatTimelineTemp(tempC: number | null): string {
  if (tempC === null || !Number.isFinite(tempC)) return '–';
  const rounded = Math.round(tempC);
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded)} °C`;
}

export interface TimelineReadoutOptions {
  elapsedS: number;
  durationS: number;
  lat: number;
  lon: number;
  siteId?: string;
  timeLimitS?: number;
  solStartUtcMs?: number;
  tMinC?: number;
  tMaxC?: number;
  warmestLmst?: number;
}

export interface TimelineReadouts {
  departUtcMs: number;
  currentUtcMs: number;
  remainingToSunsetS: number | null;
  sunsetFormatted: string;
  tempC: number | null;
  tempFormatted: string;
}

/**
 * Computes exact sunset countdown and surface temperature along the walk replay.
 */
export function timelineReadoutsAt(opts: TimelineReadoutOptions): TimelineReadouts {
  const {
    elapsedS,
    durationS,
    lat,
    lon,
    siteId = 'gale',
    timeLimitS = 28800,
    solStartUtcMs = DEFAULT_SOL_START_UTC_MS,
    warmestLmst = WARMEST_LMST,
  } = opts;

  const siteDefaults = SITE_TEMPERATURE_DEFAULTS_C[siteId] ?? DEFAULT_TEMPERATURE_C;
  const tMinC = opts.tMinC ?? siteDefaults.tMinC;
  const tMaxC = opts.tMaxC ?? siteDefaults.tMaxC;

  const events = sunEvents(solStartUtcMs, lat, lon);

  let departUtcMs: number;
  if (events.sunriseUtcMs !== null && events.sunsetUtcMs !== null && events.sunriseLmst !== null) {
    const deltaHours = ((warmestLmst - events.sunriseLmst) % 24 + 24) % 24;
    const warmestUtcMs = events.sunriseUtcMs + deltaHours * (MARS_SOL_MS / 24);
    const window = startWindow(events, durationS, timeLimitS);
    departUtcMs = window ? recommendedStart(window, durationS, warmestUtcMs) : events.sunriseUtcMs + 1800 * 1000;
  } else if (events.polar === 'day') {
    departUtcMs = solStartUtcMs + 3600 * 1000;
  } else {
    departUtcMs = solStartUtcMs;
  }

  const currentUtcMs = departUtcMs + Math.max(0, elapsedS) * 1000;

  let remainingToSunsetS: number | null = null;
  if (events.sunsetUtcMs !== null) {
    remainingToSunsetS = Math.round((events.sunsetUtcMs - currentUtcMs) / 1000);
  }

  const sunsetFormatted = formatSunsetCountdown(remainingToSunsetS);

  let tempC: number | null = null;
  if (events.sunriseLmst !== null) {
    const nowLmst = localMeanSolarTime(currentUtcMs, lon);
    tempC = temperatureAt(nowLmst, tMinC, tMaxC, events.sunriseLmst, warmestLmst);
  } else if (events.polar === 'day') {
    tempC = (tMinC + tMaxC) / 2;
  }

  const tempFormatted = formatTimelineTemp(tempC);

  return {
    departUtcMs,
    currentUtcMs,
    remainingToSunsetS,
    sunsetFormatted,
    tempC,
    tempFormatted,
  };
}
