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
import { useSharedPlayback } from '../walk/usePlayback';
import { PlaybackBar } from '../walk/PlaybackBar';
import { addOpticalImage, marsBaseStyle, setupPMTilesProtocol } from './mapSetup';
import './walk.css';

const EARTH_R = 6371008.8;
const EXAGGERATION = EARTH_R / MARS_R;
const TERRAIN = 'visor-terrain';
type HazardData = { status: 'loading' } | { status: 'ready'; flags: boolean[] } | { status: 'error' };
interface VisorViewProps { siteData: SiteData; plan: Plan; track: RouteTrack; elapsedS: number }

export const VisorView: React.FC<VisorViewProps> = ({ siteData, plan, track, elapsedS }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const playback = useSharedPlayback(track.durationS, elapsedS);
  const [hazardData, setHazardData] = useState<HazardData>({ status: 'loading' });
  const state = walkStateAt(plan, track, elapsedS);
  const budget = budgetRemaining(plan, state.used);
  const pose = useMemo(() => ({ lon: state.lon, lat: state.lat, headingDeg: state.headingDeg }), [state.lon, state.lat, state.headingDeg]);
  const poseRef = useRef(pose); poseRef.current = pose;

  useEffect(() => { let cancelled = false; setHazardData({status:'loading'}); loadGrid(getSiteBaseUrl(siteData.id), siteData.origin).then(grid => { if (!cancelled) setHazardData({status:'ready', flags: hazardFlags(track.vertices, grid)}); }).catch(() => { if (!cancelled) setHazardData({status:'error'}); }); return () => {cancelled = true;}; }, [siteData, track]);
  useEffect(() => {
    setupPMTilesProtocol(); if (!containerRef.current) return;
    const style = marsBaseStyle();
    const css = getComputedStyle(document.documentElement);
    const skyToken = (name: string) => css.getPropertyValue(name).trim();
    style.sky = {
      'sky-color': skyToken('--visor-sky'),
      'horizon-color': skyToken('--visor-horizon'),
      'fog-color': skyToken('--visor-fog'),
      'sky-horizon-blend': 0.35,
      'horizon-fog-blend': 0.8,
      'atmosphere-blend': 0.7,
    };
    const decoding = shiftedDemDecoding(siteData.terrain);
    style.sources[TERRAIN] = { type:'raster-dem', url:`pmtiles://${resolveSiteAssetUrl(siteData.id, siteData.terrain.url)}`, tileSize:256, encoding:'custom', ...decoding };
    style.terrain = { source:TERRAIN, exaggeration:EXAGGERATION };
    const map = new MapLibreMap({ container:containerRef.current, style, center:[poseRef.current.lon,poseRef.current.lat], zoom:18, maxPitch:85, pitch:82, bearing:poseRef.current.headingDeg, interactive:false, attributionControl:false, centerClampedToGround:false });
    const placeCamera = () => { try { placeEyeCamera(map, poseRef.current); } catch (error) { console.error('Visor camera placement failed', error); } };
    map.on('load', () => { try { addOpticalImage(map, siteData); mapRef.current = map; placeCamera(); } catch (error) { console.error('Visor terrain setup failed', error); } });
    map.on('error', e => console.error('Visor map error', e.error));
    map.on('sourcedata', e => { if (e.sourceId === TERRAIN && e.isSourceLoaded) placeCamera(); });
    return () => { mapRef.current = null; map.remove(); };
  }, [siteData]);
  useEffect(() => { if (mapRef.current) placeEyeCamera(mapRef.current, pose); }, [pose]);
  const hazardM = hazardData.status === 'ready' ? hazardAhead(track.vertices, hazardData.flags, state.alongM) : null;
  const [visibleHazardM, setVisibleHazardM] = useState<number | null>(hazardM);
  useEffect(() => {
    if (hazardM !== null) { setVisibleHazardM(hazardM); return; }
    const timeout = window.setTimeout(() => setVisibleHazardM(null), 160);
    return () => window.clearTimeout(timeout);
  }, [hazardM]);
  const next = state.next ? waypointById(plan, state.next.id) : null;
  return <div className="s48-visor" data-theme="dark">
    <div ref={containerRef} className="s48-visor-map" />
    <div className="s48-visor-overlay">
      <div className="s48-visor-heading"><span>Heading</span><div className="s48-heading-tape" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => {
        const bearing = ((Math.round(state.headingDeg / 10) * 10 + (index - 2) * 10) % 360 + 360) % 360;
        return <span key={index}><i className={index === 2 ? 'is-current' : ''} /><small>{String(bearing).padStart(3, '0')}</small></span>;
      })}</div><strong>{formatHeading(state.headingDeg)}</strong></div>
      <div className="s48-visor-next"><span>Next stop</span><strong>{next && state.next ? formatDistance(state.next.distanceM) : 'Home'}</strong><small>{next?.name}</small></div>
      <div className="s48-visor-budget"><span>Remaining</span><strong>{formatDuration(budget.time.remaining)}</strong><small>{formatEnergy(budget.energy.remaining)}</small><small>{formatDose(budget.dose.remaining)}</small></div>
      <div role="alert" aria-hidden={hazardM === null} className={`s48-visor-hazard${hazardM === null ? ' is-hidden' : ''}`}>{visibleHazardM !== null && `Impassable ${formatDistance(visibleHazardM)} ahead`}</div>
    </div>
    <div className="s48-visor-controls"><PlaybackBar playback={playback} durationS={track.durationS} elapsedS={elapsedS} /></div>
  </div>;
};
function placeEyeCamera(map: MapLibreMap, pose: {lon:number;lat:number;headingDeg:number}) {
  const at:[number,number]=[pose.lon,pose.lat]; const ground=map.queryTerrainElevation(at) ?? 0;
  map.jumpTo({center:at,elevation:ground});
  map.jumpTo(map.calculateCameraOptionsFromCameraLngLatAltRotation(at,ground+1.7*EXAGGERATION,pose.headingDeg,82));
}
