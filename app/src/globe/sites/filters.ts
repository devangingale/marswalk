// Written with AI assistance, directed and reviewed by the team.
// Pure chip filtering for the ranked site list.

import { Site, SiteKind } from './types';

/** Ice-nearby threshold, from the ISRU search radius discussion in landing-sites.md. */
export const ICE_NEARBY_KM = 50;

/** Kind chip: one of the kinds, or every kind. */
export type KindChip = 'all' | SiteKind;

export interface FilterState {
  kind: KindChip;
  hasDetail: boolean;
  iceNearby: boolean;
  lowRadiation: boolean;
  cavesNearby: boolean;
  showVetoed: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  kind: 'all',
  hasDetail: false,
  iceNearby: false,
  lowRadiation: false,
  cavesNearby: false,
  showVetoed: false,
};

/** Median of a list of numbers. Empty list returns NaN. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median radiation dose (µGy/day) over the given sites. */
export function radiationMedian(sites: Site[]): number {
  return median(sites.map((s) => s.evidence.dose_ugy_day));
}

/**
 * Apply the filter chips. The kind chip and the hidden-veto rule set the base
 * population; "low radiation" is measured against the median of that base.
 */
export function filterSites(sites: Site[], f: FilterState): Site[] {
  let base = sites;
  if (!f.showVetoed) base = base.filter((s) => !s.vetoed);
  if (f.kind !== 'all') base = base.filter((s) => s.kind === f.kind);

  const doseMedian = radiationMedian(base);
  return base.filter((s) => {
    if (f.hasDetail && !s.detail_available) return false;
    if (f.iceNearby && s.evidence.ice_dist_km > ICE_NEARBY_KM) return false;
    if (f.lowRadiation && !(s.evidence.dose_ugy_day < doseMedian)) return false;
    if (f.cavesNearby && !(s.evidence.cave_count_zone > 0)) return false;
    return true;
  });
}
