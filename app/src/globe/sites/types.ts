// Written with AI assistance, directed and reviewed by the team.
// Shapes for the site-finder data file (public/sample/globe/sites.json).

export type GroupKey = 'terrain' | 'climate' | 'solar' | 'protection' | 'science';

export type SiteKind = 'new' | 'landed' | 'zone2015';

export type Weights = Record<GroupKey, number>;

export interface SiteEvidence {
  elevation_m: number;
  slope_p90_deg: number;
  roughness_m: number;
  ice_dist_km: number;
  ice_dist_km_0_5m: number;
  dose_ugy_day: number;
  dust_mean: number;
  dust_p95: number;
  storm_frac: number;
  insolation_wm2: number;
  cave_count_zone: number;
  unit_diversity_zone: number;
  tes_ti_night_2007: number;
  surface_pressure_pa: number;
  habitat_dist_km: number;
  habitat_slope_patch_max_deg: number;
  habitat_area_km2_approx: number;
  latitude_deg_abs: number;
}

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: SiteKind;
  score: number;
  groups: Record<GroupKey, number>;
  evidence: SiteEvidence;
  vetoed: boolean;
  veto_reason: string[];
  detail_available: boolean;
  nearest_hirise_dtm_km: number;
  source_url?: string;
  source_note?: string;
}

export interface Veto {
  id: string;
  rule: string;
  source: string;
  notes?: string;
}

export interface SitesFile {
  version: number;
  weights: {
    group_weights: Weights;
  };
  vetoes: Veto[];
  sites: Site[];
}

/** The five group keys, in the order they are shown. */
export const GROUP_KEYS: GroupKey[] = ['terrain', 'climate', 'solar', 'protection', 'science'];

/** Human labels for the five scoring groups. */
export const GROUP_LABELS: Record<GroupKey, string> = {
  terrain: 'Terrain',
  climate: 'Climate',
  solar: 'Solar',
  protection: 'Protection',
  science: 'Science',
};
