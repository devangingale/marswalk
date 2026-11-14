// Written with AI assistance, directed and reviewed by the team.
// Human-facing formatting for coordinates, scores and evidence numbers.

/** Group an integer's digits in threes: 2406 -> "2,406". Keeps a leading sign. */
function groupThousands(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = Math.abs(value).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Latitude as "13.5938° S" (4 decimals, hemisphere letter). */
export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
}

/** Longitude as "58.4688° W" (4 decimals, hemisphere letter), east-positive input. */
export function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;
}

/** Combined latitude and longitude. */
export function formatLatLon(lat: number, lon: number): string {
  return `${formatLat(lat)}, ${formatLon(lon)}`;
}

/** Score rounded to a whole number for pins, bars and the list. */
export function formatScore(score: number): string {
  return String(Math.round(score));
}

/** Score band 0..4 for the green ramp; evenly splits 0-100 into five steps. */
export function scoreBucket(score: number): number {
  return Math.min(4, Math.max(0, Math.floor(score / 20)));
}

/** Distance in km: one decimal under 10 km, grouped whole km above. */
export function formatDistanceKm(km: number): string {
  if (km < 10) return km.toFixed(1);
  return groupThousands(Math.round(km));
}

/** Radiation dose, whole µGy/day. */
export function formatDose(dose: number): string {
  return groupThousands(Math.round(dose));
}

/** Dust optical-depth p95, two decimals. */
export function formatDust(value: number): string {
  return value.toFixed(2);
}

/** Elevation, whole metres with a sign and grouping. */
export function formatElevation(m: number): string {
  return groupThousands(Math.round(m));
}

/** Whole count. */
export function formatCount(n: number): string {
  return String(Math.round(n));
}
