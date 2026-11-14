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
import { SiteData, LayerState } from '../types';
import { resolveSiteAssetUrl } from '../config';
import { ScaleBar } from './ScaleBar';
import { marsBaseStyle, setupPMTilesProtocol } from './mapSetup';

interface MapProps {
  siteData: SiteData;
  layerStates: Record<string, LayerState>;
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
      style: marsBaseStyle(),
      center: [centerLon, centerLat],
      zoom: 13,
      maxPitch: 75,
      attributionControl: false,
    });

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

      // Start / Habitat marker: 20x20 square with dark casing (contracts section 5, design section 6)
      if (siteData.default_start) {
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
    <div className="mapbox" style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      <div className="map-ui" style={{ right: '54px', top: '12px' }}>
        <button
          type="button"
          className="s48-btn s48-btn--secondary"
          onClick={toggle3D}
          style={{ minHeight: '28px', padding: '0 8px', fontSize: '13px' }}
        >
          {is3D ? '2D view' : '3D relief'}
        </button>
      </div>

      <ScaleBar map={mapInstance} defaultLat={siteData.origin.lat_c} />
    </div>
  );
};
