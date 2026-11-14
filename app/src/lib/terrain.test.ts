import { describe, expect, it } from 'vitest';
import { shiftedDemDecoding } from './terrain';

describe('shiftedDemDecoding', () => {
  it('lifts a Mapbox Mars DEM minimum to zero while preserving decoding factors', () => {
    expect(shiftedDemDecoding({ url: 'terrain.pmtiles', encoding: 'mapbox', min_m: -4082, max_m: -3277 })).toEqual({
      redFactor: 6553.6, greenFactor: 25.6, blueFactor: 0.1, baseShift: -5918,
    });
  });
});
