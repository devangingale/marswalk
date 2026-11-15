// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { GlobeLayer } from '../globe/layerManifest';
import { marsDistanceKm, siteValueText, valueFromColour } from './wholePlanet';

const layer = (group: string, units: string, stops: [number, string][], min: number, max: number): GlobeLayer => ({
  id: group, title: group, group, units, description: '', tiles: '', tiling: 'geographic', min_level: 0, max_level: 1,
  rectangle: [-180, -90, 180, 90],
  legend: { stops, min, max, min_label: String(min), max_label: String(max), units },
  source: { dataset: '', citation: '', licence: '' },
});

describe('whole-planet values at the site', () => {
  it('drops the group name from the value text', () => {
    const radiation = layer('radiation', 'µGy/day', [[261, '#000000ff'], [333, '#ffffffff']], 261, 333);
    const text = siteValueText(radiation, 278.4);
    expect(text).toMatch(/^278\s/u);
    expect(text.endsWith('Gy/day')).toBe(true);
  });

  it('reads a value back from a ramp colour', () => {
    const ramp = layer('dust', 'tau', [[0, '#000000ff'], [1, '#ffffffff']], 0, 1);
    expect(valueFromColour(ramp, [128, 128, 128, 255])).toBeCloseTo(0.5, 1);
    expect(valueFromColour(ramp, [0, 0, 0, 0])).toBeNull();
  });

  it('measures great-circle distance on Mars', () => {
    expect(marsDistanceKm({ lon: 0, lat: 0 }, { lon: 0, lat: 0 })).toBe(0);
    expect(marsDistanceKm({ lon: 0, lat: 0 }, { lon: 180, lat: 0 })).toBeCloseTo(Math.PI * 3389.5, 0);
  });
});
