// Written with AI assistance, directed and reviewed by the team.

import { addProtocol, Map as MapLibreMap, setWorkerUrl, StyleSpecification } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { SiteData } from '../types';
import { resolveSiteAssetUrl } from '../config';

// MapLibre looks for its worker beside its own module, where Vite does not put it.
setWorkerUrl(maplibreWorkerUrl);

let pmtilesProtocolInitialized = false;

export function setupPMTilesProtocol() {
  if (!pmtilesProtocolInitialized) {
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    pmtilesProtocolInitialized = true;
  }
}

/** Dark background with the Mars Trek MOLA shaded-relief basemap. */
export function marsBaseStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Sol-48 Mars Basemap',
    sources: {
      mars_mola_trek: {
        type: 'raster',
        tiles: [
          'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
        ],
        tileSize: 256,
        maxzoom: 8,
        attribution: 'NASA/JPL/GSFC Mars Trek',
      },
    },
    layers: [
      {
        id: 'mars-background',
        type: 'background',
        paint: {
          'background-color': '#3b2e26',
        },
      },
      {
        id: 'mars-trek-layer',
        type: 'raster',
        source: 'mars_mola_trek',
        minzoom: 0,
        paint: {
          'raster-opacity': 0.75,
        },
      },
    ],
  };
}

/** Adds the site's optical raster layer (contracts section 5, kind `optical`), if it has one. */
export function addOpticalImage(map: MapLibreMap, siteData: SiteData) {
  const optical = siteData.layers.find((layer) => layer.kind === 'optical' && layer.type === 'raster');
  if (!optical) return;
  map.addSource('site-optical', {
    type: 'raster',
    url: `pmtiles://${resolveSiteAssetUrl(siteData.id, optical.url)}`,
    tileSize: 256,
  });
  map.addLayer({ id: 'site-optical', type: 'raster', source: 'site-optical' });
}
