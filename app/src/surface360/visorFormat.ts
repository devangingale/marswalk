// Written with AI assistance, directed and reviewed by the team.
// Text formats for the visor HUD.
import { wrap360 } from './panoramas';

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${wrap360(lon).toFixed(4)}°E`;
}
