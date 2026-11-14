// Written with AI assistance, directed and reviewed by the team.
// Nearest IAU place name for a candidate, from public/data/globe/names.geojson.

import { MARS_RADIUS_METERS } from '../../config';

export interface PlaceFeature {
  properties: { name: string; type?: string; diameter_km?: number };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface PlaceCollection {
  features: PlaceFeature[];
}

const KM_PER_DEG = (Math.PI * (MARS_RADIUS_METERS / 1000)) / 180;

/** Great-circle angular separation in degrees (spherical law of cosines). */
export function angularDistanceDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const cos =
    Math.sin(lat1 * r) * Math.sin(lat2 * r) +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
}

/**
 * Name of the IAU feature the point sits nearest. Distance is measured to each
 * feature's edge (centre distance minus its radius), so a large region the
 * point lies within wins over a small crater a little closer to its centre.
 * Returns null when there are no features.
 */
export function nearestPlaceName(lon: number, lat: number, features: PlaceFeature[]): string | null {
  let best: string | null = null;
  let bestEdge = Infinity;
  for (const f of features) {
    const [flon, flat] = f.geometry.coordinates;
    const centre = angularDistanceDeg(lon, lat, flon, flat);
    const radiusDeg = f.properties.diameter_km ? f.properties.diameter_km / 2 / KM_PER_DEG : 0;
    const edge = centre - radiusDeg;
    if (edge < bestEdge) {
      bestEdge = edge;
      best = f.properties.name;
    }
  }
  return best;
}
