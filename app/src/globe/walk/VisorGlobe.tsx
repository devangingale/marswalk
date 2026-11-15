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
import { formatDistance, formatDuration, formatHeading, BACK_AT_SHELTER, nextWaypointHeading } from '../../walk/format';
import { hazardAhead, hazardFlags } from '../../walk/hazard';
import { budgetRemaining, RouteTrack, walkStateAt, waypointById } from '../../walk/track';
import { createMarsViewer, initCesium, type CesiumFailure } from '../cesiumSetup';
import { useSurfaceMode } from '../surfaceMode';
import { SurfaceNotice } from '../SurfaceNotice';
import { attachOfflineSurface, siteHeightOffsetM, SPIKE_HEIGHT_OFFSETS_M, visorCamera, type Pose } from '../frame';
import { GlobeImagery } from '../imageryLayers';
import { MapLoadStatus } from '../MapLoadStatus';
import { initialMapLoadState, markFirstFrame, setStreaming, updateLoadSource, type MapLoadState, type LoadSource } from '../loadProgress';
import { markMapLoadMilestone } from '../loadMilestones';
import type { SiteTerrainMesh } from '../siteTerrain';
import { groundHeightAt } from './cameraMath';
import { compactDirections, TurnArrow, trueNorthTitle, useDirectionsNow } from '../../components/DirectionsPanel';
import './walkGlobe.css';
import '../../components/walk.css';

export interface VisorViewProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  elapsedS: number;
  onPlan: () => void;
  /**
   * The safety readouts mounted inside the visor (warning ladder state and SOS). Given the
   * impassable-ground notice, if any, so it can sit with the warning ladder readout.
   */
  children?: React.ReactNode | ((hazard: string | null) => React.ReactNode);
}

type HazardData = { status: 'loading' } | { status: 'ready'; flags: boolean[] } | { status: 'error' };

export const VisorGlobe: React.FC<VisorViewProps> = ({
  siteData,
  plan,
  track,
  elapsedS,
  onPlan,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceMode = useSurfaceMode();
  const [failure, setFailure] = useState<CesiumFailure | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const imageryRef = useRef<GlobeImagery | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  /** Null offline without a site mesh: the ground is the bare ellipsoid. */
  const heightOffsetRef = useRef<number | null>(SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0);
  const meshRef = useRef<SiteTerrainMesh | null>(null);
  const [loadState, setLoadState] = useState<MapLoadState>(initialMapLoadState);
  const reportLoad = (source: LoadSource, status: 'pending' | 'loading' | 'ready' | 'failed') => setLoadState((current) => updateLoadSource(current, source, status));

  const [hazardData, setHazardData] = useState<HazardData>({ status: 'loading' });
  const state = walkStateAt(plan, track, elapsedS);
  const budget = budgetRemaining(plan, state.used);
  const directions = useDirectionsNow(plan, track, siteData.origin, state);
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
    let removeProgress: (() => void) | null = null;
    let removeTileLoad: (() => void) | null = null;
    let removeGlobeProgress: (() => void) | null = null;
    let removeSiteTerrainLoad: (() => void) | null = null;
    let removePostRender: (() => void) | null = null;
    const failSafe = window.setTimeout(() => setLoadState((current) => {
      let next = current;
      for (const source of ['terrain', 'imagery', 'bundles', 'layers'] as const) if (next.sources[source].status === 'pending' || next.sources[source].status === 'loading') next = updateLoadSource(next, source, 'failed');
      return markFirstFrame(next);
    }), 30000);
    let terrainReady = false;
    let terrainActivity = false;
    let imageryReady = false;
    setLoadState(initialMapLoadState());
    reportLoad('terrain', 'loading'); reportLoad('imagery', 'loading'); reportLoad('bundles', 'loading'); reportLoad('layers', 'loading');
    heightOffsetRef.current = SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0;
    initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN, surfaceMode === 'online');
    setFailure(null);

    void (async () => {
      const { viewer, tileset, mode, failure: loadFailure } = await createMarsViewer(container, { interactive: false });
      if (disposed) {
        viewer.destroy();
        return;
      }
      setFailure(loadFailure);

      viewerRef.current = viewer;
      if (viewer.scene.globe) {
        const globeProgress = (remaining: number) => setLoadState((current) => setStreaming(current, remaining > 0));
        viewer.scene.globe.tileLoadProgressEvent.addEventListener(globeProgress);
        removeGlobeProgress = () => viewer.scene.globe.tileLoadProgressEvent.removeEventListener(globeProgress);
      }
      if (tileset) {
        const progress = (requests: number, processing: number) => {
          if (requests + processing > 0) terrainActivity = true;
          setLoadState((current) => setStreaming(current, requests + processing > 0));
          if (terrainActivity && requests + processing === 0 && !terrainReady) {
            terrainReady = true;
            markMapLoadMilestone('ground');
            reportLoad('terrain', 'ready');
            viewer.scene.requestRender();
          }
        };
        const tileLoad = () => { terrainReady = true; markMapLoadMilestone('ground'); reportLoad('terrain', 'ready'); viewer.scene.requestRender(); };
        tileset.loadProgress.addEventListener(progress); tileset.tileLoad.addEventListener(tileLoad);
        removeProgress = () => tileset.loadProgress.removeEventListener(progress);
        removeTileLoad = () => tileset.tileLoad.removeEventListener(tileLoad);
      } else { reportLoad('terrain', loadFailure ? 'failed' : 'loading'); }
      const postRender = () => {
        if (terrainReady && imageryReady) { markMapLoadMilestone('ground'); markMapLoadMilestone('frame'); setLoadState((current) => markFirstFrame(current)); removePostRender?.(); removePostRender = null; }
      };
      viewer.scene.postRender.addEventListener(postRender); removePostRender = () => viewer.scene.postRender.removeEventListener(postRender);
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

      const imagery = new GlobeImagery(tileset ? tileset.imageryLayers : viewer.imageryLayers, () => {
        if (imageryReady) return;
        imageryReady = true;
        reportLoad('imagery', 'ready');
        viewer.scene.requestRender();
      });
      imageryRef.current = imagery;
      try {
        await imagery.setSite(siteData, mode);
        reportLoad('layers', 'ready');
      } catch {
        imageryReady = true;
        reportLoad('imagery', 'failed'); reportLoad('layers', 'failed');
      }
      if (disposed) return;

      // Offline (or Cesium ion unreachable): stand on our site mesh or the ellipsoid, not Cesium Mars heights.
      if (!tileset) {
        const surface = await attachOfflineSurface(viewer, siteData);
        if (disposed) {
          surface.mesh?.destroy();
          return;
        }
        meshRef.current = surface.mesh;
        heightOffsetRef.current = surface.heightOffsetM;
        if (surface.mesh) {
          const siteTerrainReady = () => {
            terrainReady = true;
            markMapLoadMilestone('ground');
            if (!loadFailure) reportLoad('terrain', 'ready');
            viewer.scene.requestRender();
            removeSiteTerrainLoad?.(); removeSiteTerrainLoad = null;
          };
          if (surface.mesh.tileset.tilesLoaded) siteTerrainReady();
          else removeSiteTerrainLoad = surface.mesh.tileset.tileLoad.addEventListener(siteTerrainReady);
        } else {
          terrainReady = true;
          if (!loadFailure) reportLoad('terrain', 'ready');
        }
        viewer.scene.requestRender();
      }
      viewer.scene.requestRender();

      try {
        const grid = await loadGrid(getSiteBaseUrl(siteData.id), siteData.origin);
        reportLoad('bundles', 'ready');
        if (disposed) return;
        gridRef.current = grid;
      } catch (error) {
        reportLoad('bundles', 'failed');
        console.warn('Grid failed to load for VisorGlobe', error);
      }

      // Set initial eye camera position immediately
      placeVisorCamera(viewer, poseRef.current);

      // Measure height offset asynchronously in background without blocking
      if (tileset && gridRef.current) {
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
    })().catch(() => setLoadState((current) => {
      let next = current;
      for (const source of ['terrain', 'imagery', 'bundles', 'layers'] as const) next = updateLoadSource(next, source, 'failed');
      return markFirstFrame(next);
    }));

    return () => {
      disposed = true;
      window.clearTimeout(failSafe);
      removeProgress?.(); removeTileLoad?.(); removeGlobeProgress?.(); removeSiteTerrainLoad?.(); removePostRender?.();
      imageryRef.current?.clear();
      imageryRef.current = null;
      meshRef.current?.destroy();
      meshRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [siteData, surfaceMode]);

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
  // Derived each frame, not held in state: playback re-renders this view every frame.
  const hasHazard = hazardM !== null && hazardM > 0;

  const next = state.next ? waypointById(plan, state.next.id) : null;

  if (plan.stops.length === 0) {
    return (
      <div className="s48-visor s48-visor--empty" data-theme="dark">
        <div ref={containerRef} className="s48-visor-globe" />
        <MapLoadStatus state={loadState} />
        <SurfaceNotice failure={failure} placement="low" />
        <div className="s48-empty-route">
          <button type="button" onClick={onPlan}>
            Add stops in Plan
          </button>
        </div>
      </div>
    );
  }

  const hazardText = !hasHazard ? null : hazardM < 2.5 ? 'Impassable ground ahead' : `Impassable ${formatDistance(hazardM)} ahead`;

  // Four readouts: heading, next stop, time remaining, and the warning ladder state (children).
  return (
    <div className="s48-visor" data-theme="dark">
      <div ref={containerRef} className="s48-visor-globe" />
      <MapLoadStatus state={loadState} />
      <SurfaceNotice failure={failure} placement="low" />
      <div className="s48-visor-overlay">
        <div className="s48-visor-readout s48-visor-heading" data-tour="visor-readouts">
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
        <div className="s48-visor-readout s48-visor-next" data-tour="visor-readouts">
          <span>{nextWaypointHeading(state.next?.id ?? 'start')}</span>
          <strong>{next && state.next ? formatDistance(state.next.distanceM) : 'Back'}</strong>
          <small>{next?.name ?? BACK_AT_SHELTER}</small>
          {directions.next && (
            <div
              className="s48-visor-directions"
              title={directions.target ? trueNorthTitle(directions.target.bearingDeg, directions.target.compass) : undefined}
            >
              <TurnArrow deg={directions.relativeTurnDeg} />
              <span>{compactDirections(directions)}</span>
            </div>
          )}
        </div>
        <div className="s48-visor-readout s48-visor-budget" data-tour="visor-readouts">
          <span>Time remaining</span>
          <strong>{formatDuration(budget.time.remaining)}</strong>
        </div>
      </div>
      {typeof children === 'function' ? children(hazardText) : children}
    </div>
  );
};
