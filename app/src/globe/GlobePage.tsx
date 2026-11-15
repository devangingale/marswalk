// Written with AI assistance, directed and reviewed by the team.
// Explore tab: the globe with site and whole-planet layers, the site finder and the sample
// routes, on the shared Regions layout (?tab=explore, or the older ?globe=1).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoundingSphere,
  Cartesian2,
  Cartographic,
  type Cesium3DTileset,
  Color,
  CustomDataSource,
  Ellipsoid,
  EllipsoidalOccluder,
  Entity,
  HeadingPitchRange,
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
import { AVAILABLE_SITES, GLOBE_BASE, getSiteBaseUrl, getSiteJsonUrl } from '../config';
import { LayerPanel } from '../components/LayerPanel';
import samplePlanJson from '../fixtures/plan.sample.json';
import { loadGrid, type RouteGrid } from '../lib/grid';
import type { Plan } from '../lib/plan';
import { sections as routeSections } from '../lib/routeShape';
import type { LayerState, SiteData } from '../types';
import { createMarsViewer, initCesium } from './cesiumSetup';
import { installGroundPan } from './groundPan';
import { buildCornerPlan } from './cornerPlan';
import { cartesianToLonLat, lonLatToCartesian, siteHeightOffsetM } from './frame';
import { GlobeGlobalLayers, GlobeLayer, loadGlobeManifest } from './globalLayers';
import { GlobeGraticule, cullLabels, graticuleLines, type Box, type GraticuleLine, type ViewBounds } from './graticule';
import { GlobeImagery } from './imageryLayers';
import { attachSiteTerrain, measureEdgeSeam, type SiteTerrainMesh } from './siteTerrain';
import { Clock } from './Clock';
import { ConditionsPanel } from '../components/ConditionsPanel';
import { Regions } from '../shell/Regions';
import { marsSolarLongitude } from '../lib/sun';
import { GlobeTemperatureLayer, loadTemperatureManifest } from './temperature/temperatureLayer';
import { TemperatureRow } from './temperature/TemperatureRow';
import { readoutLines, seasonBin, type TemperatureKind, type TemperatureManifest } from './temperature/temperatureManifest';
import { SiteFinder } from './sites/SiteFinder';
import { GlobeOverlays } from './overlays';
import { formatElevation, formatLatLon, graticuleStep, screenSpan, sectionLabel } from './routeLook';
import type { Theme } from './theme/theme';
import { EnterSurfacePopover, MOSAIC_RADIUS_M, useSurface360, type EnterCandidate } from '../surface360/Surface360';
import { formatMetres } from '../surface360/geodesic';
import { isInSurfaceView } from '../surface360/SurfaceView';
import type { Site } from './sites/types';
import { ViewMenu } from './ViewMenu';
import { ExploreAnnotations, HeatmapButtons, HotspotList, chooseHeatmap, defaultGlobalOn, type AnnotationsSnapshot } from './annotations';

const CAVE_CREDIT = 'Mars Global Cave Candidate Catalog (MGC³), USGS Astrogeology Science Center';
/** Data overlays start at the --map-overlay-opacity token value. */
const OVERLAY_OPACITY = 0.7;

/** Opening view: the whole disc, centred on the Gale longitude. */
const PLANET_VIEW = { lon: 137.4, lat: -4.7, heightM: 9_000_000 };

const SAMPLE_PLAN = samplePlanJson as unknown as Plan;
type PlanChoice = 'corner' | 'sample';
const PLAN_TITLES: Record<PlanChoice, string> = { corner: 'Corner loop', sample: 'Boxwork out and back' };

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

/**
 * Initial state from the URL, for linking straight to a view: layers=, site=, caves=1,
 * view=lon,lat,range, plan=, slopes=1, grid=1. The site itself comes from the top bar.
 */
function urlState() {
  const params = new URLSearchParams(window.location.search);
  const list = (key: string) => params.get(key)?.split(',').filter(Boolean) ?? [];
  const view = params.get('view')?.split(',').map(Number);
  return {
    flyToSite: params.get('fly') === '1' || params.has('siteId') || (params.has('site') && AVAILABLE_SITES.includes(params.get('site')!)),
    globalOn: defaultGlobalOn(params.has('layers') ? list('layers') : null),
    siteOn: params.has('site') && !AVAILABLE_SITES.includes(params.get('site')!) ? list('site') : (params.has('siteLayers') ? list('siteLayers') : null),
    caves: params.get('caves') === '1',
    view: view?.length === 3 && view.every(Number.isFinite) ? (view as [number, number, number]) : null,
    plan: (params.get('plan') === 'sample' ? 'sample' : 'corner') as PlanChoice,
    slopes: params.get('slopes') === '1',
    grid: params.get('grid') === '1',
    sample: params.get('sample') === '1',
  };
}

async function flyTo(viewer: Viewer, lon: number, lat: number, rangeM: number, pitchDeg: number, groundM?: number) {
  // A site load or crew framing that lands while the 360° view is open must not pull the camera out.
  if (isInSurfaceView(viewer)) return;
  const [sampled] = groundM === undefined
    ? await viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(lon, lat)])
    : [undefined];
  const centre = lonLatToCartesian(lon, lat, groundM ?? sampled?.height ?? 0);
  if (isInSurfaceView(viewer)) return;
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

export interface GlobePageProps {
  /** Site from the top bar picker. */
  siteId: string;
  /** Applied token set, so map labels repaint when it changes. */
  theme: Theme;
}

/** Elements the graticule edge labels keep clear of: map controls, panel handles, sliding panels. */
const LABEL_BLOCKERS = '[data-over-map], .s48-regions__handle, .s48-regions[data-overlay=\'true\'] .s48-regions__panel:not([hidden])';

export const GlobePage: React.FC<GlobePageProps> = ({ siteId, theme }) => {
  const initial = useRef(urlState()).current;
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);
  const cesiumModeRef = useRef<ReturnType<typeof initCesium>>('ion');
  const siteImageryRef = useRef<GlobeImagery | null>(null);
  const siteTerrainRef = useRef<SiteTerrainMesh | null>(null);
  const globalRef = useRef<GlobeGlobalLayers | null>(null);
  const temperatureRef = useRef<GlobeTemperatureLayer | null>(null);
  const annotationsRef = useRef<ExploreAnnotations | null>(null);
  const overlaysRef = useRef<GlobeOverlays | null>(null);
  const graticuleRef = useRef<GlobeGraticule | null>(null);
  const gridRef = useRef<RouteGrid | null>(null);
  const graticuleLinesRef = useRef<GraticuleLine[]>([]);
  const groundRef = useRef(0);
  const viewRef = useRef<HTMLDivElement>(null);

  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [siteFailed, setSiteFailed] = useState(false);
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
  const [annotations, setAnnotations] = useState<AnnotationsSnapshot>({ caveCount: 0, hotspots: [] });
  const [leftView, setLeftView] = useState<'layers' | 'sites'>('layers');
  const [notice, setNotice] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Set once the Mars scene is ready; gates the clock and site-finder mounts.
  const [dustScene, setDustScene] = useState<Scene | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // The site finder's card renders into the right panel.
  const [cardHost, setCardHost] = useState<HTMLElement | null>(null);
  const [siteSelected, setSiteSelected] = useState(false);
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
  // 360° surface view: a clicked waypoint or rover mark offers to enter it.
  const surface = useSurface360(viewer);
  const surfaceActiveRef = useRef(false);
  surfaceActiveRef.current = surface.active;
  const [enterCandidate, setEnterCandidate] = useState<EnterCandidate | null>(null);
  // Known sites (known_sites.csv via sites.json): the rover's 360° mosaic when one is within
  // MOSAIC_RADIUS_M, else an eye-level view on the orbital surface. Candidates get neither.
  const siteAction = useCallback(
    (site: Site) => {
      if (site.kind === 'new') return null;
      const near = surface.nearest({ lon: site.lon, lat: site.lat });
      if (near && near.distanceM <= MOSAIC_RADIUS_M) {
        return (
          <button type="button" className="s48-btn s48-btn--primary" disabled={!surface.ready} onClick={() => surface.enter(near.stop.id)}>
            Enter 360° Surface View · {near.stop.pia_id}, {formatMetres(near.distanceM)} away
          </button>
        );
      }
      return (
        <button
          type="button"
          className="s48-btn s48-btn--secondary"
          disabled={surface.active}
          onClick={() =>
            surface.enterRecon({
              id: site.id,
              name: site.name,
              lat: site.lat,
              lon_east: site.lon,
              elevation_m: Number.isFinite(site.evidence?.elevation_m) ? site.evidence.elevation_m : null,
            })
          }
        >
          Surface View (Orbital DEM)
        </button>
      );
    },
    [surface],
  );
  useEffect(() => {
    if (surface.active) setEnterCandidate(null);
  }, [surface.active]);
  useEffect(() => {
    if (!enterCandidate) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setEnterCandidate(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterCandidate]);

  const statesRef = useRef({ layerStates, globalStates, graticuleOn });
  statesRef.current = { layerStates, globalStates, graticuleOn };

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
  // The sample out-and-back is drawn at Gale only; other sites offer the corner loop.
  const choices: PlanChoice[] = siteData?.id === SAMPLE_PLAN.site ? ['corner', 'sample'] : ['corner'];
  const activeChoice: PlanChoice = choices.includes(planChoice) ? planChoice : 'corner';
  const shownPlan = activeChoice === 'corner' ? cornerPlan : siteData ? SAMPLE_PLAN : null;
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
    cesiumModeRef.current = initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN, navigator.onLine);

    void (async () => {
      const created = await createMarsViewer(container, { interactive: true });
      const { viewer, tileset } = created;
      if (disposed) {
        viewer.destroy();
        return;
      }
      cesiumModeRef.current = created.mode;
      tilesetRef.current = tileset;
      viewerRef.current = viewer;
      viewer.camera.setView({ destination: lonLatToCartesian(PLANET_VIEW.lon, PLANET_VIEW.lat, PLANET_VIEW.heightM) });
      if (!tileset) setNotice('Offline, local tiles');

      // Markers clamp to Cesium Mars only when the tileset takes part in height queries.
      if (tileset) tileset.enableCollision = true;

      annotationsRef.current = new ExploreAnnotations(viewer, {
        base: GLOBE_BASE,
        values: (id) => globalRef.current?.values(id) ?? Promise.reject(new Error('Globe layers not loaded')),
        onChange: setAnnotations,
        blockers: () => [...(rootRef.current?.querySelectorAll(LABEL_BLOCKERS) ?? [])],
      });

      const graticuleSource = new CustomDataSource('graticule');
      void viewer.dataSources.add(graticuleSource);
      graticuleRef.current = new GlobeGraticule(graticuleSource, cssColour('--map-graticule'));
      removers.push(viewer.camera.moveEnd.addEventListener(refreshGraticule));
      let lastEdges = '';
      removers.push(
        viewer.scene.postRender.addEventListener(() => {
          if (!statesRef.current.graticuleOn) return;
          // Controls, panel handles and sliding panels keep labels out from under them.
          const view = viewRef.current?.getBoundingClientRect();
          const panels: Box[] = view
            ? [...(rootRef.current?.querySelectorAll(LABEL_BLOCKERS) ?? [])].map((el) => {
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

      overlaysRef.current = new GlobeOverlays(viewer, { onSectionHover: setHoveredSection });
      const imageryTarget = tileset?.imageryLayers ?? viewer.imageryLayers;
      siteImageryRef.current = new GlobeImagery(imageryTarget);
      setDustScene(viewer.scene);
      // Last, so the site load (keyed on the viewer) finds the imagery and overlays ready.
      setViewer(viewer);

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

      if (initial.view) void flyTo(viewer, initial.view[0], initial.view[1], initial.view[2], -90);

      let frame = 0;
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      // Ground pan stands down while the camera is inside a 360° or orbital-recon surface view,
      // where a drag turns the view instead.
      removers.push(installGroundPan(viewer, () => surfaceActiveRef.current));
      handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
        if (surfaceActiveRef.current) return;
        const target = overlaysRef.current?.surfaceTarget(viewer.scene.pick(event.position));
        setEnterCandidate(
          target ? { x: event.position.x, y: event.position.y, title: target.title, at: { lon: target.lon, lat: target.lat } } : null,
        );
      }, ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
        if (surfaceActiveRef.current) return;
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
          const caveLines = annotationsRef.current?.hover(picked);
          if (caveLines) {
            place(caveLines);
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
      annotationsRef.current?.destroy();
      graticuleRef.current?.clear();
      siteImageryRef.current?.clear();
      siteTerrainRef.current?.destroy();
      siteTerrainRef.current = null;
      globalRef.current?.destroy();
      temperatureRef.current?.destroy();
      viewerRef.current?.destroy();
      viewerRef.current = null;
      setViewer(null);
    };
  }, [initial, refreshGraticule]);

  // The site from the top bar: imagery, elevation grid and terrain mesh. A change of site
  // replaces all three and flies there; the first load keeps the whole-planet view online.
  const firstSiteRef = useRef(true);
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    const first = firstSiteRef.current;
    firstSiteRef.current = false;
    const mode = cesiumModeRef.current;
    const tileset = tilesetRef.current;
    const siteBaseUrl = initial.sample ? `/sample/${siteId}` : getSiteBaseUrl(siteId);
    setSiteFailed(false);
    siteTerrainRef.current?.destroy();
    siteTerrainRef.current = null;
    gridRef.current = null;
    setGrid(null);
    fetch(initial.sample ? `${siteBaseUrl}/site.json` : getSiteJsonUrl(siteId))
      .then((r) => (r.ok ? (r.json() as Promise<SiteData>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(async (site) => {
        if (cancelled) return;
        const states = Object.fromEntries(
          site.layers.map((l) => [
            l.id,
            {
              enabled: first && initial.siteOn ? initial.siteOn.includes(l.id) : l.default_on,
              opacity: l.kind === 'optical' ? 1 : OVERLAY_OPACITY,
            },
          ]),
        );
        setSiteData(site);
        setLayerStates(states);
        siteImageryRef.current?.apply(states);
        await siteImageryRef.current?.setSite(site, mode);
        const loaded = await loadGrid(siteBaseUrl, site.origin);
        if (cancelled) return;
        gridRef.current = loaded;
        setGrid(loaded);
        const offset = await siteHeightOffsetM(viewer, tileset, site, loaded);
        console.info(`Height offset at ${site.id}: ${offset.toFixed(2)} m`);
        const seam = await measureEdgeSeam(viewer, tileset, site, loaded, offset);
        if (seam) {
          console.info(`Site terrain seam at ${site.id}: mean ${seam.meanM.toFixed(2)} m, max ${seam.maxM.toFixed(2)} m (${seam.samples} edge points)`);
        }
        if (cancelled) return;
        const mesh = await attachSiteTerrain(viewer, tileset, site, offset, siteBaseUrl);
        if (cancelled) {
          mesh?.destroy();
          return;
        }
        siteTerrainRef.current = mesh;
        if (!first || (!initial.view && (mode === 'offline' || initial.flyToSite))) {
          const [west, south, east, north] = site.bounds_lonlat;
          void flyTo(viewer, (west + east) / 2, (south + north) / 2, Math.max(site.size_m.width, site.size_m.height) * 2, -60, mode === 'offline' ? 0 : undefined);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Site did not load', error);
        siteImageryRef.current?.clear();
        overlaysRef.current?.clear();
        setSiteData(null);
        setLayerStates({});
        setSiteFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [viewer, siteId, initial]);

  useEffect(() => siteImageryRef.current?.apply(layerStates), [layerStates]);
  useEffect(() => globalRef.current?.apply(globalStates), [globalStates]);
  useEffect(() => temperatureRef.current?.apply({ ...temperature, bin }), [temperature, bin, temperatureManifest]);
  useEffect(
    () => annotationsRef.current?.update({ layers: globalLayers, states: globalStates, caves: cavesOn }),
    [viewer, globalLayers, globalStates, cavesOn],
  );
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
    viewer.scene.requestRender();
  }, [theme, viewer]);

  // A selected site shows its card in the right panel: open the panel if it is folded away.
  const onSiteSelected = useCallback((id: string | null) => {
    setSiteSelected(id !== null);
    if (id === null) return;
    rootRef.current?.querySelector<HTMLButtonElement>('.s48-regions__handle--right[aria-expanded=\'false\']')?.click();
    cardHost?.scrollIntoView({ block: 'nearest' });
  }, [cardHost]);

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

  const left = (
    <div className="explore-left">
      <div className="explore-left__switch">
        <div className="s48-seg" role="group" aria-label="Left panel">
          <button type="button" aria-pressed={leftView === 'layers'} onClick={() => setLeftView('layers')}>
            Layers
          </button>
          <button type="button" aria-pressed={leftView === 'sites'} onClick={() => setLeftView('sites')}>
            Site finder
          </button>
        </div>
      </div>
      <div className="explore-left__layers" hidden={leftView !== 'layers'}>
        <LayerPanel
          layers={siteData?.layers ?? []}
          layerStates={layerStates}
          onToggleLayer={toggle(setLayerStates)}
          onOpacityChange={setOpacity(setLayerStates)}
          globalLayers={globalLayers}
          globalStates={globalStates}
          onToggleGlobal={toggle(setGlobalStates)}
          onGlobalOpacityChange={setOpacity(setGlobalStates)}
          globalDetail={Object.fromEntries(
            annotations.hotspots.map((set) => [
              set.layer.id,
              <HotspotList key={set.layer.id} set={set} onSelect={(lon, lat) => annotationsRef.current?.focus(lon, lat)} />,
            ]),
          )}
          caves={
            annotations.caveCount > 0
              ? { enabled: cavesOn, count: annotations.caveCount, credit: CAVE_CREDIT, onToggle: () => setCavesOn((v) => !v) }
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
          isOpen
          onTogglePanel={() => undefined}
        />
      </div>
      <div className="explore-left__sites" hidden={leftView !== 'sites'}>
        <SiteFinder
          viewer={viewer}
          active={leftView === 'sites'}
          registerHover={registerSiteHover}
          cardHost={cardHost}
          onSelectedChange={onSiteSelected}
          siteAction={siteAction}
        />
      </div>
    </div>
  );

  const right = (
    <div className="explore-right">
      {(notice || siteFailed) && (
        <section className="explore-sec explore-sec--status" aria-label="Status">
          {notice && <p>{notice}</p>}
          {siteFailed && <p>No site bundle for {siteId} on this server. Whole-planet layers still work.</p>}
        </section>
      )}
      <section className="explore-sec explore-sec--site" aria-label="Selected site" ref={setCardHost} hidden={!siteSelected} />
      <section className="explore-sec explore-sec--now">
        <ConditionsPanel />
      </section>
      {siteData && shownPlan && (
        <section className="explore-sec" aria-label="Sample route">
          <h2 className="explore-sec__title">Sample route</h2>
          {choices.length > 1 && (
            <div className="s48-seg explore-route__choice" role="group" aria-label="Sample route">
              {choices.map((choice) => (
                <button key={choice} type="button" aria-pressed={activeChoice === choice} onClick={() => setPlanChoice(choice)}>
                  {PLAN_TITLES[choice]}
                </button>
              ))}
            </div>
          )}
          <ol className="explore-route__legs">
            {sectionRows.map((section) => (
              <li key={section.id} className={hoveredSection === section.id ? 'is-hovered' : undefined}>
                {sectionLabel(section, shownPlan)}
              </li>
            ))}
          </ol>
          <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToRoute}>
            Show route
          </button>
          {slopesOn && !slopesAvailable && (
            <p className="explore-sec__note">No elevation grid under this route in the sample bundle.</p>
          )}
        </section>
      )}
    </div>
  );

  const controls = (
    <>
      <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToPlanet}>
        Whole planet
      </button>
      <HeatmapButtons layers={globalLayers} states={globalStates} onChoose={(id) => setGlobalStates((prev) => chooseHeatmap(prev, id))} />
      {siteData && (
        <button type="button" className="s48-btn s48-btn--secondary explore-site-btn" onClick={flyToSite} title={`Fly to ${siteData.title}`}>
          {siteData.title}
        </button>
      )}
      <ViewMenu
        toggles={[
          ...(siteData ? [{ label: 'Slopes', checked: slopesOn, onChange: () => setSlopesOn((v) => !v) }] : []),
          { label: 'Lat/lon grid', checked: graticuleOn, onChange: () => setGraticuleOn((v) => !v) },
        ]}
      />
    </>
  );

  const main = (
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
      {/* Map labels step aside in the 360° view; display: contents keeps their layout and state. */}
      <div style={{ display: surface.active ? 'none' : 'contents' }}>
      {edges.map((label) => (
        <span
          key={label.key}
          className={`map-label globe-edge globe-edge--${label.axis}`}
          style={{ left: label.x, top: label.y }}
        >
          {label.text}
        </span>
      ))}
      {cursor && <div className="map-label globe-cursor">{cursor}</div>}
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
      {enterCandidate && !surface.active && (
        <EnterSurfacePopover candidate={enterCandidate} surface={surface} onClose={() => setEnterCandidate(null)} />
      )}
      {surface.overlay}
    </div>
  );

  return (
    <div className="explore" ref={rootRef}>
      <Regions
        id="explore"
        left={left}
        leftLabel="Layers"
        right={right}
        rightLabel="Details"
        main={main}
        // The map controls would sit over the 360° view's HUD; they return on exit.
        controls={surface.active ? undefined : controls}
        time={dustScene ? <Clock scene={dustScene} onLs={setLs} /> : undefined}
      />
    </div>
  );
};
