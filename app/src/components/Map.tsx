// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  NavigationControl,
  AttributionControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource } from 'maplibre-gl';
import type { SiteData, LayerState, ChemistryProperties } from '../types';
import { resolveSiteAssetUrl } from '../config';
import { groupChemistryByPosition } from '../lib/chemistry';
import type { ChemistryFeature } from '../lib/chemistry';
import { shiftedDemDecoding } from '../lib/terrain';
import { ScaleBar } from './ScaleBar';
import { marsBaseStyle, setupPMTilesProtocol } from './mapSetup';
import type { Plan, PlanStart, PlanStop } from '../lib/plan';

interface MapProps {
  siteData: SiteData;
  layerStates: Record<string, LayerState>;
  plan?: Plan;
  onMapPoint?: (point: { lon: number; lat: number }) => void;
  onStartChange?: (start: PlanStart) => void;
  onStopChange?: (stop: PlanStop) => void;
}

export const Map: React.FC<MapProps> = ({ siteData, layerStates, plan, onMapPoint, onStartChange, onStopChange }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const chemistryMarkersRef = useRef<Marker[]>([]);
  const planMarkersRef = useRef<Marker[]>([]);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [is3D, setIs3D] = useState(false);

  useEffect(() => {
    setupPMTilesProtocol();

    if (!mapContainerRef.current) return;

    const bounds = siteData.bounds_lonlat;
    const centerLon = (bounds[0] + bounds[2]) / 2;
    const centerLat = (bounds[1] + bounds[3]) / 2;

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: marsBaseStyle(siteData),
      center: [centerLon, centerLat],
      zoom: 13,
      maxPitch: 75,
      attributionControl: false,
    });
    const mapResizeObserver = new ResizeObserver(() => map.resize());
    mapResizeObserver.observe(mapContainerRef.current);

    map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    map.on('error', (e: { error?: { message?: string } }) => {
      // Missing PMTiles or external Trek tile 404s are handled gracefully
      if (e?.error?.message?.includes('404')) {
        return;
      }
    });

    map.on('load', () => {
      mapRef.current = map;
      setMapInstance(map);

      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 8, maxZoom: 14 }
      );

      map.addSource('planned-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'planned-route-casing', type: 'line', source: 'planned-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': getComputedStyle(document.documentElement).getPropertyValue('--map-route-casing').trim(), 'line-width': 8 } });
      map.addLayer({ id: 'planned-route-core', type: 'line', source: 'planned-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': getComputedStyle(document.documentElement).getPropertyValue('--map-route-core').trim(), 'line-width': 4 } });
      map.on('click', (event) => onMapPoint?.({ lon: event.lngLat.lng, lat: event.lngLat.lat }));

      // Terrain from terrain.pmtiles (terrain-RGB, Mapbox encoding)
      if (siteData.terrain?.url) {
        try {
          const terrainUrl = resolveSiteAssetUrl(siteData.id, siteData.terrain.url);
          map.addSource('site-terrain-rgb', {
            type: 'raster-dem',
            url: `pmtiles://${terrainUrl}`,
            tileSize: 256,
            encoding: 'custom',
            ...shiftedDemDecoding(siteData.terrain),
            maxzoom: 15,
          });

          map.setTerrain({
            source: 'site-terrain-rgb',
            exaggeration: 1.35,
          });
        } catch {
          // Terrain binds when file lands
        }
      }

      // Add Raster and GeoJSON layers
      siteData.layers.forEach((layer) => {
        const state = layerStates[layer.id] || {
          enabled: layer.default_on,
          opacity: 1.0,
        };

        const resolvedUrl = resolveSiteAssetUrl(siteData.id, layer.url);

        try {
          if (layer.type === 'raster') {
            map.addSource(`src-${layer.id}`, {
              type: 'raster',
              url: `pmtiles://${resolvedUrl}`,
              tileSize: 256,
              bounds: siteData.bounds_lonlat,
            });

            map.addLayer({
              id: `lyr-${layer.id}`,
              type: 'raster',
              source: `src-${layer.id}`,
              layout: {
                visibility: state.enabled ? 'visible' : 'none',
              },
              paint: {
                'raster-opacity': state.opacity,
              },
            });
          } else if (layer.type === 'points' && layer.id === 'chemistry_apxs') {
            void fetch(resolvedUrl)
              .then((response) => {
                if (!response.ok) throw new Error(`Chemistry request failed: ${response.status}`);
                return response.json() as Promise<{ features: ChemistryFeature[] }>;
              })
              .then((geojson) => {
                for (const group of groupChemistryByPosition(geojson.features)) {
                  const marker = document.createElement('div');
                  marker.setAttribute('aria-label', `${group.measurements.length} APXS observations`);
                  marker.style.width = '12px';
                  marker.style.height = '12px';
                  marker.style.borderRadius = '50%';
                  marker.style.background = '#f2f5f7';
                  marker.style.border = '2px solid #0a1828';
                  marker.style.opacity = String(state.opacity);
                  const names = group.measurements.map((measurement: ChemistryProperties) =>
                    String(measurement.target ?? 'APXS observation')
                  );
                  const list = document.createElement('ul');
                  for (const name of names) {
                    const item = document.createElement('li');
                    item.textContent = name;
                    list.appendChild(item);
                  }
                  const popup = new Popup({ offset: 10, maxWidth: '320px' }).setDOMContent(list);
                  const chemistryMarker = new Marker({ element: marker })
                    .setLngLat([group.lon, group.lat])
                    .setPopup(popup)
                    .addTo(map);
                  chemistryMarkersRef.current.push(chemistryMarker);
                }
              })
              .catch(() => {
                // Chemistry is optional in the Plan map.
              });
          } else if (layer.type === 'points') {
            map.addSource(`src-${layer.id}`, {
              type: 'geojson',
              data: resolvedUrl,
            });

            map.addLayer({
              id: `lyr-${layer.id}`,
              type: 'circle',
              source: `src-${layer.id}`,
              layout: {
                visibility: state.enabled ? 'visible' : 'none',
              },
              paint: {
                'circle-radius': 5,
                'circle-color': '#f2f5f7',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#0a1828',
                'circle-opacity': state.opacity,
              },
            });
          }
        } catch {
          // Layer binds when file lands
        }
      });

      map.moveLayer('planned-route-casing');
      map.moveLayer('planned-route-core');

      // Start / Habitat marker: 20x20 square with dark casing (contracts section 5, design section 6)
      if (siteData.default_start && !plan) {
        const el = document.createElement('div');
        el.className = 's48-square';
        el.setAttribute('title', siteData.default_start.label);
        el.setAttribute('aria-label', siteData.default_start.label);

        const popup = new Popup({ offset: 12, closeButton: false }).setText(
          `${siteData.default_start.label} (${siteData.default_start.lon.toFixed(4)}°, ${siteData.default_start.lat.toFixed(4)}°)`
        );

        markerRef.current = new Marker({ element: el })
          .setLngLat([siteData.default_start.lon, siteData.default_start.lat])
          .setPopup(popup)
          .addTo(map);
      }
    });

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
      }
      chemistryMarkersRef.current.forEach((marker) => marker.remove());
      chemistryMarkersRef.current = [];
      mapResizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, [siteData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !plan) return;
    const source = map.getSource('planned-route') as GeoJSONSource | undefined;
    if (source) {
      const coordinates = plan.route.legs.flatMap((leg, index) => index ? leg.line.slice(1) : leg.line);
      source.setData({ type: 'FeatureCollection', features: coordinates.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] : [] });
    }
    planMarkersRef.current.forEach((marker) => marker.remove());
    planMarkersRef.current = [];
    const startElement = document.createElement('div');
    startElement.className = 'plan-map-start'; startElement.title = 'Rover drop-off'; startElement.setAttribute('aria-label', 'Rover drop-off');
    startElement.innerHTML = '<svg viewBox="0 0 30 30" aria-hidden="true"><path class="start-marker__body" d="M15 1.8 27.8 9.2 27.8 20.8 15 28.2 2.2 20.8 2.2 9.2Z"/><path class="start-marker__glyph" d="M10 18.5 12.4 12h5.2l2.4 6.5M9.5 19.5h11M12.4 12l2.6-3 2.6 3M15 9v9.5"/></svg>';
    const startLabel = document.createElement('span'); startLabel.textContent = 'Rover drop-off'; startElement.appendChild(startLabel);
    const startMarker = new Marker({ element: startElement, draggable: true }).setLngLat([plan.start.lon, plan.start.lat]).addTo(map);
    startMarker.on('dragend', () => onStartChange?.({ ...plan.start, lon: startMarker.getLngLat().lng, lat: startMarker.getLngLat().lat }));
    planMarkersRef.current.push(startMarker);
    plan.stops.forEach((stop, index) => {
      const element = document.createElement('div');
      element.className = `plan-map-stop${plan.route.warnings.some((warning) => warning.includes(stop.name)) ? ' is-unreachable' : ''}`;
      element.textContent = String(index + 1); element.title = stop.name; element.setAttribute('aria-label', `${stop.name}${element.classList.contains('is-unreachable') ? ', unreachable' : ''}`);
      const stopMarker = new Marker({ element, draggable: true }).setLngLat([stop.lon, stop.lat]).addTo(map);
      stopMarker.on('dragend', () => onStopChange?.({ ...stop, lon: stopMarker.getLngLat().lng, lat: stopMarker.getLngLat().lat }));
      planMarkersRef.current.push(stopMarker);
    });
    const turnBackRequired = plan.route.totals.time_s > plan.params.time_limit_s
      || (plan.params.energy_limit_kj !== undefined && plan.route.totals.energy_kj > plan.params.energy_limit_kj);
    if (plan.stops.length > 0 && plan.route.turn_back && turnBackRequired) {
      const turn = document.createElement('div'); turn.className = 'plan-map-turn'; turn.title = 'Turn-back point'; turn.setAttribute('aria-label', 'Turn-back point');
      const turnLabel = document.createElement('span'); turnLabel.textContent = 'Turn-back point'; turn.appendChild(turnLabel);
      planMarkersRef.current.push(new Marker({ element: turn }).setLngLat([plan.route.turn_back.lon, plan.route.turn_back.lat]).addTo(map));
    }
  }, [plan, onStartChange, onStopChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    siteData.layers.forEach((layer) => {
      const state = layerStates[layer.id];
      if (!state) return;

      const layerId = `lyr-${layer.id}`;
      if (layer.id === 'chemistry_apxs') {
        chemistryMarkersRef.current.forEach((marker) => {
          const element = marker.getElement();
          element.style.display = state.enabled ? '' : 'none';
          element.style.opacity = String(state.opacity);
        });
      }
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', state.enabled ? 'visible' : 'none');
        if (layer.type === 'raster') {
          map.setPaintProperty(layerId, 'raster-opacity', state.opacity);
        } else if (layer.type === 'points') {
          map.setPaintProperty(layerId, 'circle-opacity', state.opacity);
        }
      }
    });
  }, [layerStates, siteData]);

  const toggle3D = () => {
    const map = mapRef.current;
    if (!map) return;

    if (is3D) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      setIs3D(false);
    } else {
      map.easeTo({ pitch: 55, bearing: -15, duration: 600 });
      setIs3D(true);
    }
  };

  return (
    <div className="mapbox" style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      <div className="map-ui" style={{ right: '54px', top: 'var(--space-3)' }}>
        <button
          type="button"
          className="s48-btn s48-btn--secondary"
          onClick={toggle3D}
          style={{ minHeight: 'var(--map-stop-size)', padding: '0 var(--space-2)', fontSize: 'var(--text-sm)' }}
        >
          {is3D ? '2D view' : '3D relief'}
        </button>
      </div>

      <ScaleBar map={mapInstance} defaultLat={siteData.origin.lat_c} />
    </div>
  );
};
