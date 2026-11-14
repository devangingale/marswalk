// Written with AI assistance, directed and reviewed by the team.

/**
 * Relay status strip model (design: "SOS and relay scheduler" -> status strip:
 * "Habitat live / Earth next pass <orbiter> <local time> (<minutes>) / N queued").
 *
 * Pass times are real (SPICE, from passes.json); transmission is simulated and
 * labelled so. Local time comes from sun.ts (mean solar time at the site). The
 * queue priority and capacity live in lib/relay.ts; this module only reads the
 * next pass and formats the strip, plus the SOS Earth-arrival estimate.
 */

import { nextPass, queueOrder, type Pass, type RelayItem } from '../lib/relay';
import { formatLocalClock, formatUtcClock } from './format';
import { oneWayLightMinutes } from './lightTime';

/** One pass row as stored in passes.json (times are ISO UTC strings). */
export interface PassJson {
  orbiter: string;
  rise_utc: string;
  set_utc: string;
  peak_utc: string;
  peak_elevation_deg: number;
  duration_s: number;
}

export interface PassesFile {
  version: number;
  site: string;
  lat: number;
  lon_east: number;
  min_elevation_deg: number;
  orbiters: string[];
  passes: PassJson[];
}

/** Parses passes.json rows into relay.ts `Pass` values (epoch ms). */
export function parsePasses(file: PassesFile): Pass[] {
  return file.passes.map((p) => ({
    orbiter: p.orbiter,
    riseUtcMs: Date.parse(p.rise_utc),
    setUtcMs: Date.parse(p.set_utc),
    peakElevationDeg: p.peak_elevation_deg,
  }));
}

export interface NextPassView {
  orbiter: string;
  /** Pass rise as site mean-solar-time "HH:MM". */
  localHhmm: string;
  /** Whole minutes until the pass rises (0 when a pass is open now). */
  minutesUntil: number;
  /** True when a pass is open at `nowMs`. */
  open: boolean;
}

export interface RelayStripModel {
  habitat: 'live' | 'lost';
  nextPass: NextPassView | null;
  /** Number of items waiting in the relay queue. */
  queued: number;
}

/** Builds the strip model for `nowMs`. */
export function relayStripModel(opts: {
  passes: Pass[];
  nowMs: number;
  lonEastDeg: number;
  habitat: 'live' | 'lost';
  queued: number;
}): RelayStripModel {
  const pass = nextPass(opts.passes, opts.nowMs);
  const nextPassView: NextPassView | null = pass
    ? {
        orbiter: pass.orbiter,
        localHhmm: formatLocalClock(pass.riseUtcMs, opts.lonEastDeg),
        minutesUntil: Math.max(0, Math.round((pass.riseUtcMs - opts.nowMs) / 60000)),
        open: pass.riseUtcMs <= opts.nowMs && pass.setUtcMs > opts.nowMs,
      }
    : null;
  return { habitat: opts.habitat, nextPass: nextPassView, queued: opts.queued };
}

export interface EarthArrivalEstimate {
  pass: Pass;
  /** Transmit time (the pass rise) as site mean-solar-time "HH:MM". */
  sendLocalHhmm: string;
  /** One-way light time, minutes (rounded). */
  lightMin: number;
  /** Earth receipt time as a UTC "HH:MM". */
  earthUtcHhmm: string;
}

/**
 * The SOS Earth-arrival estimate: the packet leaves on the next pass (or the one
 * open now) and reaches Earth one light time later. Null when no pass remains in
 * the window.
 */
export function sosEarthArrival(
  passes: Pass[],
  nowMs: number,
  lonEastDeg: number,
): EarthArrivalEstimate | null {
  const pass = nextPass(passes, nowMs);
  if (!pass) return null;
  const sendMs = Math.max(pass.riseUtcMs, nowMs);
  const lightMin = oneWayLightMinutes(sendMs);
  const earthMs = sendMs + lightMin * 60000;
  return {
    pass,
    sendLocalHhmm: formatLocalClock(pass.riseUtcMs, lonEastDeg),
    lightMin: Math.round(lightMin),
    earthUtcHhmm: formatUtcClock(earthMs),
  };
}

/** Cadence of crew position fixes queued for Earth (design: one every 30 s). */
export const POSITION_CADENCE_MS = 30000;

/**
 * The simulated relay queue: one crew position fix every 30 s since the queue
 * started (the departure fix included), the latest active warning, and the SOS
 * once sent. Nothing is capped; the strip shows the real length of this list.
 * Pure over its inputs; item sizes are nominal (simulated).
 */
export function simulatedRelayQueue(opts: {
  startMs: number;
  nowMs: number;
  /** Latest active warning (a ladder level other than on pace), or null. */
  warning: string | null;
  /** When the SOS was sent, or null. */
  sosAtMs: number | null;
}): RelayItem[] {
  const items: RelayItem[] = [];
  const span = Math.max(0, opts.nowMs - opts.startMs);
  const fixes = Math.floor(span / POSITION_CADENCE_MS) + 1;
  for (let i = 0; i < fixes; i++) {
    items.push({ id: `pos-${i}`, kind: 'position', createdMs: opts.startMs + i * POSITION_CADENCE_MS, bytes: 64 });
  }
  if (opts.warning) items.push({ id: `warn-${opts.warning}`, kind: 'warning', createdMs: opts.nowMs, bytes: 128 });
  if (opts.sosAtMs !== null) items.push({ id: 'sos', kind: 'sos', createdMs: opts.sosAtMs, bytes: 256 });
  return queueOrder(items);
}
