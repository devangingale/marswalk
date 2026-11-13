// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import siteSample from './site.sample.json';

describe('Sample Site Stub Contract Validation (Contracts Section 5)', () => {
  it('contains mandatory top-level site metadata', () => {
    expect(siteSample.id).toBe('gale');
    expect(siteSample.rover).toBe('Curiosity');
    expect(siteSample.title).toBeDefined();

    expect(siteSample.origin.lon0).toBeCloseTo(137.3628, 4);
    expect(siteSample.origin.lat0).toBeCloseTo(-4.8250, 4);
    expect(siteSample.origin.lat_c).toBeCloseTo(-4.7913, 4);

    expect(siteSample.size_m.width).toBe(3986);
    expect(siteSample.size_m.height).toBe(4000);

    expect(siteSample.bounds_lonlat).toHaveLength(4);
    expect(siteSample.default_start.label).toBe('Rover drop-off');
  });

  it('configures terrain.pmtiles with mapbox encoding', () => {
    expect(siteSample.terrain.url).toBe('terrain.pmtiles');
    expect(siteSample.terrain.encoding).toBe('mapbox');
    expect(typeof siteSample.terrain.min_m).toBe('number');
    expect(typeof siteSample.terrain.max_m).toBe('number');
  });

  it('contains layers spanning at least 3 distinct kinds', () => {
    const kinds = new Set(siteSample.layers.map((l) => l.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(kinds.has('optical')).toBe(true);
    expect(kinds.has('topographic')).toBe(true);
    expect(kinds.has('thermal')).toBe(true);
  });

  it('enforces true resolution_m on every layer', () => {
    for (const layer of siteSample.layers) {
      expect(typeof layer.resolution_m).toBe('number');
      expect(layer.resolution_m).toBeGreaterThan(0);
      expect(layer.source).toBeDefined();
      expect(layer.agency).toBeDefined();
    }
  });

  it('validates legend stops on layers with units', () => {
    const slopeLayer = siteSample.layers.find((l) => l.id === 'slope');
    expect(slopeLayer).toBeDefined();
    expect(slopeLayer?.units).toBe('degrees');
    expect(slopeLayer?.legend?.stops.length).toBeGreaterThan(0);
  });

  it('supports points type layers (e.g. APXS chemistry)', () => {
    const chemLayer = siteSample.layers.find((l) => l.type === 'points');
    expect(chemLayer).toBeDefined();
    expect(chemLayer?.kind).toBe('chemical');
  });
});
