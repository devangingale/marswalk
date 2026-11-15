// Written with AI assistance, directed and reviewed by the team.
// Corner mini-map for the 360° view: a small top-down Mars viewer with every traverse,
// clickable stop dots and a view cone that turns with the surface camera.
import React, { useEffect, useRef } from 'react';
import {
  CallbackProperty,
  Cartesian3,
  Color,
  Ellipsoid,
  Entity,
  Globe,
  GridImageryProvider,
  ImageryLayer,
  Math as CesiumMath,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';
import { distanceM, stopLonLat, traverseOf, traverses, type PanoramaManifest, type PanoramaStop } from './panoramas';
import type { SurfaceTelemetry } from './SurfaceView';

interface MiniMapProps {
  manifest: PanoramaManifest;
  stop: PanoramaStop;
  /** Latest camera telemetry; read every frame through a ref, so no re-render is needed. */
  telemetryRef: React.RefObject<SurfaceTelemetry | null>;
  onSelect: (stopId: string) => void;
}

const MIN_VIEW_M = 1200;
const MAX_VIEW_M = 60_000;

/** Camera height that keeps the stop's whole traverse in view. */
function viewHeightM(manifest: PanoramaManifest, stop: PanoramaStop): number {
  const reach = Math.max(0, ...traverseOf(manifest, stop).map((s) => distanceM(stopLonLat(stop), stopLonLat(s))));
  return Math.min(MAX_VIEW_M, Math.max(MIN_VIEW_M, reach * 2.6));
}

/** A point some metres from a stop along a compass bearing, on the local tangent plane. */
function offset(stop: PanoramaStop, bearingDeg: number, metres: number): Cartesian3 {
  const b = CesiumMath.toRadians(bearingDeg);
  const dLat = (metres * Math.cos(b)) / 3_396_190;
  const dLon = (metres * Math.sin(b)) / (3_396_190 * Math.cos(CesiumMath.toRadians(stop.lat)));
  return Cartesian3.fromRadians(
    CesiumMath.toRadians(stop.lon_east) + dLon,
    CesiumMath.toRadians(stop.lat) + dLat,
    0,
    Ellipsoid.MARS,
  );
}

export const MiniMap: React.FC<MiniMapProps> = ({ manifest, stop, telemetryRef, onSelect }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dotsRef = useRef(new Map<Entity, PanoramaStop>());

  // One viewer for the life of the 360° view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => Color.fromCssColorString(styles.getPropertyValue(name).trim() || fallback);
    const viewer = new Viewer(container, {
      timeline: false,
      animation: false,
      geocoder: false,
      baseLayerPicker: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      scene3DOnly: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      globe: new Globe(Ellipsoid.MARS),
      ellipsoid: Ellipsoid.MARS,
      baseLayer: new ImageryLayer(
        new GridImageryProvider({
          ellipsoid: Ellipsoid.MARS,
          cells: 4,
          color: token('--map-graticule', '#ffffff').withAlpha(0.35),
          glowColor: Color.TRANSPARENT,
          backgroundColor: Color.TRANSPARENT,
        }),
      ),
    });
    viewer.scene.globe.baseColor = Color.fromCssColorString('#5b3420');
    viewer.scene.backgroundColor = Color.fromCssColorString('#0a1218');
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewerRef.current = viewer;

    const route = token('--map-route-core', '#8ec1f5');
    const casing = token('--map-route-casing', '#0a1828');
    for (const chain of traverses(manifest)) {
      if (chain.length < 2) continue;
      viewer.entities.add({
        polyline: {
          positions: chain.map((s) => Cartesian3.fromDegrees(s.lon_east, s.lat, 0, Ellipsoid.MARS)),
          width: 3,
          material: route,
        },
      });
    }
    for (const s of manifest.stops) {
      const dot = viewer.entities.add({
        position: Cartesian3.fromDegrees(s.lon_east, s.lat, 0, Ellipsoid.MARS),
        point: {
          pixelSize: new CallbackProperty(() => (stopRef.current.id === s.id ? 11 : 7), false),
          color: new CallbackProperty(() => (stopRef.current.id === s.id ? Color.fromCssColorString('#ffffff') : route), false),
          outlineColor: casing,
          outlineWidth: 2,
        },
      });
      dotsRef.current.set(dot, s);
    }

    // View cone: apex at the stop, opening the camera's horizontal FOV around its heading.
    viewer.entities.add({
      polygon: {
        hierarchy: new CallbackProperty(() => {
          const t = telemetryRef.current;
          const here = stopRef.current;
          const heading = t?.heading ?? here.heading;
          const fov = t?.fov ?? 75;
          const length = viewHeightM(manifest, here) * 0.3;
          const steps = 8;
          const arc = Array.from({ length: steps + 1 }, (_, i) => offset(here, heading - fov / 2 + (fov * i) / steps, length));
          return new PolygonHierarchy([Cartesian3.fromDegrees(here.lon_east, here.lat, 0, Ellipsoid.MARS), ...arc]);
        }, false),
        material: Color.fromCssColorString('#ffd38a').withAlpha(0.35),
        outline: false,
        height: 0,
      },
    });

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(e.position) as { id?: unknown } | undefined;
      const s = picked?.id instanceof Entity ? dotsRef.current.get(picked.id) : undefined;
      if (s) onSelectRef.current(s.id);
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
      const picked = viewer.scene.pick(e.endPosition) as { id?: unknown } | undefined;
      viewer.scene.canvas.style.cursor = picked?.id instanceof Entity && dotsRef.current.has(picked.id) ? 'pointer' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // Follow the surface camera's heading every frame it renders.
    let frame = 0;
    let last = '';
    const tick = () => {
      const t = telemetryRef.current;
      const key = `${stopRef.current.id}|${t?.heading.toFixed(1)}|${t?.fov.toFixed(1)}`;
      if (key !== last) {
        last = key;
        viewer.scene.requestRender();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const dots = dotsRef.current;
    return () => {
      cancelAnimationFrame(frame);
      handler.destroy();
      dots.clear();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [manifest, telemetryRef]);

  // Re-centre on each stop.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(stop.lon_east, stop.lat, viewHeightM(manifest, stop), Ellipsoid.MARS),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    });
    viewer.scene.requestRender();
  }, [manifest, stop]);

  return <div ref={containerRef} className="s360-minimap" aria-label="Traverse mini-map" data-over-map />;
};
