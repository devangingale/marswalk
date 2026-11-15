// Written with AI assistance, directed and reviewed by the team.
// Relay passes for the visor, from the passes.py SPICE bundle that build_panoramas.py copies
// (MRO and Mars Odyssey only). Nothing is predicted here: the next pass is looked up in the bundle.

export interface RelayPass {
  orbiter: string;
  rise_utc: string;
  set_utc: string;
  peak_utc: string;
  peak_elevation_deg: number;
  duration_s: number;
}

export interface PassBundle {
  site: string;
  lat: number;
  lon_east: number;
  window: { start: string; end: string };
  passes: RelayPass[];
}

export const ORBITER_NAMES: Record<string, string> = { MRO: 'MRO', ODY: 'Odyssey' };

export type RelayStatus =
  | { kind: 'overhead'; pass: RelayPass; setsInS: number }
  | { kind: 'upcoming'; pass: RelayPass; risesInS: number }
  /** The clock is outside the bundle's computed window. */
  | { kind: 'outside-window'; window: PassBundle['window'] };

/** The pass in progress at `nowMs`, or the next one; outside the bundle window, says so. */
export function relayStatus(bundle: PassBundle, nowMs: number): RelayStatus {
  const start = Date.parse(bundle.window.start);
  const end = Date.parse(bundle.window.end);
  if (!(nowMs >= start && nowMs <= end)) return { kind: 'outside-window', window: bundle.window };
  for (const pass of bundle.passes) {
    const rise = Date.parse(pass.rise_utc);
    const set = Date.parse(pass.set_utc);
    if (nowMs >= rise && nowMs < set) return { kind: 'overhead', pass, setsInS: (set - nowMs) / 1000 };
    if (rise > nowMs) return { kind: 'upcoming', pass, risesInS: (rise - nowMs) / 1000 };
  }
  return { kind: 'outside-window', window: bundle.window };
}

export function isPassBundle(value: unknown): value is PassBundle {
  const b = value as PassBundle | null;
  return !!b && Array.isArray(b.passes) && typeof b.window?.start === 'string' && typeof b.window?.end === 'string';
}
