// Written with AI assistance, directed and reviewed by the team.
// The ranked candidate sites and the nearest of them to a point.

import type { Site } from '../sites/types';
import { greatCircleKm } from './geo';

export interface RankedCandidate {
  rank: number;
  site: Site;
}

/** The n best non-vetoed new candidates by file score; ties keep file order. Rank starts at 1. */
export function topCandidates(sites: Site[], n = 10): RankedCandidate[] {
  return sites
    .map((site, index) => ({ site, index }))
    .filter(({ site }) => site.kind === 'new' && !site.vetoed)
    .sort((a, b) => b.site.score - a.site.score || a.index - b.index)
    .slice(0, n)
    .map(({ site }, i) => ({ rank: i + 1, site }));
}

/** The ranked site closest to a point, with its great-circle distance in km. */
export function nearestRanked(
  ranked: RankedCandidate[],
  lon: number,
  lat: number,
): { ranked: RankedCandidate; km: number } | null {
  let best: { ranked: RankedCandidate; km: number } | null = null;
  for (const r of ranked) {
    const km = greatCircleKm(lon, lat, r.site.lon, r.site.lat);
    if (!best || km < best.km) best = { ranked: r, km };
  }
  return best;
}
