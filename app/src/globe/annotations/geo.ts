// Written with AI assistance, directed and reviewed by the team.
// Great-circle distance on the Mars sphere and the km format used by the annotations.

import { MARS_RADIUS_METERS } from '../../config';

const RAD = Math.PI / 180;
const NBSP = ' ';

/** Great-circle distance in km between two east-positive lon/lat points on the Mars sphere. */
export function greatCircleKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a))) * MARS_RADIUS_METERS) / 1000;
}

/** Group digits from 10 000 with a no-break space, as the design system asks. */
export function groupDigits(n: number): string {
  const text = String(Math.abs(n));
  const grouped = Math.abs(n) >= 10_000 ? text.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : text;
  return n < 0 ? `−${grouped}` : grouped;
}

/** Distance in km: one decimal under 10 km, whole km above. */
export function formatKm(km: number): string {
  return `${km < 10 ? km.toFixed(1) : groupDigits(Math.round(km))}${NBSP}km`;
}
