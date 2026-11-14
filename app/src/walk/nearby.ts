// Written with AI assistance, directed and reviewed by the team.

/**
 * What lies near a stop: rover photos (contracts section 8) and APXS chemistry points
 * (contracts section 9). Distances are true Mars ground metres.
 */

import type { Feature, Point } from 'geojson';
import { ChemistryProperties, RoverPhoto } from '../types';
import { calculateMarsDistanceMeters } from '../utils/scale';

export const PHOTO_RADIUS_M = 150;
export const PHOTOS_PER_STOP = 3;
export const CHEMISTRY_RADIUS_M = 30;

export type ChemistryFeature = Feature<Point, ChemistryProperties>;

export interface NearbyPhoto {
  photo: RoverPhoto;
  distanceM: number;
}

export interface ChemistryGroup {
  lon: number;
  lat: number;
  distanceM: number;
  measurements: ChemistryProperties[];
}

/** The closest photos within `radiusM` of a point, nearest first. */
export function photosNear(
  photos: RoverPhoto[],
  lon: number,
  lat: number,
  radiusM: number = PHOTO_RADIUS_M,
  limit: number = PHOTOS_PER_STOP
): NearbyPhoto[] {
  return photos
    .map((photo) => ({ photo, distanceM: calculateMarsDistanceMeters(lon, lat, photo.lon, photo.lat) }))
    .filter((p) => p.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM || a.photo.id.localeCompare(b.photo.id))
    .slice(0, limit);
}

/**
 * The nearest chemistry position within `radiusM`, with every measurement taken there.
 * Several measurements often share one position; they are returned together.
 */
export function chemistryNear(
  features: ChemistryFeature[],
  lon: number,
  lat: number,
  radiusM: number = CHEMISTRY_RADIUS_M
): ChemistryGroup | null {
  const groups = new Map<string, ChemistryGroup>();
  for (const feature of features) {
    const [fLon, fLat] = feature.geometry.coordinates;
    const key = `${fLon},${fLat}`;
    const group = groups.get(key);
    if (group) {
      group.measurements.push(feature.properties);
    } else {
      groups.set(key, {
        lon: fLon,
        lat: fLat,
        distanceM: calculateMarsDistanceMeters(lon, lat, fLon, fLat),
        measurements: [feature.properties],
      });
    }
  }

  let nearest: ChemistryGroup | null = null;
  for (const group of groups.values()) {
    if (group.distanceM <= radiusM && (!nearest || group.distanceM < nearest.distanceM)) {
      nearest = group;
    }
  }
  return nearest;
}

/** Composition fields (weight percent) of one measurement, in file order. */
export function compositionFields(measurement: ChemistryProperties): [string, number][] {
  return Object.entries(measurement).filter(
    (entry): entry is [string, number] => entry[0] !== 'sol' && typeof entry[1] === 'number'
  );
}
