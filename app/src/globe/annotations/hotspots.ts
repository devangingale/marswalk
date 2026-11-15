// Written with AI assistance, directed and reviewed by the team.
// Which whole-planet layers get "highest values" markers, which way is notable, and their labels.

import type { GlobeLayer, ValuesGrid } from '../layerManifest';
import { groupDigits } from './geo';
import { findPeaks, type Peak } from './peaks';

export interface HotspotSpec {
  /** Marker and list label, without the value. */
  label: string;
  lowest: boolean;
  decimals: number;
  /** Unit shown after the value; empty for none. */
  unit: string;
}

export const HOTSPOT_COUNT = 5;
export const HOTSPOT_SEPARATION_KM = 500;

const ICE_SIGNAL: HotspotSpec = { label: 'Strongest ice signal', lowest: false, decimals: 2, unit: '' };
const NEAREST_ICE: HotspotSpec = { label: 'Nearest ice', lowest: true, decimals: 0, unit: 'km' };

const SPECS: Record<string, HotspotSpec> = {
  SWIM4MIM_Ci_0_1: ICE_SIGNAL,
  SWIM4MIM_Ci_1_5: ICE_SIGNAL,
  SWIM4MIM_Ci_5: ICE_SIGNAL,
  ice_dist_km: NEAREST_ICE,
  ice_dist_km_0_5m: NEAREST_ICE,
  dose_ugy_day: { label: 'Highest radiation', lowest: false, decimals: 0, unit: 'µGy/day' },
  dust_mean: { label: 'Dustiest', lowest: false, decimals: 2, unit: 'τIR' },
  dust_p95: { label: 'Dustiest', lowest: false, decimals: 2, unit: 'τIR' },
  tes_ti_night_2007: { label: 'Highest thermal inertia', lowest: false, decimals: 0, unit: '' },
};

/** The hotspot rule for a layer, or null when the layer has no grid or no notable direction. */
export function hotspotSpec(layer: GlobeLayer): HotspotSpec | null {
  if (!layer.values) return null;
  const spec = SPECS[layer.id];
  if (spec) return spec;
  if (layer.group === 'minerals') {
    return { label: `Highest ${layer.title.charAt(0).toLowerCase()}${layer.title.slice(1)}`, lowest: false, decimals: 2, unit: layer.legend.units };
  }
  return null;
}

/** A value as shown on a marker: fixed decimals, real minus sign, no-break space before the unit. */
export function formatHotspotValue(spec: HotspotSpec, value: number): string {
  const text = spec.decimals === 0 ? groupDigits(Math.round(value)) : value.toFixed(spec.decimals).replace('-', '−');
  return spec.unit ? `${text} ${spec.unit}` : text;
}

export function computeHotspots(spec: HotspotSpec, grid: ValuesGrid): Peak[] {
  return findPeaks(grid, { count: HOTSPOT_COUNT, minSeparationKm: HOTSPOT_SEPARATION_KM, lowest: spec.lowest });
}
