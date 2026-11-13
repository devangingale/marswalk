// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  NavigationControl,
  AttributionControl,
  addProtocol,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { SiteData, LayerState } from '../types';
import { resolveSiteAssetUrl } from '../config';
import { ScaleBar } from './ScaleBar';

interface MapProps {
  siteData: SiteData;
  layerStates: Record<string, LayerState>;
}

let pmtilesProtocolInitialized = false;

function setupPMTilesProtocol() {
  if (!pmtilesProtocolInitialized) {
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    pmtilesProtocolInitialized = true;
  }
}

export const Map: React.FC<MapProps> = ({ siteData, layerStates }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
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
      style: {
        version: 8,
        name: 'Sol-48 Mars Basemap',
        sources: {
          mars_mola_trek: {
            type: 'raster',
            tiles: [
              'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0//default/default028mm/{z}/{y}/{x}.jpg',
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
              'background-color': '#111726',
            },
          },
          {
            id: 'mars-trek-layer',
            type: 'raster',
            source: 'mars_mola_trek',
            minzoom: 0,
            maxzoom: 9,
            paint: {
              'raster-opacity': 0.7,
            },
          },
        ],
      },
      center: [centerLon, centerLat],
      zoom: 13,
      maxPitch: 75,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    map.on('error', (e: { error?: { message?: string } }) => {
      // 404s when PMTiles or Mars Trek tiles are missing are expected during local scaffold
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
        { padding: 20, maxZoom: 14 }
      );

      // Terrain from terrain.pmtiles (terrain-RGB, Mapbox encoding)
      if (siteData.terrain?.url) {
        try {
          const terrainUrl = resolveSiteAssetUrl(siteData.id, siteData.terrain.url);
          map.addSource('site-terrain-rgb', {
            type: 'raster-dem',
            url: `pmtiles://${terrainUrl}`,
            tileSize: 256,
            encoding: siteData.terrain.encoding || 'mapbox',
            maxzoom: 15,
          });

          map.setTerrain({
            source: 'site-terrain-rgb',
            exaggeration: 1.35,
          });
        } catch {
          // Terrain will bind when file is present
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
                'circle-color': '#f59e0b',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
                'circle-opacity': state.opacity,
              },
            });
          }
        } catch {
          // Layer will bind when file is present
        }
      });

      // Rover drop-off marker
      if (siteData.default_start) {
        const el = document.createElement('div');
        el.className = 's48-rover-marker';
        el.textContent = 'R';
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#2563eb';
        el.style.color = '#ffffff';
        el.style.textAlign = 'center';
        el.style.lineHeight = '20px';
        el.style.fontWeight = 'bold';
        el.style.fontSize = '12px';

        const popup = new Popup({ offset: 12 }).setText(
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
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, [siteData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    siteData.layers.forEach((layer) => {
      const state = layerStates[layer.id];
      if (!state) return;

      const layerId = `lyr-${layer.id}`;
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
    <div className="s48-map-container">
      <div ref={mapContainerRef} className="s48-map-viewport" />

      <div className="s48-terrain-toggle" style={{ position: 'absolute', top: 12, right: 50, zIndex: 10 }}>
        <button type="button" onClick={toggle3D}>
          {is3D ? '2D View' : '3D Relief'}
        </button>
      </div>

      <ScaleBar map={mapInstance} defaultLat={siteData.origin.lat_c} />
    </div>
  );
};
