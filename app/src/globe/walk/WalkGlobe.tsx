// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useRef, useState } from 'react';
import {
  CustomDataSource,
  Matrix4,
  Rectangle,
  type Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { getSiteBaseUrl } from '../../config';
import { loadGrid, type RouteGrid } from '../../lib/grid';
import type { Plan } from '../../lib/plan';
import type { SiteData } from '../../types';
import type { RouteTrack } from '../../walk/track';
import { createMarsViewer, initCesium, surfaceClassification, type CesiumFailure } from '../cesiumSetup';
import { useSurfaceMode } from '../surfaceMode';
import { SurfaceNotice } from '../SurfaceNotice';
import { attachOfflineSurface, chaseCamera, siteHeightOffsetM, SPIKE_HEIGHT_OFFSETS_M, type Pose } from '../frame';
import { GlobeImagery } from '../imageryLayers';
import { MapLoadStatus } from '../MapLoadStatus';
import { initialMapLoadState, markFirstFrame, setStreaming, updateLoadSource, type MapLoadState, type LoadSource } from '../loadProgress';
import { markMapLoadMilestone } from '../loadMilestones';
import type { SiteTerrainMesh } from '../siteTerrain';
import { GlobeOverlays } from '../overlays';
import type { CrewMarkerModel } from '../../safety/crewMarkers';
import { groundHeightAt, headingFromTrack, sanitizePlanForOverlays } from './cameraMath';
import { turnMarkerImage } from './turnMarker';
import './walkGlobe.css';

export interface WalkMapProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  lon: number;
  lat: number;
  alongM: number;
  /** Both astronauts, their uncertainty circles and the rover, from the safety layer. */
  crew?: CrewMarkerModel | null;
  /** The next turn point from the directions, marked on the route; null or omitted for none. */
  turnPoint?: { lon: number; lat: number } | null;
}

export const WalkGlobe: React.FC<WalkMapProps> = ({
  siteData,
  plan,
  track,
  lon,
  lat,
  alongM,
  crew = null,
  turnPoint = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceMode = useSurfaceMode();
  const [failure, setFailure] = useState<CesiumFailure | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const overlaysRef = useRef<GlobeOverlays | null>(null);
  const imageryRef = useRef<GlobeImagery | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  /** Null offline without a site mesh: the ground is the bare ellipsoid. */
  const heightOffsetRef = useRef<number | null>(SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0);
  const meshRef = useRef<SiteTerrainMesh | null>(null);
  const [loadState, setLoadState] = useState<MapLoadState>(initialMapLoadState);
  const reportLoad = (source: LoadSource, status: 'pending' | 'loading' | 'ready' | 'failed') => setLoadState((current) => updateLoadSource(current, source, status));

  const turnRef = useRef(turnPoint);
  turnRef.current = turnPoint;
  const poseRef = useRef<{ lon: number; lat: number; alongM: number }>({ lon, lat, alongM });
  poseRef.current = { lon, lat, alongM };

  // Viewer and base layers setup
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

      const crewSource = new CustomDataSource('crew');
      void viewer.dataSources.add(crewSource);
      const overlays = new GlobeOverlays(viewer, {
        crewHost: crewSource,
        classification: surfaceClassification(tileset),
      });
      overlaysRef.current = overlays;
      overlays.setTurnPoint(turnRef.current, turnMarkerImage());

      try {
        const grid = await loadGrid(getSiteBaseUrl(siteData.id), siteData.origin);
        reportLoad('bundles', 'ready');
        if (disposed) return;
        gridRef.current = grid;
        overlays.setGrid(grid);
      } catch (error) {
        reportLoad('bundles', 'failed');
        console.warn('Grid failed to load for WalkGlobe', error);
      }

      // Initial placement with loaded grid and spike offset
      updateView(viewer, overlays);

      // Refine height offset asynchronously in background without blocking
      if (tileset && gridRef.current) {
        void siteHeightOffsetM(viewer, tileset, siteData, gridRef.current)
          .then((offset) => {
            if (disposed) return;
            heightOffsetRef.current = offset;
            updateView(viewer, overlays);
          })
          .catch((error) => {
            console.warn('siteHeightOffsetM failed in WalkGlobe', error);
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
      if (containerRef.current) {
        delete (containerRef.current as any)._viewer;
      }
      overlaysRef.current?.clear();
      overlaysRef.current = null;
      imageryRef.current?.clear();
      imageryRef.current = null;
      meshRef.current?.destroy();
      meshRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [siteData, surfaceMode]);

  // Plan and route updates
  useEffect(() => {
    const viewer = viewerRef.current;
    const overlays = overlaysRef.current;
    if (!viewer || !overlays) return;

    updateView(viewer, overlays);
  }, [plan, track, siteData]);

  // Crew and rover markers from the safety layer.
  useEffect(() => {
    const viewer = viewerRef.current;
    overlaysRef.current?.setCrew(crew);
    viewer?.scene.requestRender();
  }, [crew]);

  // The next turn point: only re-added when it moves to another turn.
  const turnLon = turnPoint?.lon;
  const turnLat = turnPoint?.lat;
  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return;
    overlays.setTurnPoint(turnLon === undefined || turnLat === undefined ? null : { lon: turnLon, lat: turnLat }, turnMarkerImage());
    viewerRef.current?.scene.requestRender();
  }, [turnLon, turnLat]);

  // Walker pose and camera updates on each playback frame
  useEffect(() => {
    const viewer = viewerRef.current;
    const overlays = overlaysRef.current;
    if (!viewer || !overlays) return;

    if (plan.stops.length === 0) return;

    const headingDeg = headingFromTrack(track.vertices, alongM);
    const pose: Pose = { lon, lat, headingDeg };

    overlays.setWalker(pose);

    const groundM = groundHeightAt(gridRef.current, lon, lat, heightOffsetRef.current);
    const cam = chaseCamera(pose, groundM);

    viewer.camera.lookAt(cam.target, cam.offset);
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }, [lon, lat, alongM, track, plan.stops.length]);

  function updateView(viewer: Viewer, overlays: GlobeOverlays) {
    if (plan.stops.length === 0) {
      overlays.setPlan(plan, siteData.origin);
      overlays.setWalker(null);

      const [west, south, east, north] = siteData.bounds_lonlat;
      viewer.camera.setView({
        destination: Rectangle.fromDegrees(west, south, east, north),
      });
      viewer.scene.requestRender();
    } else {
      overlays.setPlan(sanitizePlanForOverlays(plan), siteData.origin);

      const currentPose = poseRef.current;
      const headingDeg = headingFromTrack(track.vertices, currentPose.alongM);
      const pose: Pose = { lon: currentPose.lon, lat: currentPose.lat, headingDeg };

      overlays.setWalker(pose);

      const groundM = groundHeightAt(gridRef.current, currentPose.lon, currentPose.lat, heightOffsetRef.current);
      const cam = chaseCamera(pose, groundM);

      viewer.camera.lookAt(cam.target, cam.offset);
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      viewer.scene.requestRender();
    }
  }

  return (
    <div className="s48-walk-map">
      <div ref={containerRef} className="s48-walk-globe" />
      <MapLoadStatus state={loadState} />
      <SurfaceNotice failure={failure} />
    </div>
  );
};
