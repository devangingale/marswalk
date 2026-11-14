import React, { useEffect, useRef } from 'react';
import { GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Plan } from '../lib/plan';
import { SiteData } from '../types';
import { RouteTrack } from '../walk/track';
import { addOpticalImage, marsBaseStyle, setupPMTilesProtocol } from './mapSetup';

interface WalkMapProps { siteData: SiteData; plan: Plan; track: RouteTrack; lon: number; lat: number; alongM: number }
type Segment = 'ahead' | 'walked';
type RouteData = GeoJSON.FeatureCollection<GeoJSON.LineString, { segment: Segment }>;

export const WalkMap: React.FC<WalkMapProps> = ({ siteData, plan, track, lon, lat, alongM }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const positionRef = useRef<[number, number]>([lon, lat]);
  positionRef.current = [lon, lat];

  useEffect(() => {
    setupPMTilesProtocol();
    if (!containerRef.current) return;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const markerElement = document.createElement('div');
    markerElement.className = 's48-walk-position';
    const map = new MapLibreMap({ container: containerRef.current, style: marsBaseStyle(), center: positionRef.current, zoom: 14 });
    const marker = new Marker({ element: markerElement, anchor: 'center' }).setLngLat(positionRef.current).addTo(map);
    markerRef.current = marker;

    map.on('load', () => {
      addOpticalImage(map, siteData);
      map.addSource('walk-route', { type: 'geojson', data: routeData(track, alongM) });
      for (const segment of ['ahead', 'walked'] as const) {
        map.addLayer({
          id: `walk-route-${segment}-casing`, type: 'line', source: 'walk-route', filter: ['==', ['get', 'segment'], segment],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': token('--map-route-casing'), 'line-width': 8 },
        });
        map.addLayer({
          id: `walk-route-${segment}-core`, type: 'line', source: 'walk-route', filter: ['==', ['get', 'segment'], segment],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': segment === 'ahead' ? token('--map-route-core') : token('--map-route-walked'), 'line-width': 4 },
        });
      }
      map.addSource('walk-waypoints', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [plan.start, ...plan.stops].map((point) => ({
          type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
        })) },
      });
      map.addLayer({
        id: 'walk-waypoints', type: 'circle', source: 'walk-waypoints',
        paint: { 'circle-radius': 10, 'circle-color': token('--map-stop-fill'), 'circle-stroke-width': 2, 'circle-stroke-color': token('--map-stop-ring') },
      });
      mapRef.current = map;
      if (track.vertices.length > 1) {
        const bounds = new LngLatBounds();
        track.vertices.forEach((vertex) => bounds.extend([vertex.lon, vertex.lat]));
        map.fitBounds(bounds, { padding: 40, duration: 0 });
      }
    });
    return () => { marker.remove(); markerRef.current = null; mapRef.current = null; map.remove(); };
  }, [siteData, plan, track]);

  useEffect(() => {
    markerRef.current?.setLngLat([lon, lat]);
    const source = mapRef.current?.getSource('walk-route') as GeoJSONSource | undefined;
    source?.setData(routeData(track, alongM));
  }, [lon, lat, alongM, track]);

  return <div ref={containerRef} className="s48-walk-map" />;
};

function routeData(track: RouteTrack, alongM: number): RouteData {
  const features: RouteData['features'] = [];
  const walked = track.vertices.filter((vertex) => vertex.along_m <= alongM).map((vertex) => [vertex.lon, vertex.lat] as [number, number]);
  const ahead = track.vertices.filter((vertex) => vertex.along_m >= alongM).map((vertex) => [vertex.lon, vertex.lat] as [number, number]);
  if (walked.length > 1) features.push({ type: 'Feature', properties: { segment: 'walked' }, geometry: { type: 'LineString', coordinates: walked } });
  if (ahead.length > 1) features.push({ type: 'Feature', properties: { segment: 'ahead' }, geometry: { type: 'LineString', coordinates: ahead } });
  return { type: 'FeatureCollection', features };
}
