// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { SiteData } from '../../types';
import { offlineImagerySet } from './imagerySet';

const site = {
  id: 'gale',
  basemap: { url: 'basemap.pmtiles', source: 'MOLA/HRSC' },
  layers: [
    { id: 'image', type: 'raster', url: 'image.pmtiles' },
    { id: 'stops', type: 'points', url: 'stops.json' },
  ],
} as SiteData;

describe('offlineImagerySet', () => {
  it('uses the local basemap and raster layers offline', () => {
    expect(offlineImagerySet('offline', site)).toEqual({
      basemap: site.basemap,
      layers: [site.layers[0]],
    });
  });

  it('omits the offline basemap in ion mode', () => {
    expect(offlineImagerySet('ion', site)).toEqual({ layers: [site.layers[0]] });
  });

  it('keeps raster layers when the bundle has no basemap', () => {
    const { basemap: _basemap, ...withoutBasemap } = site;
    expect(offlineImagerySet('offline', withoutBasemap as SiteData)).toEqual({ layers: [site.layers[0]] });
  });
});
