// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getSiteBaseUrl, resolveSiteAssetUrl } from '../config';
import { loadGrid, MARS_R } from '../lib/grid';
import { Plan } from '../lib/plan';
import { shiftedDemDecoding } from '../lib/terrain';
import { SiteData } from '../types';
import { formatDistance, formatDose, formatDuration, formatEnergy, formatHeading } from '../walk/format';
import { hazardAhead, hazardFlags } from '../walk/hazard';
import { budgetRemaining, RouteTrack, walkStateAt, waypointById } from '../walk/track';
import { addOpticalImage, marsBaseStyle, setupPMTilesProtocol } from './mapSetup';

/** MapLibre's Earth radius. It draws Mars on a sphere this size, stretching ground distances. */
const MAPLIBRE_EARTH_RADIUS_M = 6371008.8;
/** Heights stretched by the same ratio as ground distances keep the terrain in true proportion. */
const TRUE_PROPORTION_EXAGGERATION = MAPLIBRE_EARTH_RADIUS_M / MARS_R;
const EYE_HEIGHT_M = 1.7;
/** Degrees from straight down; 90 is the horizon. */
const VISOR_PITCH_DEG = 82;
const TERRAIN_SOURCE = 'visor-terrain';
type HazardData =
  | { status: 'loading' }
  | { status: 'ready'; flags: boolean[] }
  | { status: 'error'; message: string };

interface VisorViewProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  elapsedS: number;
}

export const VisorView: React.FC<VisorViewProps> = ({ siteData, plan, track, elapsedS }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [hazardData, setHazardData] = useState<HazardData>({ status: 'loading' });

  const state = walkStateAt(plan, track, elapsedS);
  const budget = budgetRemaining(plan, state.used);
  const pose = useMemo(
    () => ({ lon: state.lon, lat: state.lat, headingDeg: state.headingDeg }),
    [state.lon, state.lat, state.headingDeg]
  );
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => {
    let cancelled = false;
    setHazardData({ status: 'loading' });
    loadGrid(getSiteBaseUrl(siteData.id), siteData.origin)
      .then((grid) => {
        if (!cancelled) setHazardData({ status: 'ready', flags: hazardFlags(track.vertices, grid) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setHazardData({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [siteData, track]);

  useEffect(() => {
    setupPMTilesProtocol();
    if (!containerRef.current) return;

    const style = marsBaseStyle();
    // MapLibre draws terrain kilometres below sea level as a blank view, and Mars sites lie that far
    // below datum, so the visor lifts the site's lowest point to 0 m. Only relative heights are seen.
    const decoding = shiftedDemDecoding(siteData.terrain);
    style.sources[TERRAIN_SOURCE] = {
      type: 'raster-dem',
      url: `pmtiles://${resolveSiteAssetUrl(siteData.id, siteData.terrain.url)}`,
      tileSize: 256,
      encoding: 'custom',
      ...decoding,
    };
    style.terrain = { source: TERRAIN_SOURCE, exaggeration: TRUE_PROPORTION_EXAGGERATION };

    const map = new MapLibreMap({
      container: containerRef.current,
      style,
      center: [poseRef.current.lon, poseRef.current.lat],
      zoom: 18,
      maxPitch: 85,
      interactive: false,
      attributionControl: false,
      centerClampedToGround: false,
    });

    const placeCamera = () => placeEyeCamera(map, poseRef.current);
    map.on('load', () => {
      addOpticalImage(map, siteData);
      mapRef.current = map;
      placeCamera();
    });
    map.on('sourcedata', (e) => {
      if (e.sourceId === TERRAIN_SOURCE && e.isSourceLoaded) placeCamera();
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [siteData]);

  useEffect(() => {
    if (mapRef.current) placeEyeCamera(mapRef.current, pose);
  }, [pose]);

  const hazardM =
    hazardData.status === 'ready' ? hazardAhead(track.vertices, hazardData.flags, state.alongM) : null;
  const next = state.next ? waypointById(plan, state.next.id) : null;

  return (
    <div className="s48-visor">
      <div ref={containerRef} className="s48-visor-map" />
      <div className="s48-visor-overlay">
        <p className="s48-visor-heading">{formatHeading(state.headingDeg)}</p>
        <p className="s48-visor-next">
          {next && state.next ? `${next.name} ${formatDistance(state.next.distanceM)}` : `At ${plan.start.label}`}
        </p>
        <p className="s48-visor-budget">
          Left: {formatDuration(budget.time.remaining)} · {formatEnergy(budget.energy.remaining)} ·{' '}
          {formatDose(budget.dose.remaining)}
        </p>
        {hazardM !== null && (
          <p role="alert" className="s48-visor-hazard">
            Impassable ground {formatDistance(hazardM)} ahead
          </p>
        )}
        {hazardData.status === 'error' && (
          <p role="alert" className="s48-visor-hazard">
            Hazard data unavailable: {hazardData.message}
          </p>
        )}
      </div>
    </div>
  );
};

/** Puts the camera at eye height above the ground under the walker, facing the route heading. */
function placeEyeCamera(map: MapLibreMap, pose: { lon: number; lat: number; headingDeg: number }) {
  const at: [number, number] = [pose.lon, pose.lat];
  const ground = map.queryTerrainElevation(at) ?? 0;
  // The camera solver measures eye height from the current centre's elevation, so seat it on the ground first.
  map.jumpTo({ center: at, elevation: ground });
  map.jumpTo(
    map.calculateCameraOptionsFromCameraLngLatAltRotation(
      at,
      ground + EYE_HEIGHT_M * TRUE_PROPORTION_EXAGGERATION,
      pose.headingDeg,
      VISOR_PITCH_DEG
    )
  );
}
