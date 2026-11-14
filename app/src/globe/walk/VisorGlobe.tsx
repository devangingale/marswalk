// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Color,
  Ellipsoid,
  Math as CesiumMath,
  PerspectiveFrustum,
  SkyAtmosphere,
  type Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { getSiteBaseUrl } from '../../config';
import { loadGrid, type RouteGrid } from '../../lib/grid';
import type { Plan } from '../../lib/plan';
import type { SiteData } from '../../types';
import { formatDistance, formatDose, formatDuration, formatEnergy, formatHeading } from '../../walk/format';
import { hazardAhead, hazardFlags } from '../../walk/hazard';
import { budgetRemaining, RouteTrack, walkStateAt, waypointById } from '../../walk/track';
import { useSharedPlayback } from '../../walk/usePlayback';
import { usePlaybackKeys } from '../../walk/usePlaybackKeys';
import { PlaybackBar } from '../../walk/PlaybackBar';
import { createMarsViewer, initCesium } from '../cesiumSetup';
import { siteHeightOffsetM, SPIKE_HEIGHT_OFFSETS_M, visorCamera, type Pose } from '../frame';
import { GlobeImagery } from '../imageryLayers';
import { groundHeightAt } from './cameraMath';
import './walkGlobe.css';
import '../../components/walk.css';

export interface VisorViewProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  elapsedS: number;
  onPlan: () => void;
}

type HazardData = { status: 'loading' } | { status: 'ready'; flags: boolean[] } | { status: 'error' };

export const VisorGlobe: React.FC<VisorViewProps> = ({
  siteData,
  plan,
  track,
  elapsedS,
  onPlan,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const imageryRef = useRef<GlobeImagery | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  const heightOffsetRef = useRef<number>(SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0);

  const playback = useSharedPlayback(track.durationS, elapsedS);
  usePlaybackKeys(playback, track);

  const [hazardData, setHazardData] = useState<HazardData>({ status: 'loading' });
  const state = walkStateAt(plan, track, elapsedS);
  const budget = budgetRemaining(plan, state.used);
  const pose = useMemo(
    () => ({ lon: state.lon, lat: state.lat, headingDeg: state.headingDeg }),
    [state.lon, state.lat, state.headingDeg],
  );
  const poseRef = useRef(pose);
  poseRef.current = pose;

  // Hazard detection
  useEffect(() => {
    let cancelled = false;
    setHazardData({ status: 'loading' });
    loadGrid(getSiteBaseUrl(siteData.id), siteData.origin)
      .then((grid) => {
        if (!cancelled) setHazardData({ status: 'ready', flags: hazardFlags(track.vertices, grid) });
      })
      .catch(() => {
        if (!cancelled) setHazardData({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [siteData, track]);

  // Viewer setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN);

    void (async () => {
      const { viewer, tileset } = await createMarsViewer(container, { interactive: false });
      if (disposed) {
        viewer.destroy();
        return;
      }

      viewerRef.current = viewer;
      (container as any)._viewer = viewer;
      if (tileset) {
        tileset.enableCollision = true;
      }

      // Configure Mars dusk atmosphere, continuous horizon, and distance fog
      const css = getComputedStyle(document.documentElement);
      const skyToken = (name: string) => css.getPropertyValue(name).trim();

      viewer.scene.backgroundColor = Color.fromCssColorString(skyToken('--visor-horizon') || '#938779');
      if (viewer.scene.skyBox) {
        viewer.scene.skyBox.show = false;
      }
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.0006;
      viewer.scene.fog.screenSpaceErrorFactor = 2;
      viewer.scene.skyAtmosphere = new SkyAtmosphere(Ellipsoid.MARS);
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.hueShift = -0.48;
      viewer.scene.skyAtmosphere.saturationShift = -0.3;
      viewer.scene.skyAtmosphere.brightnessShift = -0.15;
      viewer.scene.skyAtmosphere.perFragmentAtmosphere = true;

      // Field of view ~70 degrees, near plane 0.1 m
      if ('fov' in viewer.camera.frustum) {
        (viewer.camera.frustum as PerspectiveFrustum).fov = CesiumMath.toRadians(70);
      }
      if ('near' in viewer.camera.frustum) {
        (viewer.camera.frustum as PerspectiveFrustum).near = 0.1;
      }

      const imagery = new GlobeImagery(tileset ? tileset.imageryLayers : viewer.imageryLayers);
      imageryRef.current = imagery;
      await imagery.setSite(siteData);
      if (disposed) return;

      try {
        const grid = await loadGrid(getSiteBaseUrl(siteData.id), siteData.origin);
        if (disposed) return;
        gridRef.current = grid;
      } catch (error) {
        console.warn('Grid failed to load for VisorGlobe', error);
      }

      // Set initial eye camera position immediately
      placeVisorCamera(viewer, poseRef.current);

      // Measure height offset asynchronously in background without blocking
      if (gridRef.current) {
        void siteHeightOffsetM(viewer, tileset, siteData, gridRef.current)
          .then((offset) => {
            if (disposed) return;
            heightOffsetRef.current = offset;
            placeVisorCamera(viewer, poseRef.current);
          })
          .catch((error) => {
            console.warn('siteHeightOffsetM failed in VisorGlobe', error);
          });
      }
    })();

    return () => {
      disposed = true;
      imageryRef.current?.clear();
      imageryRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [siteData]);

  // Update camera on pose change
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer) {
      placeVisorCamera(viewer, pose);
    }
  }, [pose]);

  function placeVisorCamera(viewer: Viewer, currentPose: Pose) {
    const groundM = groundHeightAt(gridRef.current, currentPose.lon, currentPose.lat, heightOffsetRef.current);
    const cam = visorCamera(currentPose, groundM);
    viewer.camera.setView(cam);
    viewer.scene.requestRender();
  }

  const hazardM = hazardData.status === 'ready' ? hazardAhead(track.vertices, hazardData.flags, state.alongM) : null;
  const hasHazard = hazardM !== null && hazardM > 0;
  const [visibleHazardM, setVisibleHazardM] = useState<number | null>(hasHazard ? hazardM : null);
  useEffect(() => {
    if (hazardM !== null && hazardM > 0) {
      setVisibleHazardM(hazardM);
      return;
    }
    const timeout = window.setTimeout(() => setVisibleHazardM(null), 160);
    return () => window.clearTimeout(timeout);
  }, [hazardM]);

  const next = state.next ? waypointById(plan, state.next.id) : null;

  if (plan.stops.length === 0) {
    return (
      <div className="s48-visor s48-visor--empty" data-theme="dark">
        <div ref={containerRef} className="s48-visor-globe" />
        <div className="s48-empty-route">
          <button type="button" onClick={onPlan}>
            Add stops in Plan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="s48-visor" data-theme="dark">
      <div ref={containerRef} className="s48-visor-globe" />
      <div className="s48-visor-overlay">
        <div className="s48-visor-heading">
          <span>Heading</span>
          <div className="s48-heading-tape" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => {
              const bearing = ((Math.round(state.headingDeg / 10) * 10 + (index - 2) * 10) % 360 + 360) % 360;
              return (
                <span key={index}>
                  <i className={index === 2 ? 'is-current' : ''} />
                  <small>{String(bearing).padStart(3, '0')}</small>
                </span>
              );
            })}
          </div>
          <strong>{formatHeading(state.headingDeg)}</strong>
        </div>
        <div className="s48-visor-next">
          <span>Next stop</span>
          <strong>{next && state.next ? formatDistance(state.next.distanceM) : 'Home'}</strong>
          <small>{next?.name}</small>
        </div>
        <div className="s48-visor-budget">
          <span>Remaining</span>
          <strong>{formatDuration(budget.time.remaining)}</strong>
          <small>{formatEnergy(budget.energy.remaining)}</small>
          <small>{formatDose(budget.dose.remaining)}</small>
        </div>
        <div
          role="alert"
          aria-hidden={!hasHazard}
          className={`s48-visor-hazard${!hasHazard ? ' is-hidden' : ''}`}
        >
          {visibleHazardM !== null && visibleHazardM > 0 && `Impassable ${formatDistance(visibleHazardM)} ahead`}
        </div>
      </div>
      <div className="s48-visor-controls">
        <PlaybackBar
          playback={playback}
          durationS={track.durationS}
          elapsedS={elapsedS}
          siteData={siteData}
          plan={plan}
        />
      </div>
    </div>
  );
};
