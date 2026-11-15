// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useRef } from 'react';
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
import { createMarsViewer, initCesium } from '../cesiumSetup';
import { chaseCamera, siteHeightOffsetM, SPIKE_HEIGHT_OFFSETS_M, type Pose } from '../frame';
import { GlobeImagery } from '../imageryLayers';
import { GlobeOverlays } from '../overlays';
import type { CrewMarkerModel } from '../../safety/crewMarkers';
import { groundHeightAt, headingFromTrack, sanitizePlanForOverlays } from './cameraMath';
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
}

export const WalkGlobe: React.FC<WalkMapProps> = ({
  siteData,
  plan,
  track,
  lon,
  lat,
  alongM,
  crew = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const overlaysRef = useRef<GlobeOverlays | null>(null);
  const imageryRef = useRef<GlobeImagery | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  const heightOffsetRef = useRef<number>(SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0);

  const poseRef = useRef<{ lon: number; lat: number; alongM: number }>({ lon, lat, alongM });
  poseRef.current = { lon, lat, alongM };

  // Viewer and base layers setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    heightOffsetRef.current = SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0;
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

      const imagery = new GlobeImagery(tileset ? tileset.imageryLayers : viewer.imageryLayers);
      imageryRef.current = imagery;
      await imagery.setSite(siteData);
      if (disposed) return;

      const crewSource = new CustomDataSource('crew');
      void viewer.dataSources.add(crewSource);
      const overlays = new GlobeOverlays(viewer, { crewHost: crewSource });
      overlaysRef.current = overlays;

      try {
        const grid = await loadGrid(getSiteBaseUrl(siteData.id), siteData.origin);
        if (disposed) return;
        gridRef.current = grid;
        overlays.setGrid(grid);
      } catch (error) {
        console.warn('Grid failed to load for WalkGlobe', error);
      }

      // Initial placement with loaded grid and spike offset
      updateView(viewer, overlays);

      // Refine height offset asynchronously in background without blocking
      if (gridRef.current) {
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
    })();

    return () => {
      disposed = true;
      if (containerRef.current) {
        delete (containerRef.current as any)._viewer;
      }
      overlaysRef.current?.clear();
      overlaysRef.current = null;
      imageryRef.current?.clear();
      imageryRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [siteData]);

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
      overlays.setPlan(sanitizePlanForOverlays(plan, siteData.origin), siteData.origin);

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

  return <div ref={containerRef} className="s48-walk-globe" />;
};
