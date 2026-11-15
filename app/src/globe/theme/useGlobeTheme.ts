import { useEffect, useState } from 'react';
import { sunElevationDeg } from '../../lib/sun';
import {
  globePreferencesFromSearch,
  marsCandidate,
  nextTheme,
  type DeviceScheme,
  type GlobeMode,
  type Theme,
  type ThemeOverride,
} from './theme';

function deviceScheme(): DeviceScheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function writeOverride(override: ThemeOverride): void {
  const params = new URLSearchParams(window.location.search);
  params.set('theme', override);
  // The open tab carries the mode now: Explore and Plan plan from Earth, Walk and Visor are at the site.
  params.delete('mode');
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

/**
 * Day or night token set for the whole app. The mode comes from the open tab: Earth for
 * Explore and Plan (Auto follows the device), Mars for Walk and Visor (Auto follows the sun at the site).
 */
export function useGlobeTheme(site: { lat: number; lon: number } | null, mode: GlobeMode) {
  const initial = globePreferencesFromSearch(window.location.search);
  const [override, setOverrideState] = useState<ThemeOverride>(initial.override);
  const [scheme, setScheme] = useState<DeviceScheme>(deviceScheme);
  const [theme, setTheme] = useState<Theme>(initial.override === 'night' ? 'night' : initial.override === 'day' ? 'day' : scheme === 'dark' ? 'night' : 'day');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setScheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let heldSinceMs = Date.now();
    let heldCandidate: Theme | null = null;
    const evaluate = () => {
      const nowMs = Date.now();
      const elevation = site ? sunElevationDeg(nowMs, site.lat, site.lon) : 0;
      const candidate = mode === 'mars' ? marsCandidate(theme, elevation) : null;
      if (candidate === theme) {
        heldCandidate = null;
        heldSinceMs = nowMs;
      } else if (candidate !== null && candidate !== heldCandidate) {
        heldCandidate = candidate;
        heldSinceMs = nowMs;
      }
      const next = nextTheme({
        current: theme,
        sunElevationDeg: elevation,
        warningActive: false,
        mode,
        deviceScheme: scheme,
        override,
        heldSinceMs,
        nowMs,
      });
      if (next !== theme) {
        setTheme(next);
        heldCandidate = null;
        heldSinceMs = nowMs;
      }
    };
    evaluate();
    const timer = window.setInterval(evaluate, 60_000);
    return () => window.clearInterval(timer);
  }, [mode, override, scheme, site?.lat, site?.lon, theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    return () => document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  const setOverride = (next: ThemeOverride) => {
    setOverrideState(next);
    writeOverride(next);
  };

  return { override, setOverride, theme };
}
