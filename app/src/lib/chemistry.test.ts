import { describe, expect, it } from 'vitest';
import { ChemistryFeature, groupChemistryByPosition } from './chemistry';

describe('groupChemistryByPosition', () => {
  it('combines exact co-located observations in source order', () => {
    const features: ChemistryFeature[] = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [137.1, -4.2] }, properties: { target: 'APXS A', sol: 10, source: 'test' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [137.2, -4.2] }, properties: { target: 'APXS B', sol: 11, source: 'test' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [137.1, -4.2] }, properties: { target: 'APXS C', sol: 12, source: 'test' } },
    ];
    expect(groupChemistryByPosition(features)).toEqual([
      { lon: 137.1, lat: -4.2, measurements: [{ target: 'APXS A', sol: 10, source: 'test' }, { target: 'APXS C', sol: 12, source: 'test' }] },
      { lon: 137.2, lat: -4.2, measurements: [{ target: 'APXS B', sol: 11, source: 'test' }] },
    ]);
  });
});
