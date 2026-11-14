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

/** Regional MOLA/HRSC hillshade under the site raster, when the bundle provides it. */
export function marsBaseStyle(siteData?: SiteData): StyleSpecification {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--map-background').trim();
  const basemapUrl = siteData?.basemap?.url;
  const layers: StyleSpecification['layers'] = [
    {
      id: 'mars-background',
      type: 'background',
      paint: { 'background-color': background },
    },
  ];
  if (basemapUrl) {
    layers.push({
      id: 'mars-basemap-layer',
      type: 'raster',
      source: 'mars_basemap',
      minzoom: 0,
      paint: { 'raster-opacity': 1 },
    });
  }
  return {
    version: 8,
    name: 'Sol-48 Mars Basemap',
    sources: basemapUrl ? {
      mars_basemap: {
        type: 'raster',
        url: `pmtiles://${resolveSiteAssetUrl(siteData.id, basemapUrl)}`,
        tileSize: 256,
        attribution: siteData.basemap?.source ?? 'MOLA/HRSC BlendDEM, USGS Astrogeology',
      },
    } : {},
    layers,
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
    bounds: siteData.bounds_lonlat,
  });
  map.addLayer({ id: 'site-optical', type: 'raster', source: 'site-optical' });
}
