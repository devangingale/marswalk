// Written with AI assistance, directed and reviewed by the team.
// Globe page with site and whole-planet layers, reached with ?globe=1.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoundingSphere,
  Cartographic,
  Color,
  CustomDataSource,
  Entity,
  HeadingPitchRange,
  HeightReference,
  Math as CesiumMath,
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
import { loadGrid } from '../lib/grid';
import type { LayerState, SiteData } from '../types';
import { createMarsViewer, initCesium } from './cesiumSetup';
import { cartesianToLonLat, lonLatToCartesian, siteHeightOffsetM } from './frame';
import { GlobeGlobalLayers, GlobeLayer, globeAssetUrl, loadGlobeManifest } from './globalLayers';
import { GlobeImagery } from './imageryLayers';
import { GlobeTimeTools } from './Clock';
import { SiteFinder } from './sites/SiteFinder';
import { useGlobeTheme } from './theme/useGlobeTheme';

const CAVE_CREDIT = 'Mars Global Cave Candidate Catalog (MGC³), USGS Astrogeology Science Center';
/** Data overlays start at the --map-overlay-opacity token value. */
const OVERLAY_OPACITY = 0.7;

/** Opening view: the whole disc, centred on the Gale longitude. */
const PLANET_VIEW = { lon: 137.4, lat: -4.7, heightM: 9_000_000 };
const CAVE_HOVER = 'unexplored, from orbit';

interface CaveCollection {
  features: { geometry: { coordinates: [number, number] }; properties: { id: string } }[];
}

interface Hover {
  x: number;
  y: number;
  flip: boolean;
  lines: string[];
}

function cssColour(name: string): Color {
  return Color.fromCssColorString(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** Initial state from the URL, for linking straight to a view: layers=, site=, caves=1, view=lon,lat,range. */
function urlState() {
  const params = new URLSearchParams(window.location.search);
  const list = (key: string) => params.get(key)?.split(',').filter(Boolean) ?? [];
  const view = params.get('view')?.split(',').map(Number);
  return {
    globalOn: list('layers'),
    siteOn: params.has('site') ? list('site') : null,
    caves: params.get('caves') === '1',
    view: view?.length === 3 && view.every(Number.isFinite) ? (view as [number, number, number]) : null,
  };
}

async function flyTo(viewer: Viewer, lon: number, lat: number, rangeM: number, pitchDeg: number) {
  const [sampled] = await viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(lon, lat)]);
  const centre = lonLatToCartesian(lon, lat, sampled?.height ?? 0);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, 1), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(pitchDeg), rangeM),
  });
}

export const GlobePage: React.FC = () => {
  const initial = useRef(urlState()).current;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const siteImageryRef = useRef<GlobeImagery | null>(null);
  const globalRef = useRef<GlobeGlobalLayers | null>(null);
  const cavesRef = useRef<CustomDataSource | null>(null);

  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const { mode, setMode, override, setOverride, theme } = useGlobeTheme(
    siteData ? { lat: siteData.origin.lat0, lon: siteData.origin.lon0 } : null,
  );
  const [layerStates, setLayerStates] = useState<Record<string, LayerState>>({});
  const [globalLayers, setGlobalLayers] = useState<GlobeLayer[]>([]);
  const [globalStates, setGlobalStates] = useState<Record<string, LayerState>>({});
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

  const statesRef = useRef({ layerStates, globalStates, cavesOn });
  statesRef.current = { layerStates, globalStates, cavesOn };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let handler: ScreenSpaceEventHandler | null = null;
    initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN);

    void (async () => {
      const { viewer, tileset } = await createMarsViewer(container, { interactive: true });
      if (disposed) {
        viewer.destroy();
        return;
      }
      viewerRef.current = viewer;
      setViewer(viewer);
      viewer.camera.setView({ destination: lonLatToCartesian(PLANET_VIEW.lon, PLANET_VIEW.lat, PLANET_VIEW.heightM) });
      if (!tileset) {
        setNotice('Cesium Mars didn’t load, so layers can’t be draped. Check the Cesium ion token and connection.');
        return;
      }

      const caves = new CustomDataSource('caves');
      caves.show = statesRef.current.cavesOn;
      cavesRef.current = caves;
      void viewer.dataSources.add(caves);

      siteImageryRef.current = new GlobeImagery(tileset.imageryLayers);
      setDustScene(viewer.scene);

      loadGlobeManifest(GLOBE_BASE)
        .then((manifest) => {
          if (disposed) return;
          globalRef.current = new GlobeGlobalLayers(tileset.imageryLayers, GLOBE_BASE, manifest.layers);
          const states = Object.fromEntries(
            manifest.layers.map((l) => [l.id, { enabled: initial.globalOn.includes(l.id), opacity: OVERLAY_OPACITY }]),
          );
          globalRef.current.apply(states);
          setGlobalStates(states);
          setGlobalLayers(manifest.layers);
        })
        .catch((error) => console.warn('Globe layer manifest did not load', error));

      fetch(globeAssetUrl(GLOBE_BASE, 'caves.geojson'))
        .then((r) => (r.ok ? (r.json() as Promise<CaveCollection>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => {
          if (disposed) return;
          const fill = cssColour('--map-cave');
          const ring = cssColour('--map-label-halo');
          for (const f of data.features) {
            const [lon, lat] = f.geometry.coordinates;
            caves.entities.add({
              id: `cave:${f.properties.id}`,
              name: f.properties.id,
              position: lonLatToCartesian(lon, lat, 0),
              point: {
                pixelSize: 7,
                color: fill,
                outlineColor: ring,
                outlineWidth: 1,
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
          await siteImageryRef.current!.setSite(site);
          const grid = await loadGrid(getSiteBaseUrl(site.id), site.origin);
          const offset = await siteHeightOffsetM(viewer, tileset, site, grid);
          console.info(`Height offset at ${site.id}: ${offset.toFixed(2)} m`);
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
            setHover(lines.length ? { x: at.x, y: at.y, flip: at.x > width - 260, lines } : null);

          const picked = viewer.scene.pick(at) as { id?: unknown } | undefined;
          if (picked?.id instanceof Entity && caves.entities.contains(picked.id)) {
            place([`Cave candidate ${picked.id.name}`, CAVE_HOVER]);
            return;
          }
          const siteLines = siteHoverRef.current?.(picked?.id instanceof Entity ? picked.id : null);
          if (siteLines && siteLines.length) {
            place(siteLines);
            return;
          }
          const position = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(at) : undefined;
          const point = cartesianToLonLat(position);
          place(point && globalRef.current ? globalRef.current.readouts(point.lon, point.lat) : []);
        });
      }, ScreenSpaceEventType.MOUSE_MOVE);
    })();

    return () => {
      disposed = true;
      handler?.destroy();
      siteImageryRef.current?.clear();
      globalRef.current?.destroy();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [initial]);

  useEffect(() => siteImageryRef.current?.apply(layerStates), [layerStates]);
  useEffect(() => globalRef.current?.apply(globalStates), [globalStates]);
  useEffect(() => {
    if (cavesRef.current) cavesRef.current.show = cavesOn;
  }, [cavesOn]);

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

  return (
    <div className="mock plan-mock">
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
            isOpen={panelOpen && panelTab === 'layers'}
            onTogglePanel={() => setPanelOpen(!panelOpen)}
          />
          <SiteFinder
            viewer={viewer}
            active={mode === 'earth' && panelOpen && panelTab === 'sites'}
            registerHover={registerSiteHover}
            onHide={() => setPanelOpen(false)}
          />
          <div className="globe-view" onMouseLeave={() => setHover(null)}>
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
            {dustScene && <GlobeTimeTools scene={dustScene} />}
            {siteData && (
              <div className="globe-sites">
                <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToPlanet}>
                  Whole planet
                </button>
                <button type="button" className="s48-btn s48-btn--secondary" onClick={flyToSite}>
                  {siteData.title}
                </button>
              </div>
            )}
            {notice && <div className="globe-notice">{notice}</div>}
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
