import type { Feature, Point } from 'geojson';
import type { ChemistryProperties } from '../types';

export type ChemistryFeature = Feature<Point, ChemistryProperties>;

export interface ChemistryPositionGroup {
  lon: number;
  lat: number;
  measurements: ChemistryProperties[];
}

/** Combine all observations that share an exact GeoJSON position, preserving file order. */
export function groupChemistryByPosition(features: ChemistryFeature[]): ChemistryPositionGroup[] {
  const groups = new Map<string, ChemistryPositionGroup>();
  for (const feature of features) {
    const [lon, lat] = feature.geometry.coordinates;
    const key = `${lon},${lat}`;
    const group = groups.get(key);
    if (group) group.measurements.push(feature.properties);
    else groups.set(key, { lon, lat, measurements: [feature.properties] });
  }
  return [...groups.values()];
}
