// Written with AI assistance, directed and reviewed by the team.
// The panoramas.json contract for the 360° surface view: types, loading with a built-in
// sample fallback, and the plain geometry the view needs (bearings, distances, image columns).
import { MARS_RADIUS_METERS } from '../config';
import sampleManifest from '../fixtures/panoramas.sample.json';

export type Walkability = 'safe' | 'caution' | 'hazard';

export interface PanoramaPoi {
  id: string;
  title: string;
  type: string;
  /** Compass bearing, degrees clockwise from north. */
  heading: number;
  /** Degrees above (+) or below (-) the horizon. */
  pitch: number;
  detail: string;
}

export interface PanoramaStop {
  id: string;
  name: string;
  sol: number;
  lat: number;
  lon_east: number;
  /** Ground height, metres; the eye sits 1.8 m above it. */
  height: number;
  /** Compass bearing of the image's centre column, degrees. */
  heading: number;
  pitch: number;
  roll: number;
  image_url: string;
  walkability: Walkability;
  next_orbiter_pass: string;
  next_id: string | null;
  prev_id: string | null;
  pois: PanoramaPoi[];
}

export interface PanoramaManifest {
  stops: PanoramaStop[];
}

export interface LoadedManifest {
  manifest: PanoramaManifest;
  /** Base URL that relative image_url values resolve against. */
  baseUrl: string;
  /** True when the built-in sample stands in for a missing or invalid manifest. */
  isSample: boolean;
}

/** Suited eye height above the ground, metres. */
export const EYE_HEIGHT_M = 1.8;
export const FOV_MIN_DEG = 20;
export const FOV_MAX_DEG = 90;
export const FOV_DEFAULT_DEG = 75;

export const PANORAMAS_URL: string =
  (import.meta.env.VITE_PANORAMAS_URL as string | undefined) || '/panoramas.json';

export const SAMPLE_MANIFEST = sampleManifest as PanoramaManifest;

const WALKABILITY: readonly Walkability[] = ['safe', 'caution', 'hazard'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isRef = (v: unknown): v is string | null => v === null || isStr(v);

function isPoi(v: unknown): v is PanoramaPoi {
  const p = v as Record<string, unknown>;
  return !!p && isStr(p.id) && isStr(p.title) && isStr(p.type) && isNum(p.heading) && isNum(p.pitch) && isStr(p.detail);
}

function isStop(v: unknown): v is PanoramaStop {
  const s = v as Record<string, unknown>;
  return (
    !!s &&
    isStr(s.id) &&
    isStr(s.name) &&
    isNum(s.sol) &&
    isNum(s.lat) &&
    isNum(s.lon_east) &&
    isNum(s.height) &&
    isNum(s.heading) &&
    isNum(s.pitch) &&
    isNum(s.roll) &&
    isStr(s.image_url) &&
    WALKABILITY.includes(s.walkability as Walkability) &&
    isStr(s.next_orbiter_pass) &&
    isRef(s.next_id) &&
    isRef(s.prev_id) &&
    Array.isArray(s.pois) &&
    s.pois.every(isPoi)
  );
}

/** The manifest if it matches the contract, else null. Every stop must be valid and ids unique. */
export function parseManifest(value: unknown): PanoramaManifest | null {
  const stops = (value as { stops?: unknown } | null)?.stops;
  if (!Array.isArray(stops) || stops.length === 0 || !stops.every(isStop)) return null;
  if (new Set(stops.map((s) => s.id)).size !== stops.length) return null;
  return { stops };
}

/** The page URL that relative manifest and image paths resolve against. */
const pageUrl = () => globalThis.location?.href ?? 'http://localhost/';

/** Fetches the manifest; any failure (network, HTTP, HTML from a dev server, bad schema) falls back to the sample. */
export async function loadManifest(url = PANORAMAS_URL, fetcher: typeof fetch = fetch): Promise<LoadedManifest> {
  const baseUrl = new URL(url, pageUrl()).href;
  try {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = parseManifest(await response.json());
    if (!manifest) throw new Error('panoramas.json does not match the contract');
    return { manifest, baseUrl, isSample: false };
  } catch (error) {
    console.info('Using the built-in sample panoramas:', error instanceof Error ? error.message : error);
    return { manifest: SAMPLE_MANIFEST, baseUrl: pageUrl(), isSample: true };
  }
}

export function resolveImageUrl(stop: PanoramaStop, baseUrl: string): string {
  return new URL(stop.image_url, baseUrl).href;
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
