// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { angularDistanceDeg, nearestPlaceName, PlaceFeature } from './nearestPlace';

function feature(name: string, lon: number, lat: number, diameter_km?: number): PlaceFeature {
  return { properties: { name, diameter_km }, geometry: { type: 'Point', coordinates: [lon, lat] } };
}

describe('angularDistanceDeg', () => {
  it('is zero at the same point', () => {
    expect(angularDistanceDeg(10, 20, 10, 20)).toBe(0);
  });
  it('equals the longitude span along the equator', () => {
    expect(angularDistanceDeg(0, 0, 3, 0)).toBeCloseTo(3, 6);
  });
});

describe('nearestPlaceName', () => {
  it('returns null with no features', () => {
    expect(nearestPlaceName(0, 0, [])).toBeNull();
  });

  it('picks the only feature', () => {
    expect(nearestPlaceName(0, 0, [feature('Arcadia Planitia', 5, 5, 1000)])).toBe('Arcadia Planitia');
  });

  it('prefers a large nearby region over a slightly closer small crater', () => {
    const crater = feature('Blunck', 0.5, 0, 10);
    const region = feature('Arcadia Planitia', 2, 0, 400);
    expect(nearestPlaceName(0, 0, [crater, region])).toBe('Arcadia Planitia');
  });

  it('falls back to the nearest point when regions are far', () => {
    const near = feature('Near Crater', 0.2, 0, 5);
    const farRegion = feature('Far Planitia', 40, 0, 400);
    expect(nearestPlaceName(0, 0, [near, farRegion])).toBe('Near Crater');
  });
});
