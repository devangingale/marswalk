import { Popup, type Map as MapLibreMap } from 'maplibre-gl';
import { resolveSiteAssetUrl } from '../config';

export interface RoverOverlayState {
  traverse: boolean;
  photos: boolean;
}

interface PhotoRecord {
  lon: number;
  lat: number;
  sol: number;
}

interface PhotoSiteProperties {
  count: number;
  solFrom: number;
  solTo: number;
}

const TRAVERSE_LAYER = 'rover-traverse-line';
const TRAVERSE_CASING_LAYER = 'rover-traverse-casing';
const PHOTO_LAYER = 'rover-photo-sites';
const PHOTO_SOURCE = 'rover-photo-sites-source';
const TRAVERSE_SOURCE = 'rover-traverse-source';

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function groupPhotoSites(photos: PhotoRecord[]) {
  const sites = new Map<string, { lon: number; lat: number; sols: number[] }>();
  for (const photo of photos) {
    const key = `${photo.lon.toFixed(6)},${photo.lat.toFixed(6)}`;
    const site = sites.get(key) ?? { lon: photo.lon, lat: photo.lat, sols: [] };
    site.sols.push(photo.sol);
    sites.set(key, site);
  }
  return {
    type: 'FeatureCollection' as const,
    features: [...sites.values()].map((site) => ({
      type: 'Feature' as const,
      properties: {
        count: site.sols.length,
        solFrom: Math.min(...site.sols),
        solTo: Math.max(...site.sols),
      } satisfies PhotoSiteProperties,
      geometry: { type: 'Point' as const, coordinates: [site.lon, site.lat] },
    })),
  };
}

function stylePhotoLabel(popup: Popup): void {
  const element = popup.getElement();
  const content = element.querySelector<HTMLElement>('.maplibregl-popup-content');
  const tip = element.querySelector<HTMLElement>('.maplibregl-popup-tip');
  if (content) {
    content.style.background = token('--map-tag-bg');
    content.style.color = token('--map-label-text');
    content.style.borderRadius = token('--radius-1');
    content.style.padding = 'var(--space-1) var(--space-2)';
    content.style.fontFamily = 'var(--font-ui)';
    content.style.fontSize = 'var(--text-sm)';
    content.style.lineHeight = 'var(--leading-sm)';
    content.style.fontVariantNumeric = 'var(--numeric)';
    content.style.boxShadow = 'none';
  }
  if (tip) tip.style.borderTopColor = token('--map-label-halo');
}

export async function addRoverOverlays(
  map: MapLibreMap,
  siteId: string,
  enabled: RoverOverlayState,
): Promise<void> {
  try {
    const [traverseResponse, photosResponse] = await Promise.all([
      fetch(resolveSiteAssetUrl(siteId, `/data/${siteId}/traverse.geojson`)),
      fetch(resolveSiteAssetUrl(siteId, `/data/${siteId}/photos.json`)),
    ]);
    if (!traverseResponse.ok || !map.getStyle()) return;
    const traverse = await traverseResponse.json();
    const isPhotoJson = photosResponse.headers.get('content-type')?.includes('json') ?? false;
    const photos = photosResponse.ok && isPhotoJson ? await photosResponse.json() as PhotoRecord[] : [];
    if (map.getSource(TRAVERSE_SOURCE) || map.getSource(PHOTO_SOURCE)) return;

    map.addSource(TRAVERSE_SOURCE, { type: 'geojson', data: traverse });
    map.addLayer({
      id: TRAVERSE_CASING_LAYER,
      type: 'line',
      source: TRAVERSE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': token('--map-label-halo'), 'line-width': 3.5, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: TRAVERSE_LAYER,
      type: 'line',
      source: TRAVERSE_SOURCE,
      layout: { visibility: enabled.traverse ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': token('--map-label-text'), 'line-width': 1.5, 'line-opacity': 0.95 },
    });

    map.addSource(PHOTO_SOURCE, { type: 'geojson', data: groupPhotoSites(photos), generateId: true });
    map.addLayer({
      id: PHOTO_LAYER,
      type: 'circle',
      source: PHOTO_SOURCE,
      layout: { visibility: enabled.photos ? 'visible' : 'none' },
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          10, ['case', ['boolean', ['feature-state', 'hover'], false], 3,
            ['interpolate', ['linear'], ['get', 'count'], 1, 1.25, 20, 1.7, 100, 2.2]],
          14, ['case', ['boolean', ['feature-state', 'hover'], false], 5,
            ['interpolate', ['linear'], ['get', 'count'], 1, 2, 20, 3, 100, 4]],
        ],
        'circle-color': token('--ramp-seq-2'),
        'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0.48],
        'circle-stroke-width': 0,
      },
    });

    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'rover-photo-label' });
    let hoveredFeatureId: number | string | undefined;
    map.on('mousemove', PHOTO_LAYER, (event) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = event.features?.[0];
      if (!feature?.geometry || feature.geometry.type !== 'Point') return;
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: PHOTO_SOURCE, id: hoveredFeatureId }, { hover: false });
      }
      hoveredFeatureId = feature.id;
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: PHOTO_SOURCE, id: hoveredFeatureId }, { hover: true });
      }
      const properties = feature.properties as PhotoSiteProperties;
      const coordinates = feature.geometry.coordinates as [number, number];
      popup.setLngLat(coordinates)
        .setText(`${properties.count} photos · sol ${properties.solFrom}–${properties.solTo}`)
        .addTo(map);
      stylePhotoLabel(popup);
    });
    map.on('mouseleave', PHOTO_LAYER, () => {
      map.getCanvas().style.cursor = '';
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: PHOTO_SOURCE, id: hoveredFeatureId }, { hover: false });
        hoveredFeatureId = undefined;
      }
      popup.remove();
    });

    map.moveLayer(TRAVERSE_CASING_LAYER);
    map.moveLayer(TRAVERSE_LAYER);
    map.moveLayer(PHOTO_LAYER);
    if (map.getLayer('planned-route-casing')) map.moveLayer('planned-route-casing');
    if (map.getLayer('planned-route-core')) map.moveLayer('planned-route-core');
  } catch {
    // Rover overlays are optional when a site's compact data files are unavailable.
  }
}

export function setRoverOverlayVisibility(map: MapLibreMap, state: RoverOverlayState): void {
  if (map.getLayer(TRAVERSE_CASING_LAYER)) map.setLayoutProperty(TRAVERSE_CASING_LAYER, 'visibility', state.traverse ? 'visible' : 'none');
  if (map.getLayer(TRAVERSE_LAYER)) map.setLayoutProperty(TRAVERSE_LAYER, 'visibility', state.traverse ? 'visible' : 'none');
  if (map.getLayer(PHOTO_LAYER)) map.setLayoutProperty(PHOTO_LAYER, 'visibility', state.photos ? 'visible' : 'none');
}
