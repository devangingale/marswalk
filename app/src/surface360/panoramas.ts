// Written with AI assistance, directed and reviewed by the team.
// The panoramas.json contract for the 360° surface view, as written by
// pipeline/build_panoramas.py, and the plain geometry the view needs (bearings, image columns).
// There is no built-in fallback: if the manifest does not load, the view is unavailable.
import { MARS_RADIUS_METERS, R2_BASE } from '../config';

export type Walkability = 'safe' | 'caution' | 'hazard';

export interface PanoramaStop {
  id: string;
  /** Photojournal title of the mosaic. */
  name: string;
  rover: string;
  mission: string;
  /** Sol the mosaic was taken (the first, for a mosaic taken over several sols). */
  sol: number;
  /** Last sol of a mosaic taken over several sols at one parked position, else null. */
  sol_end: number | null;
  /** "caption" when the caption states the sol; otherwise how it was derived (a stated capture date). */
  sol_source: string;
  /** Sol of the localized rover pose used for position; null for a cited explicit position. */
  pose_sol: number | null;
  /** Where lat/lon come from: the pose table and sol, or the citation for an explicit position. */
  position_source: string;
  /** Areocentric latitude and east longitude. */
  lat: number;
  lon_east: number;
  /** Elevation from the rover localization, metres; null where the source has none (Spirit, Opportunity). */
  height: number | null;
  /** Compass bearing of the image's centre column, degrees. */
  heading: number;
  /** Where heading comes from: "caption" (stated by NASA) or "rover yaw, sol N" (an approximation). */
  heading_source: string;
  pitch: number;
  roll: number;
  image_url: string;
  /** From a grids.py cost grid covering the stop; null when no grid covers it. */
  walkability: Walkability | null;
  slope_deg: number | null;
  walkability_source: string | null;
  /** passes.py SPICE bundle for the site (MRO and Odyssey); null when none is published. */
  passes_url: string | null;
  next_id: string | null;
  prev_id: string | null;
  /** Distance the rover drove from this stop's pose to the next stop's, metres. */
  drive_m_to_next: number | null;
  pia_id: string;
  instrument: string;
  /** Official Photojournal caption. */
  caption: string;
  credit: string;
  source_url: string;
}

export interface PanoramaManifest {
  stops: PanoramaStop[];
}

export interface LoadedManifest {
  manifest: PanoramaManifest;
  /** Base URL that relative image_url and passes_url values resolve against. */
  baseUrl: string;
}

/** Suited eye height above the ground, metres. */
export const EYE_HEIGHT_M = 1.8;
export const FOV_MIN_DEG = 20;
export const FOV_MAX_DEG = 90;
export const FOV_DEFAULT_DEG = 75;

/**
 * Where panoramas.json comes from: VITE_PANORAMAS_URL if set; in development the dev server's
 * copy (app/public); in production the R2 CDN that the data-refresh workflow keeps current.
 * A production build without VITE_R2_BASE_URL has no source, and the view says so.
 */
export function panoramasUrl(env: { DEV: boolean; VITE_PANORAMAS_URL?: string }, r2Base: string): string | null {
  if (env.VITE_PANORAMAS_URL) return env.VITE_PANORAMAS_URL;
  if (env.DEV) return '/panoramas.json';
  return r2Base ? `${r2Base}/panoramas.json` : null;
}

export const PANORAMAS_URL: string | null = panoramasUrl(import.meta.env, R2_BASE);

const WALKABILITY: readonly Walkability[] = ['safe', 'caution', 'hazard'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNullable = <T,>(v: unknown, test: (x: unknown) => x is T): v is T | null => v === null || test(v);

function isStop(v: unknown): v is PanoramaStop {
  const s = v as Record<string, unknown>;
  return (
    !!s &&
    [s.id, s.name, s.rover, s.mission, s.image_url, s.pia_id, s.instrument, s.caption, s.credit, s.source_url, s.heading_source, s.position_source, s.sol_source].every(isStr) &&
    isNullable(s.sol_end, isNum) &&
    [s.sol, s.lat, s.lon_east, s.heading, s.pitch, s.roll].every(isNum) &&
    isNullable(s.pose_sol, isNum) &&
    isNullable(s.height, isNum) &&
    (s.walkability === null || WALKABILITY.includes(s.walkability as Walkability)) &&
    isNullable(s.slope_deg, isNum) &&
    isNullable(s.walkability_source, isStr) &&
    isNullable(s.passes_url, isStr) &&
    isNullable(s.next_id, isStr) &&
    isNullable(s.prev_id, isStr) &&
    isNullable(s.drive_m_to_next, isNum)
  );
}

/** The manifest if it matches the contract, else null. Every stop must be valid and ids unique. */
export function parseManifest(value: unknown): PanoramaManifest | null {
  const stops = (value as { stops?: unknown } | null)?.stops;
  if (!Array.isArray(stops) || stops.length === 0 || !stops.every(isStop)) return null;
  if (new Set(stops.map((s) => s.id)).size !== stops.length) return null;
  return { stops };
}

/** The page URL that relative manifest paths resolve against. */
const pageUrl = () => globalThis.location?.href ?? 'http://localhost/';

/** Fetches and validates the manifest. Throws with a readable reason on any failure. */
export async function loadManifest(url: string | null = PANORAMAS_URL, fetcher: typeof fetch = fetch): Promise<LoadedManifest> {
  if (!url) throw new Error('this production build has no VITE_R2_BASE_URL, so there is no panoramas.json source');
  const baseUrl = new URL(url, pageUrl()).href;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`panoramas.json: HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('panoramas.json is not JSON');
  }
  const manifest = parseManifest(body);
  if (!manifest) throw new Error('panoramas.json does not match the contract');
  return { manifest, baseUrl };
}

export function resolveUrl(relative: string, baseUrl: string): string {
  return new URL(relative, baseUrl).href;
}

export function resolveImageUrl(stop: PanoramaStop, baseUrl: string): string {
  return resolveUrl(stop.image_url, baseUrl);
}

export function stopById(manifest: PanoramaManifest, id: string | null | undefined): PanoramaStop | undefined {
  return id ? manifest.stops.find((s) => s.id === id) : undefined;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

export interface LonLat {
  lon: number;
  lat: number;
}

/** Great-circle distance on the Mars sphere, metres. */
export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, degrees in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrap360(toDeg(Math.atan2(y, x)));
}

export const stopLonLat = (s: PanoramaStop): LonLat => ({ lon: s.lon_east, lat: s.lat });

/** The stop nearest a point, with its distance. */
export function nearestStop(manifest: PanoramaManifest, at: LonLat): { stop: PanoramaStop; distanceM: number } {
  let best = { stop: manifest.stops[0], distanceM: Infinity };
  for (const stop of manifest.stops) {
    const d = distanceM(at, stopLonLat(stop));
    if (d < best.distanceM) best = { stop, distanceM: d };
  }
  return best;
}

/**
 * Stops grouped into traverses by following next_id from each stop that has no valid
 * predecessor. A stop on a cycle or never reached is a traverse of its own.
 */
export function traverses(manifest: PanoramaManifest): PanoramaStop[][] {
  const byId = new Map(manifest.stops.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const chains: PanoramaStop[][] = [];
  const walk = (start: PanoramaStop) => {
    const chain: PanoramaStop[] = [];
    for (let s: PanoramaStop | undefined = start; s && !seen.has(s.id); s = s.next_id ? byId.get(s.next_id) : undefined) {
      seen.add(s.id);
      chain.push(s);
    }
    if (chain.length) chains.push(chain);
  };
  manifest.stops.filter((s) => !s.prev_id || !byId.has(s.prev_id)).forEach(walk);
  manifest.stops.forEach(walk);
  return chains;
}

/** The traverse containing a stop. */
export function traverseOf(manifest: PanoramaManifest, stop: PanoramaStop): PanoramaStop[] {
  return traverses(manifest).find((chain) => chain.some((s) => s.id === stop.id)) ?? [stop];
}

/** Camera direction for a compass bearing and pitch, in east-north-up components. */
export function enuDirection(headingDeg: number, pitchDeg: number): [number, number, number] {
  const h = toRad(headingDeg);
  const p = toRad(pitchDeg);
  return [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
}

/**
 * Cesium heading for headingPitchRollToFixedFrame so the image's centre column faces the
 * stop's compass heading. Seen from inside, Cesium's sphere shows the image centre on the
 * local -x axis, and a frame heading of h turns -x to compass bearing 270° + h.
 * Checked in the browser against the synthetic horizon's compass letters.
 */
export function frameHeadingDeg(stopHeadingDeg: number): number {
  return stopHeadingDeg + 90;
}

/** Image column (0 to 1, left to right) that shows a compass bearing in a stop's panorama. */
export function columnForBearing(stopHeadingDeg: number, bearing: number): number {
  return wrap360(bearing - stopHeadingDeg + 180) / 360;
}

export function clampFov(deg: number): number {
  return Math.min(FOV_MAX_DEG, Math.max(FOV_MIN_DEG, deg));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString('en-GB')} km`;
}

export function compassPoint(deg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(wrap360(deg) / 45) % 8];
}
