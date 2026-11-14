// Written with AI assistance, directed and reviewed by the team.
//
// Pure day/night theme logic for the globe page. No DOM, no clock, no React:
// every input is passed in, so the thresholds, hysteresis, hold time and
// warning deferral can be tested at exact values.
//
// Two visual token sets back the themes (app/src/styles/tokens.css):
//   - 'day'   -> the light, high-contrast set (data-theme="day" / "light")
//   - 'night' -> the dark, low-glare set       (data-theme="night" / "dark")
// Twilight is shown with the night set, so it resolves to the 'night' theme.

/** The applied visual theme: which token set the page renders with. */
export type Theme = 'day' | 'night';

/** Stepped sun phase at the crew's site. Twilight renders with the night set. */
export type SunPhase = 'day' | 'twilight' | 'night';

/** Header mode switch: Earth (pre-mission planning) or Mars (at the site). */
export type GlobeMode = 'earth' | 'mars';

/** Manual theme control. 'auto' defers to the mode; 'day'/'night' force a set. */
export type ThemeOverride = 'auto' | 'day' | 'night';

/** The device's OS light/dark setting, used by Earth mode's Auto. */
export type DeviceScheme = 'light' | 'dark';

export interface GlobePreferences {
  mode: GlobeMode;
  override: ThemeOverride;
}

/** Read the globe mode and theme override from a URL query string. */
export function globePreferencesFromSearch(search: string): GlobePreferences {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  const override = params.get('theme');
  return {
    mode: mode === 'mars' ? 'mars' : 'earth',
    override: override === 'day' || override === 'night' ? override : 'auto',
  };
}

/** Update globe preferences while preserving the rest of the URL query. */
export function globeSearchWithPreferences(search: string, preferences: GlobePreferences): string {
  const params = new URLSearchParams(search);
  params.set('mode', preferences.mode);
  params.set('theme', preferences.override);
  return params.toString();
}

/** Sun elevation above which the site is in full day (degrees). */
export const DAY_ELEV_DEG = 6;

/** Sun elevation below which the site is in night; between the two is twilight. */
export const TWILIGHT_ELEV_DEG = -6;

/**
 * Deadband width (degrees) around the day/night theme boundary. The two switch
 * points sit half of this each side of DAY_ELEV_DEG, so the theme does not
 * chatter when the sun hovers near the boundary.
 */
export const HYSTERESIS_DEG = 2;

/** Rising past this elevation turns a night theme to day (DAY_ELEV_DEG + 1). */
export const DAY_ON_ELEV_DEG = DAY_ELEV_DEG + HYSTERESIS_DEG / 2;

/** Falling past this elevation turns a day theme to night (DAY_ELEV_DEG − 1). */
export const DAY_OFF_ELEV_DEG = DAY_ELEV_DEG - HYSTERESIS_DEG / 2;

/** A candidate switch must hold this long before it is applied (10 minutes). */
export const HOLD_MS = 10 * 60 * 1000;

export interface ThemeDecisionInput {
  /** The theme currently applied. */
  current: Theme;
  /** Sun elevation at the crew's site, in degrees. Used by Mars-mode Auto. */
  sunElevationDeg: number;
  /** A warning is being shown: automatic switches are deferred until it clears. */
  warningActive: boolean;
  /** Header mode. */
  mode: GlobeMode;
  /** The device's OS light/dark setting. Used by Earth-mode Auto. */
  deviceScheme: DeviceScheme;
  /** Manual control. Always wins over Auto. */
  override: ThemeOverride;
  /** When the current candidate first differed from `current` (epoch ms). */
  heldSinceMs: number;
  /** The current time (epoch ms). */
  nowMs: number;
}

/** Stepped sun phase from an elevation. Boundaries are inclusive toward day. */
export function sunPhase(sunElevationDeg: number): SunPhase {
  if (sunElevationDeg >= DAY_ELEV_DEG) return 'day';
  if (sunElevationDeg >= TWILIGHT_ELEV_DEG) return 'twilight';
  return 'night';
}

/** The token set a sun phase renders with. Twilight uses the night set. */
export function themeForPhase(phase: SunPhase): Theme {
  return phase === 'day' ? 'day' : 'night';
}

/**
 * The theme Mars-mode Auto wants from the sun alone, with hysteresis applied
 * against the current theme. This is the target before the hold time is checked.
 */
export function marsCandidate(current: Theme, sunElevationDeg: number): Theme {
  if (current === 'night') {
    return sunElevationDeg >= DAY_ON_ELEV_DEG ? 'day' : 'night';
  }
  return sunElevationDeg <= DAY_OFF_ELEV_DEG ? 'night' : 'day';
}

/**
 * Decide the theme for the next frame. Pure: identical inputs give identical
 * output. Precedence:
 *   1. Manual override (day/night) always wins, even during a warning.
 *   2. Earth-mode Auto follows the device scheme.
 *   3. Mars-mode Auto follows the sun with hysteresis, but only after the hold
 *      time, and never while a warning is active.
 */
export function nextTheme(input: ThemeDecisionInput): Theme {
  const { current, override, mode, deviceScheme, warningActive, sunElevationDeg, heldSinceMs, nowMs } = input;

  // 1. Manual override always wins.
  if (override === 'day') return 'day';
  if (override === 'night') return 'night';

  // 2. Earth mode follows the device's light/dark setting.
  if (mode === 'earth') {
    return deviceScheme === 'dark' ? 'night' : 'day';
  }

  // 3. Mars mode: sun-driven. Never switch while a warning is shown.
  if (warningActive) return current;

  const candidate = marsCandidate(current, sunElevationDeg);
  if (candidate === current) return current;

  // A switch must have held for the full hold time before it is applied.
  return nowMs - heldSinceMs >= HOLD_MS ? candidate : current;
}

/** The data-theme attribute value for a theme (the design-system token set). */
export function themeAttr(theme: Theme): 'day' | 'night' {
  return theme;
}
