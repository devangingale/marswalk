// Written with AI assistance, directed and reviewed by the team.

export type SiteKind =
  | 'optical'
  | 'topographic'
  | 'thermal'
  | 'spectral'
  | 'radiation'
  | 'atmospheric'
  | 'chemical'
  | 'geologic';

export type LayerType = 'raster' | 'points';

export interface LayerLegend {
  stops: [number, string][];
}

export interface SiteLayer {
  id: string;
  title: string;
  kind: SiteKind;
  type: LayerType;
  url: string;
  resolution_m: number;
  source: string;
  agency: string;
  units: string | null;
  legend: LayerLegend | null;
  default_on: boolean;
}

export interface SiteOrigin {
  lon0: number;
  lat0: number;
  lat_c: number;
}

export interface SiteSize {
  width: number;
  height: number;
}

export interface SiteTerrain {
  url: string;
  encoding: 'mapbox' | 'terrarium';
  min_m: number;
  max_m: number;
}

export interface SiteData {
  id: string;
  title: string;
  rover: string;
  origin: SiteOrigin;
  size_m: SiteSize;
  bounds_lonlat: [number, number, number, number];
  default_start: {
    lon: number;
    lat: number;
    label: string;
  };
  terrain: SiteTerrain;
  layers: SiteLayer[];
  conditions_url?: string;
  photos_url?: string;
  chemistry_url?: string;
  stops_url?: string;
  validation?: {
    text: string | null;
    model_auc: number | null;
    baseline_auc: number | null;
  };
}

export interface LayerState {
  enabled: boolean;
  opacity: number;
}

export type AppMode = 'plan' | 'walk' | 'visor';
