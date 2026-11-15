// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { computeMissionTiming } from './mission';
import { sunElevationDeg } from '../lib/sun';

describe('computeMissionTiming (Gale)', () => {
  const t = computeMissionTiming({
    lat: -4.5895,
    lonEastDeg: 137.4417,
    baseUtcMs: Date.UTC(2026, 10, 14, 12, 0),
    walkDurationS: 84 * 60,
    timeLimitS: 8 * 3600,
  });

  it('orders dawn, departure, now, back-by and sunset', () => {
    expect(t.sunriseUtcMs).toBeLessThan(t.departUtcMs);
    expect(t.departUtcMs).toBeLessThan(t.missionNowMs);
    expect(t.missionNowMs).toBeLessThan(t.backByMs);
    expect(t.backByMs).toBeLessThan(t.sunsetUtcMs);
  });

  it('keeps the back-by at or before the sunset reserve (the binding limit wins)', () => {
    // The earlier of (sunset − 30 min reserve) and (depart + 8 h EVA limit).
    expect(t.backByMs).toBeLessThanOrEqual(t.sunsetUtcMs - 30 * 60000);
    expect(t.backByMs).toBe(t.departUtcMs + 8 * 3600 * 1000);
  });

  it('anchors now in daylight (sun above the horizon)', () => {
    expect(sunElevationDeg(t.missionNowMs, -4.5895, 137.4417)).toBeGreaterThan(0);
  });

  it('keeps now inside the real Nov-Dec 2026 passes window', () => {
    expect(t.missionNowMs).toBeGreaterThan(Date.UTC(2026, 10, 1));
    expect(t.missionNowMs).toBeLessThan(Date.UTC(2026, 11, 31));
  });
});
