// Written with AI assistance, directed and reviewed by the team.
// Globe page with site and whole-planet layers and the route overlays, reached with ?globe=1.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoundingSphere,
  Cartesian2,
  Cartographic,
  Color,
  CustomDataSource,
  Ellipsoid,
  EllipsoidalOccluder,
  Entity,
  HeadingPitchRange,
  HeightReference,
  IntersectionTests,
  Math as CesiumMath,
  Ray,
  SceneTransforms,
  type Scene,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../shell/shell.css';
import './globe.css';
import { DEFAULT_SITE, GLOBE_BASE, getSiteBaseUrl, getSiteJsonUrl } from '../config';
import { LayerPanel } from '../components/LayerPanel';
import samplePlanJson from '../fixtures/plan.sample.json';
import { loadGrid, type RouteGrid } from '../lib/grid';
import type { Plan } from '../lib/plan';
import { sections as routeSections } from '../lib/routeShape';
import type { LayerState, SiteData } from '../types';
import { createMarsViewer, initCesium } from './cesiumSetup';
import { buildCornerPlan } from './cornerPlan';
import { cartesianToLonLat, lonLatToCartesian, siteHeightOffsetM } from './frame';
import { GlobeGlobalLayers, GlobeLayer, globeAssetUrl, loadGlobeManifest } from './globalLayers';
import { GlobeGraticule, cullLabels, graticuleLines, type Box, type GraticuleLine, type ViewBounds } from './graticule';
import { GlobeImagery } from './imageryLayers';
import { attachSiteTerrain, type SiteTerrainMesh } from './siteTerrain';
import { GlobeTimeTools } from './Clock';
import { marsSolarLongitude } from '../lib/sun';
import { GlobeTemperatureLayer, loadTemperatureManifest } from './temperature/temperatureLayer';
import { TemperatureRow } from './temperature/TemperatureRow';
import { readoutLines, seasonBin, type TemperatureKind, type TemperatureManifest } from './temperature/temperatureManifest';
import { SiteFinder } from './sites/SiteFinder';
import { canvasMarkerImages } from './markerImages';
import { GlobeOverlays } from './overlays';
import { formatElevation, formatLatLon, graticuleStep, screenSpan, sectionLabel } from './routeLook';
import { useGlobeTheme } from './theme/useGlobeTheme';
import { SafetyLayer } from '../safety/SafetyLayer';
import { offsetLonLat, type CrewMarkerModel } from '../safety/crewMarkers';

const CAVE_CREDIT = 'Mars Global Cave Candidate Catalog (MGC³), USGS Astrogeology Science Center';
/** Data overlays start at the --map-overlay-opacity token value. */
const OVERLAY_OPACITY = 0.7;

/** Opening view: the whole disc, centred on the Gale longitude. */
const PLANET_VIEW = { lon: 137.4, lat: -4.7, heightM: 9_000_000 };
const CAVE_HOVER = 'unexplored, from orbit';
/** Mars mode opens this close to the crew, so the uncertainty circles read. */
const MARS_FRAME_MIN_M = 500;

const SAMPLE_PLAN = samplePlanJson as unknown as Plan;
type PlanChoice = 'corner' | 'sample';
const PLAN_TITLES: Record<PlanChoice, string> = { corner: 'Corner loop', sample: 'Boxwork out and back' };

interface CaveCollection {
  features: { geometry: { coordinates: [number, number] }; properties: { id: string } }[];
}

interface Hover {
  x: number;
  y: number;
  flip: boolean;
  lines: string[];
}

interface EdgeLabel {
  key: string;
  text: string;
  x: number;
  y: number;
  axis: 'lat' | 'lon';
}

function cssColour(name: string): Color {
  return Color.fromCssColorString(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** Initial state from the URL, for linking straight to a view: layers=, site=, caves=1, view=lon,lat,range, plan=, slopes=1, grid=1. */
function urlState() {
  const params = new URLSearchParams(window.location.search);
  const list = (key: string) => params.get(key)?.split(',').filter(Boolean) ?? [];
  const view = params.get('view')?.split(',').map(Number);
  return {
    globalOn: list('layers'),
    siteOn: params.has('site') ? list('site') : null,
    caves: params.get('caves') === '1',
    view: view?.length === 3 && view.every(Number.isFinite) ? (view as [number, number, number]) : null,
    plan: (params.get('plan') === 'sample' ? 'sample' : 'corner') as PlanChoice,
    slopes: params.get('slopes') === '1',
    grid: params.get('grid') === '1',
  };
}

async function flyTo(viewer: Viewer, lon: number, lat: number, rangeM: number, pitchDeg: number, groundM?: number) {
  const [sampled] = groundM === undefined
    ? await viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(lon, lat)])
    : [undefined];
  const centre = lonLatToCartesian(lon, lat, groundM ?? sampled?.height ?? 0);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, 1), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(pitchDeg), rangeM),
  });
}

/** Height of Cesium Mars below the camera, from the tileset. */
function groundBelowM(viewer: Viewer): number {
  return viewer.scene.sampleHeight(Cartographic.clone(viewer.camera.positionCartographic)) ?? 0;
}

/**
 * Longitude and latitude bounds of the ground in view: camera rays through a 5 by 5 grid of
 * screen points meet an ellipsoid raised to the ground height below the camera. Cesium's
 * computeViewRectangle assumes a camera above the ellipsoid, which fails inside deep craters
 * such as Gale. Null unless every ray meets the ground (the planet is not filling the view).
 */
function viewBounds(viewer: Viewer, groundM: number): ViewBounds | null {
  const canvas = viewer.scene.canvas;
  const r = Ellipsoid.MARS.radii;
  const ground = new Ellipsoid(r.x + groundM, r.y + groundM, r.z + groundM);
  const points: { lon: number; lat: number }[] = [];
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
    for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
      const ray = viewer.camera.getPickRay(new Cartesian2(fx * canvas.clientWidth, fy * canvas.clientHeight));
      const hit = ray && IntersectionTests.rayEllipsoid(ray, ground);
      if (!ray || !hit) return null;
      const p = cartesianToLonLat(Ray.getPoint(ray, hit.start));
      if (p) points.push(p);
    }
  }
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  // A view across 180 degrees has longitudes at both ends of the range.
  if (east - west > 180) {
    const wrapped = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
    return { west: Math.min(...wrapped), south: Math.min(...lats), east: Math.max(...wrapped) - 360, north: Math.max(...lats) };
  }
  return { west, south: Math.min(...lats), east, north: Math.max(...lats) };
}

/** Above this camera height the far side of the planet can hide lines, so labels test for it. */
const OCCLUSION_HEIGHT_M = 100_000;

/**
 * Edge label anchors: meridians at their topmost visible point, parallels at their leftmost.
 * Line points are projected at the ground height below the camera.
 */
function edgeLabels(viewer: Viewer, lines: GraticuleLine[], groundM: number): EdgeLabel[] {
  const scene = viewer.scene;
  const width = scene.canvas.clientWidth;
  const height = scene.canvas.clientHeight;
  const occluder =
    viewer.camera.positionCartographic.height > OCCLUSION_HEIGHT_M
      ? new EllipsoidalOccluder(Ellipsoid.MARS, viewer.camera.positionWC)
      : null;
  const labels: EdgeLabel[] = [];
  for (const line of lines) {
    let best: { x: number; y: number } | null = null;
    for (let i = 0; i < line.points.length; i++) {
      const [lon, lat] = line.points[i];
      const world = lonLatToCartesian(lon, lat, groundM);
      if (occluder && !occluder.isPointVisible(world)) continue;
      const p = SceneTransforms.worldToWindowCoordinates(scene, world);
      if (!p || p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      if (!best || (line.axis === 'lon' ? p.y < best.y : p.x < best.x)) best = { x: p.x, y: p.y };
    }
    if (best) {
      labels.push({
        key: `${line.axis}${line.value}`,
        text: line.label,
        axis: line.axis,
        x: line.axis === 'lon' ? best.x : Math.max(best.x, 4),
        y: line.axis === 'lon' ? Math.max(best.y, 4) : best.y,
      });
    }
  }
  return labels;
}

export const GlobePage: React.FC = () => {
  const initial = useRef(urlState()).current;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const siteImageryRef = useRef<GlobeImagery | null>(null);
  const siteTerrainRef = useRef<SiteTerrainMesh | null>(null);
  const globalRef = useRef<GlobeGlobalLayers | null>(null);
  const temperatureRef = useRef<GlobeTemperatureLayer | null>(null);
  const cavesRef = useRef<CustomDataSource | null>(null);
  const overlaysRef = useRef<GlobeOverlays | null>(null);
  const graticuleRef = useRef<GlobeGraticule | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  const graticuleLinesRef = useRef<GraticuleLine[]>([]);
  const groundRef = useRef(0);
  const viewRef = useRef<HTMLDivElement>(null);

  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const { mode, setMode, override, setOverride, theme } = useGlobeTheme(
    siteData ? { lat: siteData.origin.lat0, lon: siteData.origin.lon0 } : null,
  );
  const [layerStates, setLayerStates] = useState<Record<string, LayerState>>({});
  const [globalLayers, setGlobalLayers] = useState<GlobeLayer[]>([]);
  const [globalStates, setGlobalStates] = useState<Record<string, LayerState>>({});
  const [temperatureManifest, setTemperatureManifest] = useState<TemperatureManifest | null>(null);
  const [temperature, setTemperature] = useState<{ enabled: boolean; opacity: number; kind: TemperatureKind }>({
    enabled: initial.globalOn.includes('temperature'),
    opacity: 1,
    kind: 't_min',
  });
  // Solar longitude from the clock once it loads; until then, today's.
  const [ls, setLs] = useState(() => marsSolarLongitude(Date.now()));
  const bin = seasonBin(ls);
  const [cavesOn, setCavesOn] = useState(initial.caves);
  const [caveCount, setCaveCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'layers' | 'sites'>('layers');
  const [notice, setNotice] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Set once the Mars scene is ready; gates the time tools and site-finder mounts.
  const [dustScene, setDustScene] = useState<Scene | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // The site-finder registers a resolver here so site pins share the one tooltip.
  const siteHoverRef = useRef<((entity: Entity | null) => string[] | null) | null>(null);
  const registerSiteHover = useCallback((fn: ((entity: Entity | null) => string[] | null) | null) => {
    siteHoverRef.current = fn;
  }, []);
  const [grid, setGrid] = useState<RouteGrid | null>(null);
  const [planChoice, setPlanChoice] = useState<PlanChoice>(initial.plan);
  const [slopesOn, setSlopesOn] = useState(initial.slopes);
  const [slopesAvailable, setSlopesAvailable] = useState(false);
  const [graticuleOn, setGraticuleOn] = useState(initial.grid);
  const [edges, setEdges] = useState<EdgeLabel[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  // Mars mode: the night contingency switches the page to the night theme.
  const [nightContingency, setNightContingency] = useState(false);
  const marsFramedRef = useRef(false);
  const siteSettledRef = useRef(false);

  // Mars mode shows the globe, the safety column and the markers only: the layer panel
  // collapses to its header button. Earth mode reopens it.
  useEffect(() => {
    setPanelOpen(mode !== 'mars');
    if (mode !== 'mars') marsFramedRef.current = false;
  }, [mode]);

  // Crew, rover and night corridor from the safety layer; the first set frames the crew.
  const onCrewMarkers = useCallback((model: CrewMarkerModel | null) => {
    const viewer = viewerRef.current;
    overlaysRef.current?.setCrew(model);
    if (!viewer || viewer.isDestroyed()) return;
    if (model && siteSettledRef.current && !marsFramedRef.current && model.crew.length > 0) {
      marsFramedRef.current = true;
      const points = [...model.crew, ...(model.rover ? [model.rover] : [])];
      const sphere = BoundingSphere.fromPoints(points.map((p) => lonLatToCartesian(p.lon, p.lat, 0)));
      const centre = Cartographic.fromCartesian(sphere.center, Ellipsoid.MARS);
      const rangeM = Math.max(sphere.radius * 4, MARS_FRAME_MIN_M);
      // Shift the view east by half the safety column so the crew sits in the open map.
      const fov = (viewer.camera.frustum as { fov?: number }).fov ?? CesiumMath.PI_OVER_THREE;
      const metresPerPx = (2 * rangeM * Math.tan(fov / 2)) / Math.max(1, viewer.scene.canvas.clientWidth);
      const column = viewRef.current?.querySelector('.s48-safety')?.getBoundingClientRect().width ?? 0;
      const target = offsetLonLat(
        { lon: CesiumMath.toDegrees(centre.longitude), lat: CesiumMath.toDegrees(centre.latitude) },
        (column / 2) * metresPerPx,
        90,
      );
      // On the plain ellipsoid (offline) the ground is at 0 m; on Cesium Mars it is sampled.
      void flyTo(viewer, target.lon, target.lat, rangeM, -90, viewer.scene.globe.show ? 0 : undefined);
    }
    viewer.scene.requestRender();
  }, []);

  const statesRef = useRef({ layerStates, globalStates, cavesOn, graticuleOn });
  statesRef.current = { layerStates, globalStates, cavesOn, graticuleOn };

  const cornerPlan = React.useMemo(() => {
    if (!siteData) return null;
    const g = grid;
    const elevationAt = g
      ? (lon: number, lat: number) => {
          const { row, col } = g.lonlatToRowCol(lon, lat);
          return g.getElevation(row, col);
        }
      : undefined;
    return buildCornerPlan(siteData.origin, elevationAt);
  }, [siteData, grid]);
  const shownPlan = planChoice === 'corner' ? cornerPlan : siteData ? SAMPLE_PLAN : null;
  const sectionRows = React.useMemo(
    () => (shownPlan && siteData ? routeSections(shownPlan, siteData.origin) : []),
    [shownPlan, siteData],
  );

  const refreshGraticule = useCallback(() => {
    const viewer = viewerRef.current;
    const graticule = graticuleRef.current;
    if (!viewer || !graticule) return;
    if (!statesRef.current.graticuleOn) {
      graticule.clear();
      graticuleLinesRef.current = [];
      setEdges([]);
      return;
    }
    const groundM = groundBelowM(viewer);
    groundRef.current = groundM;
    const lines = graticuleLines(
      viewBounds(viewer, groundM),
      graticuleStep(viewer.camera.positionCartographic.height - groundM),
    );
    graticuleLinesRef.current = lines;
    graticule.update(lines);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let handler: ScreenSpaceEventHandler | null = null;
    const removers: (() => void)[] = [];
    let mode = initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN, navigator.onLine);

    void (async () => {
      const created = await createMarsViewer(container, { interactive: true });
      const { viewer, tileset } = created;
      mode = created.mode;
      if (disposed) {
        viewer.destroy();
        return;
      }
      viewerRef.current = viewer;
      setViewer(viewer);
      viewer.camera.setView({ destination: lonLatToCartesian(PLANET_VIEW.lon, PLANET_VIEW.lat, PLANET_VIEW.heightM) });
      if (!tileset) setNotice('Offline, local tiles');

      // Markers clamp to Cesium Mars only when the tileset takes part in height queries.
      if (tileset) tileset.enableCollision = true;

      const caves = new CustomDataSource('caves');
      caves.show = statesRef.current.cavesOn;
      cavesRef.current = caves;
      void viewer.dataSources.add(caves);

      const graticuleSource = new CustomDataSource('graticule');
      void viewer.dataSources.add(graticuleSource);
      graticuleRef.current = new GlobeGraticule(graticuleSource, cssColour('--map-graticule'));
      removers.push(viewer.camera.moveEnd.addEventListener(refreshGraticule));
      let lastEdges = '';
      removers.push(
        viewer.scene.postRender.addEventListener(() => {
          if (!statesRef.current.graticuleOn) return;
          // Panels over the map (route card, buttons, cursor readout) keep labels out from under them.
          const view = viewRef.current?.getBoundingClientRect();
          const panels: Box[] = view
            ? [...(viewRef.current?.parentElement?.querySelectorAll('[data-over-map], .s48-cond') ?? [])].map((el) => {
                const r = el.getBoundingClientRect();
                return [r.left - view.left, r.top - view.top, r.right - view.left, r.bottom - view.top];
              })
            : [];
          const next = cullLabels(
            edgeLabels(viewer, graticuleLinesRef.current, groundRef.current).map((l) => ({
              ...l,
              x: Math.round(l.x),
              y: Math.round(l.y),
            })),
            panels,
          );
          const key = JSON.stringify(next);
          if (key === lastEdges) return;
          lastEdges = key;
          setEdges(next);
        }),
      );
      refreshGraticule();

      // Crew and rover marks (Mars mode) in their own source, added last so they draw above the plan.
      const crewSource = new CustomDataSource('crew');
      void viewer.dataSources.add(crewSource);
      overlaysRef.current = new GlobeOverlays(viewer, { onSectionHover: setHoveredSection, crewHost: crewSource });
      const imageryTarget = tileset?.imageryLayers ?? viewer.imageryLayers;
      siteImageryRef.current = new GlobeImagery(imageryTarget);
      setDustScene(viewer.scene);

      loadGlobeManifest(GLOBE_BASE)
        .then((manifest) => {
          if (disposed) return;
          globalRef.current = new GlobeGlobalLayers(imageryTarget, GLOBE_BASE, manifest.layers);
          const states = Object.fromEntries(
            manifest.layers.map((l) => [l.id, { enabled: initial.globalOn.includes(l.id), opacity: OVERLAY_OPACITY }]),
          );
          globalRef.current.apply(states);
          setGlobalStates(states);
          setGlobalLayers(manifest.layers);
        })
        .catch((error) => console.warn('Globe layer manifest did not load', error));

      loadTemperatureManifest(GLOBE_BASE)
        .then((manifest) => {
          if (disposed) return;
          temperatureRef.current = new GlobeTemperatureLayer(imageryTarget, GLOBE_BASE, manifest);
          setTemperatureManifest(manifest);
        })
        .catch((error) => console.warn('Temperature manifest did not load', error));

      fetch(globeAssetUrl(GLOBE_BASE, 'caves.geojson'))
        .then((r) => (r.ok ? (r.json() as Promise<CaveCollection>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => {
          if (disposed) return;
          const triangle = canvasMarkerImages().cave();
          for (const f of data.features) {
            const [lon, lat] = f.geometry.coordinates;
            caves.entities.add({
              id: `cave:${f.properties.id}`,
              name: f.properties.id,
              position: lonLatToCartesian(lon, lat, 0),
              billboard: {
                image: triangle.image,
                width: triangle.width,
                height: triangle.height,
                heightReference: HeightReference.CLAMP_TO_GROUND,
              },
            });
          }
          setCaveCount(data.features.length);
        })
        .catch((error) => console.warn('Cave candidates did not load', error));

      fetch(getSiteJsonUrl(DEFAULT_SITE))
        .then((r) => (r.ok ? (r.json() as Promise<SiteData>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(async (site) => {
          if (disposed) return;
          const states = Object.fromEntries(
            site.layers.map((l) => [
              l.id,
              {
                enabled: initial.siteOn ? initial.siteOn.includes(l.id) : l.default_on,
                opacity: l.kind === 'optical' ? 1 : OVERLAY_OPACITY,
              },
            ]),
          );
          setSiteData(site);
          setLayerStates(states);
          siteImageryRef.current!.apply(states);
          await siteImageryRef.current!.setSite(site, mode);
          siteTerrainRef.current = await attachSiteTerrain(viewer, tileset, site);
          const loaded = await loadGrid(getSiteBaseUrl(site.id), site.origin);
          if (disposed) return;
          gridRef.current = loaded;
          setGrid(loaded);
          const offset = await siteHeightOffsetM(viewer, tileset, site, loaded);
          console.info(`Height offset at ${site.id}: ${offset.toFixed(2)} m`);
          if (mode === 'offline' && !initial.view) {
            const [west, south, east, north] = site.bounds_lonlat;
            const lon = (west + east) / 2;
            const lat = (south + north) / 2;
            void flyTo(viewer, lon, lat, Math.max(site.size_m.width, site.size_m.height) * 2, -60, 0);
          }
          // Mars mode frames the crew only after the site's opening view.
          siteSettledRef.current = true;
        })
        .catch((error) => console.warn('Site did not load', error));

      if (initial.view) void flyTo(viewer, initial.view[0], initial.view[1], initial.view[2], -90);

      let frame = 0;
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const at = event.endPosition;
          const width = viewer.scene.canvas.clientWidth;
          const place = (lines: string[]) =>
            setHover(lines.length ? { x: at.x, y: at.y, flip: at.x > width - 320, lines } : null);

          const position = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(at) : undefined;
          const point = cartesianToLonLat(position);
          if (point) {
            const g = gridRef.current;
            const cell = g?.lonlatToRowCol(point.lon, point.lat);
            const bundle = g && cell && g.isInside(cell.row, cell.col) ? g.getElevation(cell.row, cell.col) : NaN;
            const elevation = Number.isFinite(bundle) ? bundle : point.heightM;
            setCursor(`${formatLatLon(point.lon, point.lat)} · ${formatElevation(elevation)}`);
          } else {
            setCursor(null);
          }

          const picked = viewer.scene.pick(at) as { id?: unknown } | undefined;
          const overlays = overlaysRef.current;
          if (overlays) {
            // The route is small next to its distance from the camera, so the cursor's ground height serves for all of it.
            const samples = overlays.routeSamples(point?.heightM ?? 0).flatMap((c) => {
              const p = SceneTransforms.worldToWindowCoordinates(viewer.scene, c);
              return p ? [{ x: p.x, y: p.y }] : [];
            });
            const lines = overlays.hover(picked, screenSpan(samples));
            if (lines.length) {
              place(lines);
              return;
            }
          }
          if (picked?.id instanceof Entity && caves.entities.contains(picked.id)) {
            place([`Cave candidate ${picked.id.name}`, CAVE_HOVER]);
            return;
          }
          const siteLines = siteHoverRef.current?.(picked?.id instanceof Entity ? picked.id : null);
          if (siteLines && siteLines.length) {
            place(siteLines);
            return;
          }
          const reading = point ? temperatureRef.current?.reading(point.lon, point.lat) : null;
          place([
            ...(point && globalRef.current ? globalRef.current.readouts(point.lon, point.lat) : []),
            ...(reading && temperatureRef.current ? readoutLines(temperatureRef.current.kind, reading) : []),
          ]);
        });
      }, ScreenSpaceEventType.MOUSE_MOVE);
    })();

    return () => {
      disposed = true;
      handler?.destroy();
      removers.forEach((remove) => remove());
      overlaysRef.current?.clear();
      graticuleRef.current?.clear();
      siteImageryRef.current?.clear();
      siteTerrainRef.current?.destroy();
      globalRef.current?.destroy();
      temperatureRef.current?.destroy();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [initial, refreshGraticule]);

  useEffect(() => siteImageryRef.current?.apply(layerStates), [layerStates]);
  useEffect(() => globalRef.current?.apply(globalStates), [globalStates]);
  useEffect(() => temperatureRef.current?.apply({ ...temperature, bin }), [temperature, bin, temperatureManifest]);
  useEffect(() => {
    if (cavesRef.current) cavesRef.current.show = cavesOn;
  }, [cavesOn]);
  useEffect(() => refreshGraticule(), [graticuleOn, refreshGraticule]);

  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays || !siteData) return;
    overlays.setGradient(slopesOn);
    overlays.setGrid(grid);
    overlays.setPlan(shownPlan ?? undefined, siteData.origin);
    setSlopesAvailable(overlays.slopesAvailable);
  }, [shownPlan, grid, slopesOn, siteData]);

  useEffect(() => {
    const panel = viewRef.current?.parentElement?.querySelector('aside.panel');
    panel?.setAttribute('data-over-map', '');
    return () => panel?.removeAttribute('data-over-map');
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.scene.backgroundColor = cssColour('--map-sky');
    const labelFill = cssColour('--map-label-text');
    const labelOutline = cssColour('--map-label-halo');
    const dataSources = Array.from({ length: viewer.dataSources.length }, (_, index) => viewer.dataSources.get(index));
    const labelEntities = [
      ...viewer.entities.values,
      ...dataSources.flatMap((source) => source.entities.values),
    ];
    for (const entity of labelEntities) {
      if (!entity.label) continue;
      entity.label.fillColor = labelFill as never;
      entity.label.outlineColor = labelOutline as never;
    }
    if (cavesRef.current) {
      const fill = cssColour('--map-cave');
      for (const entity of cavesRef.current.entities.values) {
        if (!entity.point) continue;
        entity.point.color = fill as never;
        entity.point.outlineColor = labelOutline as never;
      }
    }
    viewer.scene.requestRender();
  }, [theme, viewer]);

  const toggle = (set: typeof setLayerStates) => (id: string) =>
    set((prev) => ({ ...prev, [id]: { ...prev[id], enabled: !prev[id]?.enabled } }));
  const setOpacity = (set: typeof setLayerStates) => (id: string, opacity: number) =>
    set((prev) => ({ ...prev, [id]: { ...prev[id], opacity } }));

  const flyToSite = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || !siteData) return;
    const [west, south, east, north] = siteData.bounds_lonlat;
    const span = Math.max(siteData.size_m.width, siteData.size_m.height);
    void flyTo(viewer, (west + east) / 2, (south + north) / 2, span * 2, -60);
  }, [siteData]);

  const flyToPlanet = useCallback(() => {
    viewerRef.current?.camera.flyTo({
      destination: lonLatToCartesian(PLANET_VIEW.lon, PLANET_VIEW.lat, PLANET_VIEW.heightM),
    });
  }, []);

  const flyToRoute = useCallback(() => {
    const viewer = viewerRef.current;
    const route = shownPlan?.route.legs.flatMap((l) => l.line);
    if (!viewer || !route?.length) return;
    const sphere = BoundingSphere.fromPoints(route.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0)));
    const centre = Cartographic.fromCartesian(sphere.center, Ellipsoid.MARS);
    void flyTo(viewer, CesiumMath.toDegrees(centre.longitude), CesiumMath.toDegrees(centre.latitude), sphere.radius * 3.2, -90);
  }, [shownPlan]);

  return (
    <div className="mock plan-mock" data-theme={mode === 'mars' && nightContingency ? 'night' : undefined}>
      <header className="mock-top">
        <span className="wordmark">Sol-48</span>
        <div className="s48-seg globe-mode" role="group" aria-label="Globe mode">
          <button type="button" aria-pressed={mode === 'earth'} onClick={() => setMode('earth')}>
            Earth
          </button>
          <button
            type="button"
            aria-pressed={mode === 'mars'}
            onClick={() => {
              setMode('mars');
              setPanelTab('layers');
            }}
          >
            Mars
          </button>
        </div>
        <div className="s48-seg globe-theme" role="group" aria-label="Theme">
          <button type="button" aria-pressed={override === 'auto'} onClick={() => setOverride('auto')}>
            Auto
          </button>
          <button type="button" aria-pressed={override === 'day'} onClick={() => setOverride('day')}>
            Day
          </button>
          <button type="button" aria-pressed={override === 'night'} onClick={() => setOverride('night')}>
            Night
          </button>
        </div>
        <div className="s48-seg globe-tabs" role="tablist" aria-label="Left panel">
          <button
            type="button"
            role="tab"
            aria-pressed={panelOpen && panelTab === 'layers'}
            onClick={() => {
              setPanelTab('layers');
              setPanelOpen(true);
            }}
          >
            Layers
          </button>
          {mode === 'earth' && (
            <button
              type="button"
              role="tab"
              aria-pressed={panelOpen && panelTab === 'sites'}
              onClick={() => {
                setPanelTab('sites');
                setPanelOpen(true);
              }}
            >
              Sites
            </button>
          )}
        </div>
        <span className="grow" />
      </header>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <div className="globe-body">
          <LayerPanel
            layers={siteData?.layers ?? []}
            layerStates={layerStates}
            onToggleLayer={toggle(setLayerStates)}
            onOpacityChange={setOpacity(setLayerStates)}
            globalLayers={globalLayers}
            globalStates={globalStates}
            onToggleGlobal={toggle(setGlobalStates)}
            onGlobalOpacityChange={setOpacity(setGlobalStates)}
            caves={
              caveCount > 0
                ? { enabled: cavesOn, count: caveCount, credit: CAVE_CREDIT, onToggle: () => setCavesOn((v) => !v) }
                : undefined
            }
            temperature={
              temperatureManifest
                ? {
                    enabled: temperature.enabled,
                    row: (
                      <TemperatureRow
                        manifest={temperatureManifest}
                        bin={bin}
                        enabled={temperature.enabled}
                        opacity={temperature.opacity}
                        kind={temperature.kind}
                        onToggle={() => setTemperature((t) => ({ ...t, enabled: !t.enabled }))}
                        onOpacityChange={(opacity) => setTemperature((t) => ({ ...t, opacity }))}
                        onKindChange={(kind) => setTemperature((t) => ({ ...t, kind }))}
                      />
                    ),
                  }
                : undefined
            }
            isOpen={panelOpen && panelTab === 'layers'}
            onTogglePanel={() => setPanelOpen(!panelOpen)}
          />
          <SiteFinder
            viewer={viewer}
            active={mode === 'earth' && panelOpen && panelTab === 'sites'}
            registerHover={registerSiteHover}
            onHide={() => setPanelOpen(false)}
          />
          <div
            ref={viewRef}
            className="globe-view"
            onMouseLeave={() => {
              setHover(null);
              setCursor(null);
              overlaysRef.current?.hover(undefined, 0);
            }}
          >
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
            {/* The clock, dust history and conditions are Earth-mode planning chrome; Mars mode stays minimal. */}
            {mode === 'earth' && dustScene && <GlobeTimeTools scene={dustScene} onLs={setLs} />}
            {mode === 'earth' && siteData && (
              <div className="globe-sites" data-over-map>
                <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToPlanet}>
                  Whole planet
                </button>
                <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToSite}>
                  {siteData.title}
                </button>
              </div>
            )}
            {mode === 'earth' && siteData && shownPlan && (
              <section className="globe-route" aria-label="Route" data-over-map>
                <div className="s48-seg" role="group" aria-label="Plan">
                  {(Object.keys(PLAN_TITLES) as PlanChoice[]).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={planChoice === choice}
                      onClick={() => setPlanChoice(choice)}
                    >
                      {PLAN_TITLES[choice]}
                    </button>
                  ))}
                </div>
                <ol className="globe-route__sections">
                  {sectionRows.map((section) => (
                    <li key={section.id} className={hoveredSection === section.id ? 'is-hovered' : undefined}>
                      {sectionLabel(section, shownPlan)}
                    </li>
                  ))}
                </ol>
                <div className="globe-route__actions">
                  <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToRoute}>
                    Show route
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      className="s48-check"
                      checked={slopesOn}
                      onChange={() => setSlopesOn((v) => !v)}
                    />
                    <span>Slopes</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      className="s48-check"
                      checked={graticuleOn}
                      onChange={() => setGraticuleOn((v) => !v)}
                    />
                    <span>Lat/lon grid</span>
                  </label>
                </div>
                {slopesOn && !slopesAvailable && (
                  <p className="globe-route__note">No elevation grid under this route in the sample bundle.</p>
                )}
              </section>
            )}
            {mode === 'mars' && siteData && (
              <SafetyLayer
                plan={shownPlan}
                origin={siteData.origin}
                siteId={siteData.id}
                lat={siteData.origin.lat0}
                lonEast={siteData.origin.lon0}
                onMarkers={onCrewMarkers}
                onNight={setNightContingency}
              />
            )}
            {mode === 'earth' && notice && <div className="globe-notice" style={{ top: 'calc(var(--space-16) * 4)' }}>{notice}</div>}
            {edges.map((label) => (
              <span
                key={label.key}
                className={`map-label globe-edge globe-edge--${label.axis}`}
                style={{ left: label.x, top: label.y }}
              >
                {label.text}
              </span>
            ))}
            {cursor && (
              <div className="map-label globe-cursor" data-over-map>
                {cursor}
              </div>
            )}
            {hover && (
              <div
                className="globe-hover"
                style={{
                  left: hover.x,
                  top: hover.y,
                  transform: hover.flip ? 'translate(calc(-100% - 12px), 12px)' : 'translate(12px, 12px)',
                }}
              >
                {hover.lines.map((line) => (
                  <span key={line} className="map-label">
                    {line}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
