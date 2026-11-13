// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  TILES_BASE,
  AVAILABLE_SITES,
  DEFAULT_SITE,
  getSiteJsonUrl,
  resolveSiteAssetUrl,
  MARS_RADIUS_METERS,
} from './config';

describe('Mission Configuration (app/src/config.ts)', () => {
  it('defaults TILES_BASE to /sample per PRD', () => {
    expect(TILES_BASE).toBe('/sample');
  });

  it('provides available sites list driving site switcher without hardcoding', () => {
    expect(AVAILABLE_SITES).toContain('gale');
    expect(AVAILABLE_SITES).toContain('jezero');
    expect(DEFAULT_SITE).toBe('gale');
  });

  it('constructs site.json URL dynamically for any site', () => {
    expect(getSiteJsonUrl('gale')).toBe('/sample/gale/site.json');
    expect(getSiteJsonUrl('jezero')).toBe('/sample/jezero/site.json');
  });

  it('resolves relative layer and asset URLs against TILES_BASE and site ID', () => {
    expect(resolveSiteAssetUrl('gale', 'terrain.pmtiles')).toBe('/sample/gale/terrain.pmtiles');
    expect(resolveSiteAssetUrl('gale', 'image.pmtiles')).toBe('/sample/gale/image.pmtiles');
    expect(resolveSiteAssetUrl('jezero', 'slope.pmtiles')).toBe('/sample/jezero/slope.pmtiles');
  });

  it('preserves absolute URLs and root data URLs', () => {
    expect(resolveSiteAssetUrl('gale', '/data/gale/chemistry.geojson')).toBe('/data/gale/chemistry.geojson');
    expect(resolveSiteAssetUrl('gale', 'https://example.com/asset.pmtiles')).toBe('https://example.com/asset.pmtiles');
  });

  it('exports true Mars sphere radius of 3396190 m', () => {
    expect(MARS_RADIUS_METERS).toBe(3396190);
  });
});
