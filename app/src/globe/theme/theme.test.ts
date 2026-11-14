// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  DAY_ELEV_DEG,
  DAY_OFF_ELEV_DEG,
  DAY_ON_ELEV_DEG,
  globePreferencesFromSearch,
  globeSearchWithPreferences,
  HOLD_MS,
  HYSTERESIS_DEG,
  TWILIGHT_ELEV_DEG,
  marsCandidate,
  nextTheme,
  sunPhase,
  themeAttr,
  themeForPhase,
  type ThemeDecisionInput,
} from './theme';

/** A baseline Mars-mode Auto input; each test overrides only what it exercises. */
function input(partial: Partial<ThemeDecisionInput>): ThemeDecisionInput {
  return {
    current: 'night',
    sunElevationDeg: -30,
    warningActive: false,
    mode: 'mars',
    deviceScheme: 'dark',
    override: 'auto',
    heldSinceMs: 0,
    nowMs: HOLD_MS, // past the hold time by default, so switches are allowed
    ...partial,
  };
}

describe('constants', () => {
  it('fixes the stepped thresholds and hysteresis at the spec values', () => {
    expect(DAY_ELEV_DEG).toBe(6);
    expect(TWILIGHT_ELEV_DEG).toBe(-6);
    expect(HYSTERESIS_DEG).toBe(2);
    expect(DAY_ON_ELEV_DEG).toBe(7); // 6 + 2/2
    expect(DAY_OFF_ELEV_DEG).toBe(5); // 6 − 2/2
    expect(HOLD_MS).toBe(600000); // 10 min
  });
});

describe('sunPhase', () => {
  it('steps day / twilight / night at ±6°', () => {
    expect(sunPhase(20)).toBe('day');
    expect(sunPhase(6)).toBe('day'); // boundary is day
    expect(sunPhase(5.999)).toBe('twilight');
    expect(sunPhase(0)).toBe('twilight');
    expect(sunPhase(-6)).toBe('twilight'); // boundary is twilight
    expect(sunPhase(-6.001)).toBe('night');
    expect(sunPhase(-40)).toBe('night');
  });

  it('maps twilight and night to the night token set', () => {
    expect(themeForPhase('day')).toBe('day');
    expect(themeForPhase('twilight')).toBe('night');
    expect(themeForPhase('night')).toBe('night');
  });
});

describe('marsCandidate hysteresis', () => {
  it('turns night to day only once the sun is at or above +7°', () => {
    expect(marsCandidate('night', 6)).toBe('night'); // past +6 but inside the deadband
    expect(marsCandidate('night', 6.999)).toBe('night');
    expect(marsCandidate('night', 7)).toBe('day');
    expect(marsCandidate('night', 30)).toBe('day');
  });

  it('turns day to night only once the sun is at or below +5°', () => {
    expect(marsCandidate('day', 6)).toBe('day'); // below +6 but inside the deadband
    expect(marsCandidate('day', 5.001)).toBe('day');
    expect(marsCandidate('day', 5)).toBe('night');
    expect(marsCandidate('day', -30)).toBe('night');
  });

  it('holds its state inside the deadband (5°–7°)', () => {
    expect(marsCandidate('night', 6)).toBe('night');
    expect(marsCandidate('day', 6)).toBe('day');
  });
});

describe('nextTheme — manual override', () => {
  it('forces day regardless of everything else', () => {
    expect(nextTheme(input({ override: 'day', current: 'night', sunElevationDeg: -40, warningActive: true }))).toBe('day');
  });

  it('forces night regardless of everything else', () => {
    expect(nextTheme(input({ override: 'night', current: 'day', sunElevationDeg: 40, warningActive: true }))).toBe('night');
  });

  it('wins even in Earth mode', () => {
    expect(nextTheme(input({ mode: 'earth', override: 'day', deviceScheme: 'dark' }))).toBe('day');
    expect(nextTheme(input({ mode: 'earth', override: 'night', deviceScheme: 'light' }))).toBe('night');
  });
});

describe('nextTheme — Earth mode Auto', () => {
  it('follows the device scheme', () => {
    expect(nextTheme(input({ mode: 'earth', deviceScheme: 'light' }))).toBe('day');
    expect(nextTheme(input({ mode: 'earth', deviceScheme: 'dark' }))).toBe('night');
  });

  it('follows the device scheme immediately, ignoring sun and hold time', () => {
    expect(nextTheme(input({ mode: 'earth', deviceScheme: 'light', sunElevationDeg: -40, heldSinceMs: 0, nowMs: 0 }))).toBe('day');
  });
});

describe('nextTheme — Mars mode Auto, hold time', () => {
  it('does not switch before the candidate has held for 10 minutes', () => {
    const base = { current: 'night' as const, sunElevationDeg: 20, heldSinceMs: 1000 };
    expect(nextTheme(input({ ...base, nowMs: 1000 + HOLD_MS - 1 }))).toBe('night');
    expect(nextTheme(input({ ...base, nowMs: 1000 + HOLD_MS }))).toBe('day');
  });

  it('switches day to night after the hold time', () => {
    const base = { current: 'day' as const, sunElevationDeg: -10, heldSinceMs: 500 };
    expect(nextTheme(input({ ...base, nowMs: 500 + HOLD_MS - 1 }))).toBe('day');
    expect(nextTheme(input({ ...base, nowMs: 500 + HOLD_MS }))).toBe('night');
  });

  it('never resists staying put when the candidate equals the current theme', () => {
    // Candidate equals current, so the hold time is irrelevant: stay, immediately.
    expect(nextTheme(input({ current: 'night', sunElevationDeg: -20, heldSinceMs: 0, nowMs: 0 }))).toBe('night');
    expect(nextTheme(input({ current: 'day', sunElevationDeg: 20, heldSinceMs: 0, nowMs: 0 }))).toBe('day');
  });
});

describe('nextTheme — Mars mode Auto, warning deferral', () => {
  it('does not switch while a warning is active, even past the hold time', () => {
    expect(
      nextTheme(input({ current: 'night', sunElevationDeg: 30, warningActive: true, heldSinceMs: 0, nowMs: HOLD_MS * 10 })),
    ).toBe('night');
  });

  it('switches once the warning clears', () => {
    const base = { current: 'night' as const, sunElevationDeg: 30, heldSinceMs: 0, nowMs: HOLD_MS * 10 };
    expect(nextTheme(input({ ...base, warningActive: true }))).toBe('night');
    expect(nextTheme(input({ ...base, warningActive: false }))).toBe('day');
  });

  it('still honours a manual override during a warning', () => {
    expect(
      nextTheme(input({ current: 'night', sunElevationDeg: -40, warningActive: true, override: 'day' })),
    ).toBe('day');
  });
});

describe('nextTheme — Mars mode Auto, hysteresis at the boundary', () => {
  it('keeps the current theme inside the 5°–7° deadband', () => {
    expect(nextTheme(input({ current: 'night', sunElevationDeg: 6 }))).toBe('night');
    expect(nextTheme(input({ current: 'day', sunElevationDeg: 6 }))).toBe('day');
  });

  it('flips at the outer edges of the deadband', () => {
    expect(nextTheme(input({ current: 'night', sunElevationDeg: 7 }))).toBe('day');
    expect(nextTheme(input({ current: 'day', sunElevationDeg: 5 }))).toBe('night');
  });
});

describe('themeAttr', () => {
  it('returns the data-theme token-set name', () => {
    expect(themeAttr('day')).toBe('day');
    expect(themeAttr('night')).toBe('night');
  });
});

describe('globe URL preferences', () => {
  it('defaults invalid or missing preferences to Earth and Auto', () => {
    expect(globePreferencesFromSearch('?globe=1&mode=venus&theme=sepia')).toEqual({ mode: 'earth', override: 'auto' });
  });

  it('reads Mars and Night preferences exactly', () => {
    expect(globePreferencesFromSearch('?mode=mars&theme=night')).toEqual({ mode: 'mars', override: 'night' });
  });

  it('writes preferences and preserves existing globe state', () => {
    expect(globeSearchWithPreferences('?globe=1&layers=ice&view=1%2C2%2C3', { mode: 'mars', override: 'day' })).toBe(
      'globe=1&layers=ice&view=1%2C2%2C3&mode=mars&theme=day',
    );
  });
});
