// Written with AI assistance, directed and reviewed by the team.
// Text formats for the visor HUD.
import { wrap360 } from './panoramas';

/** Seconds and orbiter name from a pass string such as "00:18:42 (MRO)"; null when it has no time. */
export function parsePass(text: string): { seconds: number; orbiter: string } | null {
  const m = /^\s*(\d+):(\d{2}):(\d{2})\s*(?:\((.+)\))?/.exec(text);
  if (!m) return null;
  return { seconds: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), orbiter: m[4]?.trim() || 'Relay' };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${wrap360(lon).toFixed(4)}°E`;
}
