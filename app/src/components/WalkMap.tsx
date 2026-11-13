// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Plan } from '../lib/plan';
import { SiteData } from '../types';
import { RouteTrack } from '../walk/track';
import { addOpticalImage, marsBaseStyle, setupPMTilesProtocol } from './mapSetup';

interface WalkMapProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  lon: number;
  lat: number;
}

export const WalkMap: React.FC<WalkMapProps> = ({ siteData, plan, track, lon, lat }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<Marker | null>(null);
  const positionRef = useRef<[number, number]>([lon, lat]);
  positionRef.current = [lon, lat];

  useEffect(() => {
    setupPMTilesProtocol();
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: marsBaseStyle(),
      center: positionRef.current,
      zoom: 14,
    });

    const marker = new Marker().setLngLat(positionRef.current).addTo(map);
    markerRef.current = marker;

    map.on('load', () => {
      addOpticalImage(map, siteData);

      map.addSource('walk-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: track.vertices.map((v) => [v.lon, v.lat]) },
        },
      });
      map.addLayer({
        id: 'walk-route',
        type: 'line',
        source: 'walk-route',
        paint: { 'line-color': '#f59e0b', 'line-width': 3 },
      });

      map.addSource('walk-waypoints', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [plan.start, ...plan.stops].map((p) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          })),
        },
      });
      map.addLayer({
        id: 'walk-waypoints',
        type: 'circle',
        source: 'walk-waypoints',
        paint: { 'circle-radius': 6, 'circle-color': '#2563eb', 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' },
      });

      if (track.vertices.length > 1) {
        const bounds = new LngLatBounds();
        track.vertices.forEach((v) => bounds.extend([v.lon, v.lat]));
        map.fitBounds(bounds, { padding: 40, duration: 0 });
      }
    });

    return () => {
      marker.remove();
      markerRef.current = null;
      map.remove();
    };
  }, [siteData, plan, track]);

  useEffect(() => {
    markerRef.current?.setLngLat([lon, lat]);
  }, [lon, lat]);

  return <div ref={containerRef} className="s48-walk-map" />;
};
