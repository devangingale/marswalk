// Written with AI assistance, directed and reviewed by the team.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOL_START_UTC_MS,
  formatSunsetCountdown,
  formatTimelineTemp,
  timelineReadoutsAt,
} from './timelineReadouts';

describe('formatSunsetCountdown', () => {
  it('handles null for polar day or missing sunset', () => {
    expect(formatSunsetCountdown(null)).toBe('No sunset');
  });

  it('handles zero or negative values when past sunset', () => {
    expect(formatSunsetCountdown(0)).toBe('Past sunset');
    expect(formatSunsetCountdown(-300)).toBe('Past sunset');
  });

  it('formats hours and minutes accurately with zero-padded minutes', () => {
    expect(formatSunsetCountdown(3600 * 2 + 15 * 60)).toBe('2 h 15 min to sunset');
    expect(formatSunsetCountdown(3600 * 1 + 5 * 60)).toBe('1 h 05 min to sunset');
    expect(formatSunsetCountdown(3600 * 4)).toBe('4 h 00 min to sunset');
  });

  it('formats minutes alone when under one hour', () => {
    expect(formatSunsetCountdown(45 * 60)).toBe('45 min to sunset');
    expect(formatSunsetCountdown(60)).toBe('1 min to sunset');
    expect(formatSunsetCountdown(119)).toBe('1 min to sunset');
  });

  it('formats seconds when under one minute', () => {
    expect(formatSunsetCountdown(45)).toBe('45 s to sunset');
    expect(formatSunsetCountdown(1)).toBe('1 s to sunset');
  });
});

describe('formatTimelineTemp', () => {
  it('formats null and non-finite values as en dash', () => {
    expect(formatTimelineTemp(null)).toBe('–');
    expect(formatTimelineTemp(Number.NaN)).toBe('–');
  });

  it('formats negative numbers with true minus sign', () => {
    expect(formatTimelineTemp(-42.4)).toBe('−42 °C');
    expect(formatTimelineTemp(-79.8)).toBe('−80 °C');
    expect(formatTimelineTemp(-0.2)).toBe('0 °C');
  });

  it('formats zero and positive temperatures', () => {
    expect(formatTimelineTemp(0)).toBe('0 °C');
    expect(formatTimelineTemp(14.2)).toBe('14 °C');
    expect(formatTimelineTemp(25.7)).toBe('26 °C');
  });
});

describe('timelineReadoutsAt', () => {
  const GALE_LAT = -4.5895;
  const GALE_LON = 137.4417;
  const DURATION_S = 7200; // 2 hours

  it('computes realistic countdown and temperature at Gale start', () => {
    const readouts = timelineReadoutsAt({
      elapsedS: 0,
      durationS: DURATION_S,
      lat: GALE_LAT,
      lon: GALE_LON,
      siteId: 'gale',
    });

    expect(readouts.departUtcMs).toBeGreaterThan(DEFAULT_SOL_START_UTC_MS);
    expect(readouts.remainingToSunsetS).not.toBeNull();
    expect(readouts.remainingToSunsetS!).toBeGreaterThan(DURATION_S);
    expect(readouts.sunsetFormatted).toMatch(/\d+ h \d{2} min to sunset/);
    expect(readouts.tempC).not.toBeNull();
    expect(readouts.tempC!).toBeGreaterThan(-85);
    expect(readouts.tempC!).toBeLessThan(0);
    expect(readouts.tempFormatted).toMatch(/−?\d+ °C/);
  });

  it('counts down accurately as elapsed time advances', () => {
    const start = timelineReadoutsAt({
      elapsedS: 0,
      durationS: DURATION_S,
      lat: GALE_LAT,
      lon: GALE_LON,
    });

    const elapsed = 3600;
    const mid = timelineReadoutsAt({
      elapsedS: elapsed,
      durationS: DURATION_S,
      lat: GALE_LAT,
      lon: GALE_LON,
    });

    expect(mid.remainingToSunsetS).toBe(start.remainingToSunsetS! - elapsed);
    expect(mid.currentUtcMs).toBe(start.currentUtcMs + elapsed * 1000);
  });

  it('handles polar day at high northern latitude near Ls 90', () => {
    // 85 N around summer solstice ~ 2027-04-15
    const summerSolsticeSolStart = Date.UTC(2027, 3, 15, 0, 0, 0);
    const readouts = timelineReadoutsAt({
      elapsedS: 0,
      durationS: 3600,
      lat: 85.0,
      lon: 0.0,
      solStartUtcMs: summerSolsticeSolStart,
    });

    expect(readouts.remainingToSunsetS).toBeNull();
    expect(readouts.sunsetFormatted).toBe('No sunset');
  });
});
