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
  const [currentZoom, setCurrentZoom] = useState(13);

  // Initialize Map
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

    map.on('zoom', () => {
      setCurrentZoom(map.getZoom());
    });

    // Suppress unhandled tile 404 warnings from breaking console
    map.on('error', (e: { error?: { message?: string } }) => {
      // Tile 404s when PMTiles / Trek tiles are absent are expected in stub mode
      if (e?.error?.message?.includes('404')) {
        return;
      }
    });

    map.on('load', () => {
      mapRef.current = map;
      setMapInstance(map);

      // Fit site bounds
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 30, maxZoom: 14 }
      );

      // 5. Terrain from terrain.pmtiles (terrain-RGB, Mapbox encoding) with modest exaggeration
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
          // Terrain file will load once bundled
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
                'circle-radius': 5.5,
                'circle-color': '#f59e0b',
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff',
                'circle-opacity': state.opacity,
              },
            });
          }
        } catch {
          // Layer will render as assets arrive
        }
      });

      // Default Rover drop-off marker
      if (siteData.default_start) {
        const el = document.createElement('div');
        el.className = 'rover-marker';
        el.style.width = '24px';
        el.style.height = '24px';
        el.style.backgroundColor = '#2563eb';
        el.style.border = '2px solid #ffffff';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 0 10px rgba(37,99,235,0.8)';
        el.style.cursor = 'pointer';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.innerHTML = `<span style="font-size:11px;color:#fff;font-weight:bold;">R</span>`;

        const popup = new Popup({ offset: 15 }).setHTML(`
          <div style="color:#0f172a;padding:4px;font-family:sans-serif;">
            <strong style="font-size:13px;">${siteData.default_start.label}</strong>
            <div style="font-size:11px;color:#475569;margin-top:2px;">
              Lon: ${siteData.default_start.lon.toFixed(4)}°<br/>
              Lat: ${siteData.default_start.lat.toFixed(4)}°
            </div>
            <div style="font-size:10px;color:#2563eb;margin-top:4px;font-weight:600;">
              Mission Origin / Return Point
            </div>
          </div>
        `);

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

  // Synchronize layer visibility & opacity updates
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
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      setIs3D(false);
    } else {
      map.easeTo({ pitch: 55, bearing: -15, duration: 800 });
      setIs3D(true);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Map Container */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* 2D / 3D Terrain Pitch Toggle */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '54px',
          zIndex: 20,
        }}
      >
        <button
          onClick={toggle3D}
          style={{
            backgroundColor: '#0f172a',
            color: is3D ? '#38bdf8' : '#f8fafc',
            border: is3D ? '1px solid #38bdf8' : '1px solid #334155',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            transition: 'all 0.15s ease',
          }}
          title="Toggle 2D Plan / 3D Relief Pitch"
        >
          {is3D ? '3D Relief (Active)' : '2D Plan'}
        </button>
      </div>

      {/* Coordinate & Zoom Telemetry */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(51, 65, 85, 0.8)',
          borderRadius: '4px',
          padding: '4px 10px',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#cbd5e1',
          pointerEvents: 'none',
        }}
      >
        <span>CENTER: {siteData.origin.lon0.toFixed(3)}°E, {siteData.origin.lat_c.toFixed(3)}°N</span>
        <span style={{ margin: '0 6px', color: '#64748b' }}>|</span>
        <span>ZOOM: {currentZoom.toFixed(1)}</span>
      </div>

      {/* 6. Custom Scale Bar in True Mars Metres */}
      <ScaleBar map={mapInstance} defaultLat={siteData.origin.lat_c} />
    </div>
  );
};
