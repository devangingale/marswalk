import React, { useEffect, useRef, useState } from 'react';
import {
  BoundingSphere, Cartesian2, Cartographic, ClassificationType, Color, ConstantPositionProperty, CustomDataSource, Entity, HeadingPitchRange, HeightReference,
  DistanceDisplayCondition, ImageryLayerCollection, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType, Viewer,
} from 'cesium';
import { GLOBE_BASE } from '../config';
import { GlobeGlobalLayers, type GlobeLayer } from './globalLayers';
import { GlobeTemperatureLayer } from './temperature/temperatureLayer';
import type { TemperatureManifest } from './temperature/temperatureManifest';
import { canvasMarkerImages } from './markerImages';
import type { LayerState } from '../types';
import type { CavePoint, TemperatureSetting } from '../plan/wholePlanet';
import type { MapProps } from '../types';
import { resolveSiteAssetUrl } from '../config';
import type { RouteGrid } from '../lib/grid';
import { lonlatToLocalMetres } from '../lib/grid';
import { ScaleBar } from '../components/ScaleBar';
import { GlobeOverlays, photoSites, surfaceHeightM } from './overlays';
import { createMarsViewer, initCesium } from './cesiumSetup';
import { installGroundPan } from './groundPan';
import { cartesianToLonLat, lonLatToCartesian, metresPerPixel as measureMetresPerPixel, siteHeightOffsetM, SPIKE_HEIGHT_OFFSETS_M } from './frame';
import { GlobeImagery } from './imageryLayers';
import { isInsideSite } from './planPick';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './plan/plan.css';

type DragTarget = { kind: 'start' } | { kind: 'stop'; id: string };

/** Whole-planet layers drawn under the site layers, with the same classes Explore uses. */
export interface WholePlanetLayers {
  layers: GlobeLayer[];
  states: Record<string, LayerState>;
  temperatureManifest: TemperatureManifest | null;
  temperature: TemperatureSetting;
  bin: number;
  caves: CavePoint[];
  cavesOn: boolean;
}

interface GlobePlanMapProps extends MapProps {
  /** Tilted view showing relief; off is straight down. */
  relief?: boolean;
  wholePlanet?: WholePlanetLayers;
}

/** Caves within 4,000 km of the camera; anything farther at site zoom is through the planet. */
const CAVE_VISIBLE = new DistanceDisplayCondition(0, 4_000_000);

/** Median of the usable values, or null when there are none. */
function median(values: number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  return usable.length ? usable[Math.floor(usable.length / 2)] : null;
}
interface HoverState { x: number; y: number; lines: string[] }

function pickedGround(viewer: Viewer, point: Cartesian2) {
  const scene = viewer.scene;
  if (scene.pickPositionSupported) {
    const depthPick = scene.pickPosition(point);
    if (depthPick) return depthPick;
  }
  const ray = viewer.camera.getPickRay(point);
  return ray ? scene.globe?.pick(ray, scene) ?? undefined : undefined;
}

function token(value: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(value).trim() || fallback;
}

export const GlobePlanMap: React.FC<GlobePlanMapProps> = ({
  siteData, layerStates, roverOverlayState, plan, onMapPoint, onStartChange, onStopChange, onRoutePointHover,
  grid, activePoint, relief = false, wholePlanet,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const overlaysRef = useRef<GlobeOverlays | null>(null);
  const imageryRef = useRef<GlobeImagery | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  const planRef = useRef(plan);
  const callbacksRef = useRef({ onMapPoint, onStartChange, onStopChange, onRoutePointHover });
  const dragRef = useRef<DragTarget | null>(null);
  const dragPointRef = useRef<{ lon: number; lat: number } | null>(null);
  const dragMarkerRef = useRef<Entity | null>(null);
  const heightOffsetRef = useRef(0);
  const roverStateRef = useRef(roverOverlayState);
  const roverDataRef = useRef<{ traverse: GeoJSON.LineString | null; sites: ReturnType<typeof photoSites> } | null>(null);
  const [offline, setOffline] = useState(false);
  const [imageryTarget, setImageryTarget] = useState<ImageryLayerCollection | null>(null);
  const globalRef = useRef<GlobeGlobalLayers | null>(null);
  const temperatureRef = useRef<GlobeTemperatureLayer | null>(null);
  const cavesRef = useRef<CustomDataSource | null>(null);
  const [scale, setScale] = useState(1);
  const [hover, setHover] = useState<HoverState | null>(null);

  planRef.current = plan;
  callbacksRef.current = { onMapPoint, onStartChange, onStopChange, onRoutePointHover };
  roverStateRef.current = roverOverlayState;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let handler: ScreenSpaceEventHandler | null = null;
    let removePan: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const startup = async () => {
      initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN, navigator.onLine);
      const { viewer, tileset, mode } = await createMarsViewer(container, { interactive: true });
      if (disposed) { viewer.destroy(); return; }
      viewerRef.current = viewer;
      if (viewer.scene.globe) viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      viewer.cesiumWidget.creditContainer.setAttribute('aria-label', 'Cesium ion attribution');
      setOffline(mode === 'offline' || !tileset);

      const [west, south, east, north] = siteData.bounds_lonlat;
      const mid = { lon: (west + east) / 2, lat: (south + north) / 2 };
      const aspect = container.clientWidth / Math.max(1, container.clientHeight);
      const verticalFov = Math.PI / 3;
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const range = Math.max(
        siteData.size_m.width / (2 * Math.tan(horizontalFov / 2)),
        siteData.size_m.height / (2 * Math.tan(verticalFov / 2)),
      ) * 1.1;
      const flyToSite = (height: number) => viewer.camera.flyToBoundingSphere(new BoundingSphere(lonLatToCartesian(mid.lon, mid.lat, height), 1), {
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90), range),
      });
      flyToSite(0);
      if (tileset) {
        try {
          const [ground] = await viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(mid.lon, mid.lat)]);
          if (ground?.height !== undefined && !disposed) flyToSite(ground.height);
        } catch { /* the tileset may not have sampled the site yet */ }
      }

      const imageryTarget = tileset?.imageryLayers ?? viewer.imageryLayers;
      const imagery = new GlobeImagery(imageryTarget);
      imageryRef.current = imagery;
      imagery.apply(layerStates, true);
      await imagery.setSite(siteData, mode);
      if (disposed) return;
      setImageryTarget(imageryTarget);

      const heightOffset = mode === 'ion' && tileset
        ? gridRef.current
          ? await siteHeightOffsetM(viewer, tileset, siteData, gridRef.current)
          : SPIKE_HEIGHT_OFFSETS_M[siteData.id] ?? 0
        : 0;
      heightOffsetRef.current = heightOffset;
      if (tileset && gridRef.current) flyToSite(surfaceHeightM(gridRef.current, mid.lon, mid.lat, heightOffset));

      const overlays = new GlobeOverlays(viewer, { scene: viewer.scene, classification: tileset ? ClassificationType.CESIUM_3D_TILE : ClassificationType.TERRAIN });
      overlaysRef.current = overlays;
      if (tileset) overlays.setHeightOffsetM(heightOffset);
      overlays.setGrid(gridRef.current);
      overlays.setPlan(planRef.current, siteData.origin);
      void Promise.all([
        fetch(resolveSiteAssetUrl(siteData.id, `/data/${siteData.id}/traverse.geojson`))
          .then((response) => response.ok ? response.json() as Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> : null)
          .then((collection) => collection?.features.find((feature) => feature.geometry.type === 'LineString')?.geometry ?? null),
        fetch(resolveSiteAssetUrl(siteData.id, siteData.photos_url ?? `/data/${siteData.id}/photos.json`))
          .then((response) => response.ok && response.headers.get('content-type')?.includes('json') ? response.json() as Promise<{ lon: number; lat: number; sol: number }[]> : []),
      ]).then(([traverse, photos]) => {
        if (disposed) return;
        const data = { traverse, sites: photoSites(photos) };
        roverDataRef.current = data;
        overlays.setRover(data.traverse, data.sites, roverStateRef.current);
      }).catch(() => undefined);

      if (disposed) return;
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      removePan = installGroundPan(viewer, () => dragRef.current !== null);
      handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
        const point = pickedGround(viewer, event.endPosition);
        const lonLat = cartesianToLonLat(point);
        const activeDrag = dragRef.current;
        if (activeDrag && lonLat && gridRef.current && isInsideSite(gridRef.current, lonLat.lon, lonLat.lat)) {
          dragPointRef.current = lonLat;
          if (dragMarkerRef.current) dragMarkerRef.current.position = new ConstantPositionProperty(lonLatToCartesian(lonLat.lon, lonLat.lat, surfaceHeightM(gridRef.current, lonLat.lon, lonLat.lat, heightOffsetRef.current) + 1));
          return;
        }
        const picked = viewer.scene.pick(event.endPosition) as { id?: unknown } | undefined;
        const lines = overlays.hover(picked, 401);
        if (lonLat && lines.length) callbacksRef.current.onRoutePointHover?.({ lon: lonLat.lon, lat: lonLat.lat });
        else callbacksRef.current.onRoutePointHover?.(null);
        const text = overlays.hoverLabel(picked);
        if (text) setHover({ x: event.endPosition.x + 12, y: event.endPosition.y + 12, lines: text.split('\n') });
        else setHover(null);
      }, ScreenSpaceEventType.MOUSE_MOVE);
      const beginDrag = (event: ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(event.position) as { id?: unknown } | undefined;
        const id = picked?.id;
        if (typeof id === 'object' && id && 'position' in id) {
          const value = (id as Entity).position?.getValue(viewer.clock.currentTime);
          const location = cartesianToLonLat(value);
          const current = planRef.current;
          if (location && current) {
            const stop = current.stops.find((candidate) => {
              const stopPoint = lonlatToLocalMetres(candidate.lon, candidate.lat, siteData.origin);
              const hitPoint = lonlatToLocalMetres(location.lon, location.lat, siteData.origin);
              return Math.hypot(stopPoint.x_m - hitPoint.x_m, stopPoint.y_m - hitPoint.y_m) < 15;
            });
            const startPoint = lonlatToLocalMetres(current.start.lon, current.start.lat, siteData.origin);
            const hitPoint = lonlatToLocalMetres(location.lon, location.lat, siteData.origin);
            if (Math.hypot(startPoint.x_m - hitPoint.x_m, startPoint.y_m - hitPoint.y_m) < 15) dragRef.current = { kind: 'start' };
            else if (stop) dragRef.current = { kind: 'stop', id: stop.id };
          }
        }
        if (dragRef.current) {
          viewer.scene.screenSpaceCameraController.enableInputs = false;
          const target = dragRef.current;
          const current = target.kind === 'start' ? planRef.current?.start : planRef.current?.stops.find((stop) => stop.id === target.id);
          if (current) {
            dragMarkerRef.current = viewer.entities.add({ position: new ConstantPositionProperty(lonLatToCartesian(current.lon, current.lat, surfaceHeightM(gridRef.current, current.lon, current.lat, heightOffsetRef.current) + 1)), point: { pixelSize: 14, color: Color.fromCssColorString(token('--map-route-core', '#8ec1f5')), outlineColor: Color.fromCssColorString(token('--map-route-casing', '#0a1828')), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
          }
        }
      };
      handler.setInputAction(beginDrag, ScreenSpaceEventType.LEFT_DOWN);
      handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
        if (dragRef.current) return;
        const picked = viewer.scene.pick(event.position) as { id?: unknown } | undefined;
        const entity = picked?.id instanceof Entity ? picked.id : null;
        const position = entity?.position?.getValue(viewer.clock.currentTime);
        const location = cartesianToLonLat(position);
        const current = planRef.current;
        if (location && current) {
          const hitPoint = lonlatToLocalMetres(location.lon, location.lat, siteData.origin);
          const isPlanMarker = [current.start, ...current.stops].some((item) => {
            const marker = lonlatToLocalMetres(item.lon, item.lat, siteData.origin);
            return Math.hypot(marker.x_m - hitPoint.x_m, marker.y_m - hitPoint.y_m) < 15;
          });
          if (isPlanMarker) return;
        }
        const hit = pickedGround(viewer, event.position);
        const coord = cartesianToLonLat(hit);
        if (coord && gridRef.current && isInsideSite(gridRef.current, coord.lon, coord.lat)) callbacksRef.current.onMapPoint?.({ lon: coord.lon, lat: coord.lat });
      }, ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(() => {
        const active = dragRef.current;
        const coord = dragPointRef.current;
        if (active && coord && planRef.current) {
          if (active.kind === 'start') callbacksRef.current.onStartChange?.({ ...planRef.current.start, ...coord });
          else {
            const stop = planRef.current?.stops.find((item) => item.id === active.id);
            if (stop) callbacksRef.current.onStopChange?.({ ...stop, ...coord });
          }
        }
        if (dragMarkerRef.current) viewer.entities.remove(dragMarkerRef.current);
        if (active) callbacksRef.current.onRoutePointHover?.(null);
        dragMarkerRef.current = null;
        dragPointRef.current = null;
        dragRef.current = null;
        viewer.scene.screenSpaceCameraController.enableInputs = true;
      }, ScreenSpaceEventType.LEFT_UP);
      // Ground scale on the canvas centre row: three 100 px spans, median of those that hit the
      // ground. Failed picks keep the last value; changes under 3 % are ignored.
      const updateScale = () => {
        const width = viewer.scene.canvas.clientWidth;
        const height = viewer.scene.canvas.clientHeight;
        if (width <= 320 || height <= 60) return;
        const row = height / 2;
        const spans = [-150, -50, 50].map((dx) => {
          const a = cartesianToLonLat(pickedGround(viewer, new Cartesian2(width / 2 + dx, row)));
          const b = cartesianToLonLat(pickedGround(viewer, new Cartesian2(width / 2 + dx + 100, row)));
          return a && b ? measureMetresPerPixel(a, b, 100, siteData.origin) : NaN;
        });
        const next = median(spans);
        if (next !== null) setScale((current) => (Math.abs(next - current) / current < 0.03 ? current : next));
      };
      viewer.camera.percentageChanged = 0.05;
      viewer.camera.changed.addEventListener(updateScale);
      viewer.camera.moveEnd.addEventListener(updateScale);
      resizeObserver = new ResizeObserver(() => { viewer.cesiumWidget.resize(); updateScale(); });
      resizeObserver.observe(container);
      updateScale();
    };
    void startup().catch(() => setOffline(true));
    return () => {
      disposed = true;
      handler?.destroy();
      removePan?.();
      globalRef.current?.destroy(); globalRef.current = null;
      temperatureRef.current?.destroy(); temperatureRef.current = null;
      cavesRef.current = null;
      setImageryTarget(null);
      resizeObserver?.disconnect();
      overlaysRef.current?.clear(); overlaysRef.current = null;
      imageryRef.current?.clear(); imageryRef.current = null;
      viewerRef.current?.destroy(); viewerRef.current = null;
    };
  // Viewer lifetime follows site identity; route and controls sync in separate effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteData.id]);

  useEffect(() => {
    gridRef.current = grid ?? null;
    overlaysRef.current?.setGrid(grid ?? null);
  }, [grid]);
  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return;
    overlays.setGradient(true);
    overlays.setPlan(plan, siteData.origin);
  }, [plan, siteData.origin]);
  useEffect(() => { imageryRef.current?.apply(layerStates); }, [layerStates]);

  const globalList = wholePlanet?.layers;
  const globalStates = wholePlanet?.states;
  useEffect(() => {
    if (!imageryTarget || !globalList?.length) return;
    const layers = new GlobeGlobalLayers(imageryTarget, GLOBE_BASE, globalList);
    globalRef.current = layers;
    return () => { layers.destroy(); if (globalRef.current === layers) globalRef.current = null; };
  }, [imageryTarget, globalList]);
  useEffect(() => { if (globalStates) globalRef.current?.apply(globalStates); }, [globalStates, imageryTarget, globalList]);

  const temperatureManifest = wholePlanet?.temperatureManifest ?? null;
  const temperature = wholePlanet?.temperature;
  const bin = wholePlanet?.bin ?? 0;
  useEffect(() => {
    if (!imageryTarget || !temperatureManifest) return;
    const layer = new GlobeTemperatureLayer(imageryTarget, GLOBE_BASE, temperatureManifest);
    temperatureRef.current = layer;
    return () => { layer.destroy(); if (temperatureRef.current === layer) temperatureRef.current = null; };
  }, [imageryTarget, temperatureManifest]);
  useEffect(() => { if (temperature) temperatureRef.current?.apply({ ...temperature, bin }); }, [temperature, bin, imageryTarget, temperatureManifest]);

  const caves = wholePlanet?.caves;
  const cavesOn = !!wholePlanet?.cavesOn;
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !imageryTarget || !caves?.length) return;
    const source = new CustomDataSource('caves');
    const triangle = canvasMarkerImages().cave();
    for (const cave of caves) {
      source.entities.add({
        id: `cave:${cave.id}`,
        name: cave.id,
        position: lonLatToCartesian(cave.lon, cave.lat, 0),
        // The site view has no globe depth, so caves past the horizon would show through the planet.
        billboard: { image: triangle.image, width: triangle.width, height: triangle.height, heightReference: HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: CAVE_VISIBLE },
      });
    }
    source.show = false;
    cavesRef.current = source;
    void viewer.dataSources.add(source);
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true);
      if (cavesRef.current === source) cavesRef.current = null;
    };
  }, [imageryTarget, caves]);
  useEffect(() => { if (cavesRef.current) cavesRef.current.show = cavesOn; }, [cavesOn, imageryTarget, caves]);

  // Relief tilts the camera to 45 degrees; off looks straight down. The first render keeps the opening view.
  const reliefApplied = useRef(false);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || (!reliefApplied.current && !relief)) return;
    reliefApplied.current = true;
    viewer.camera.setView({ destination: viewer.camera.position, orientation: { heading: viewer.camera.heading, pitch: relief ? -Math.PI / 4 : -Math.PI / 2, roll: 0 } });
  }, [relief]);
  useEffect(() => {
    if (overlaysRef.current && roverDataRef.current) {
      overlaysRef.current.setRover(roverDataRef.current.traverse, roverDataRef.current.sites, roverOverlayState);
    }
  }, [roverOverlayState]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!activePoint) {
      const marker = viewer.entities.getById('profile-hover-point');
      if (marker) viewer.entities.remove(marker);
    } else {
      const point = activePoint;
      let marker = viewer.entities.getById('profile-hover-point');
      if (!marker) marker = viewer.entities.add({ id: 'profile-hover-point', point: { pixelSize: 10, color: Color.fromCssColorString(token('--map-route-highlight', '#c4e0fb')), outlineColor: Color.fromCssColorString(token('--map-route-casing', '#0a1828')), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      marker.position = new ConstantPositionProperty(lonLatToCartesian(point.lon, point.lat, surfaceHeightM(gridRef.current, point.lon, point.lat, heightOffsetRef.current) + 2));
    }
  }, [activePoint]);

  // Leaving the map clears the hover dot and tag; a drag in progress keeps them.
  return <div className="globe-plan-map" onPointerLeave={() => { setHover(null); if (!dragRef.current) onRoutePointHover?.(null); }}>
    <div ref={containerRef} className="globe-plan-canvas" />
    {offline && <div className="globe-plan-offline">Offline · local terrain</div>}
    {hover && <div className="globe-plan-hover" style={{ left: hover.x, top: hover.y }}>{hover.lines.join('\n')}</div>}
    <ScaleBar metresPerPixel={scale} />
  </div>;
};
