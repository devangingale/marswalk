// Written with AI assistance, directed and reviewed by the team.

import type { Plan, PlanStart, PlanStop } from './lib/plan';
import type { RouteGrid } from './lib/grid';

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

export interface SiteBasemap {
  url: string;
  source: string;
}

export interface SiteData {
  id: string;
  title: string;
  rover: string | null;
  origin: SiteOrigin;
  size_m: SiteSize;
  bounds_lonlat: [number, number, number, number];
  default_start: {
    lon: number;
    lat: number;
    label: string;
  };
  basemap?: SiteBasemap;
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

export interface RoverOverlayState {
  traverse: boolean;
  photos: boolean;
}

export interface MapProps {
  siteData: SiteData;
  layerStates: Record<string, LayerState>;
  roverOverlayState: RoverOverlayState;
  plan?: Plan;
  onMapPoint?: (point: { lon: number; lat: number }) => void;
  onStartChange?: (start: PlanStart) => void;
  onStopChange?: (stop: PlanStop) => void;
  onRoutePointHover?: (point: { lon: number; lat: number } | null) => void;
  grid?: RouteGrid | null;
  activePoint?: { lon: number; lat: number } | null;
}

export type AppMode = 'plan' | 'walk' | 'visor';

export interface RoverPhoto {
  id: string;
  lon: number;
  lat: number;
  heading_deg: number | null;
  sol: number;
  camera: string;
  url: string;
  thumb: string;
  credit: string;
}

export interface LatestWeather {
  sol: number;
  terrestrial_date: string;
  air_temp_min_c: number;
  air_temp_max_c: number;
  pressure_pa: number;
}

export interface SiteConditions {
  weather?: {
    source: string;
    latest: LatestWeather;
  };
  radiation: {
    source: string;
    surface_dose_mgy_per_day: number;
    solar_event_mgy_per_day: number;
    note: string;
  };
}

export interface ChemistryProperties {
  target: string;
  sol: number;
  source: string;
  [field: string]: string | number;
}
