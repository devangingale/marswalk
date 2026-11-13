// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { GridOrigin, localMetresToLonLat } from '../lib/grid';
import { ChemistryProperties, RoverPhoto } from '../types';
import photosSample from '../fixtures/photos.sample.json';
import { ChemistryFeature, chemistryNear, compositionFields, photosNear } from './nearby';

const origin: GridOrigin = { lon0: 137.0, lat0: -5.0, lat_c: -5.0 };

function photoAt(id: string, x_m: number, y_m: number): RoverPhoto {
  const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);
  return { id, lon, lat, heading_deg: null, sol: 100, camera: 'Navcam Left', url: `${id}.JPG`, thumb: `${id}-thm.JPG`, credit: 'NASA/JPL-Caltech' };
}

function chemAt(target: string, x_m: number, y_m: number, SiO2: number): ChemistryFeature {
  const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);
  const properties: ChemistryProperties = { target, sol: 200, SiO2, FeO: 18.5, source: 'pds' };
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties };
}

const stop = localMetresToLonLat(0, 0, origin);

describe('nearest photos', () => {
  const photos = [photoAt('far', 200, 0), photoAt('mid', 0, 120), photoAt('near', 30, 40), photoAt('edge', 149, 0)];

  it('returns photos within the radius, nearest first', () => {
    const near = photosNear(photos, stop.lon, stop.lat, 150, 3);
    expect(near.map((p) => p.photo.id)).toEqual(['near', 'mid', 'edge']);
    expect(near[0].distanceM).toBeCloseTo(50, 3);
    expect(near[1].distanceM).toBeCloseTo(120, 3);
  });

  it('caps the count', () => {
    expect(photosNear(photos, stop.lon, stop.lat, 150, 1).map((p) => p.photo.id)).toEqual(['near']);
  });

  it('returns nothing when no photo is close enough', () => {
    expect(photosNear(photos, stop.lon, stop.lat, 45, 3)).toEqual([]);
    expect(photosNear([], stop.lon, stop.lat)).toEqual([]);
  });

  it('finds fixture photos at the sample stop and none at the sample start', () => {
    const fixture = photosSample as RoverPhoto[];
    const atRidge = photosNear(fixture, 137.3795, -4.812);
    expect(atRidge.map((p) => p.photo.id)).toEqual([
      'NLB_829027961EDR_F1212490NCAM00290M_',
      'NLB_829028040EDR_F1212490NCAM00290M_',
      'NLB_829028986EDR_F1212490NCAM00291M_',
    ]);
    expect(atRidge[0].distanceM).toBeCloseTo(132.26, 2);
    expect(photosNear(fixture, 137.39, -4.78)).toEqual([]);
  });
});

describe('chemistry within 30 m', () => {
  const features = [
    chemAt('APXS a', 20, 0, 40.1),
    chemAt('APXS b', 20, 0, 38.6),
    chemAt('APXS c', 0, 25, 45.0),
    chemAt('APXS d', 0, 31, 50.0),
  ];

  it('returns the nearest position with every measurement stacked on it', () => {
    const group = chemistryNear(features, stop.lon, stop.lat);
    expect(group).not.toBeNull();
    expect(group?.distanceM).toBeCloseTo(20, 3);
    expect(group?.measurements.map((m) => m.target)).toEqual(['APXS a', 'APXS b']);
  });

  it('returns null when nothing is within the radius', () => {
    expect(chemistryNear(features.slice(3), stop.lon, stop.lat)).toBeNull();
  });

  it('lists composition fields without sol, target or source', () => {
    expect(compositionFields(features[0].properties)).toEqual([
      ['SiO2', 40.1],
      ['FeO', 18.5],
    ]);
  });
});
