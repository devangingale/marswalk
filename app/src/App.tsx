// Written with AI assistance, directed and reviewed by the team.

import React, { Suspense, lazy, useEffect, useMemo, useReducer, useState, useCallback, useRef } from 'react';
import { SiteData, LayerState, AppMode, RoverOverlayState } from './types';
import {
  TILES_BASE,
  AVAILABLE_SITES,
  DEFAULT_SITE,
  getSiteJsonUrl,
  resolveSiteAssetUrl,
} from './config';
import stubSiteSample from './fixtures/site.sample.json';
import { Plan } from './lib/plan';
import { buildTrack } from './walk/track';
import { usePlayback } from './walk/usePlayback';
import { NoticeBanner } from './components/NoticeBanner';
import { SiteSwitcher } from './components/SiteSwitcher';
import { LayerPanel } from './components/LayerPanel';
import { GlobePlanMap } from './globe/GlobePlanMap';
import { WalkView } from './components/WalkView';
import { VisorView } from './components/VisorView';
import { PlanRail } from './plan/PlanRail';
import { Regions } from './shell/Regions';
import { useWholePlanet } from './plan/wholePlanet';
import { TemperatureRow } from './globe/temperature/TemperatureRow';
import { legendRamp } from './globe/temperature/temperatureManifest';
import { findWalkableCentre, isLatestPlanRequest, makeInitialPlan, mapClickAction, nextStopName, SHELTER_MOVE_IDLE, shelterMoveReducer } from './plan/planLogic';
import { loadGrid, type RouteGrid } from './lib/grid';
import { normalizeShelter, type PlanStop } from './lib/plan';
import { reachableMask, snapToReachable, snapToPassable } from './lib/snap';
import { DEFAULT_SURFACE_DOSE_MGY_PER_DAY, DEFAULT_SOLAR_EVENT_MGY_PER_DAY } from './lib/energy';
import { type Mover } from './globe/plan/MoverPicker';
import { useGlobeTheme } from './globe/theme/useGlobeTheme';
import type { ThemeOverride } from './globe/theme/theme';
import './plan/plan.css';
import './styles/visualReview.css';

// Explore loads its own Cesium page only when opened.
const GlobePage = lazy(() => import('./globe/GlobePage').then((m) => ({ default: m.GlobePage })));

const CAVE_CREDIT = 'Mars Global Cave Candidate Catalog (MGC³), USGS Astrogeology Science Center';

/** The four tabs in the top bar, Explore first. Explore and Plan plan from Earth; Walk and Visor are at the site. */
export type Tab = 'explore' | AppMode;
const TABS: { id: Tab; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'plan', label: 'Plan' },
  { id: 'walk', label: 'Walk' },
  { id: 'visor', label: 'Visor' },
];
const THEMES: { id: ThemeOverride; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
];

/** ?tab=explore|plan|walk|visor; Plan when absent. main.tsx maps the older ?globe=1 to Explore. */
export function tabFromSearch(search: string): Tab {
  const tab = new URLSearchParams(search).get('tab');
  return TABS.some((t) => t.id === tab) ? (tab as Tab) : 'plan';
}

function siteFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const site = params.get('siteId') ?? params.get('site');
  return site && AVAILABLE_SITES.includes(site) ? site : DEFAULT_SITE;
}

/** Keeps one tab from taking the whole app down; the header stays usable to switch away. */
class TabBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Tab failed to render', error);
  }
  render() {
    return this.state.failed ? (
      <div role="alert" style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>This view stopped with an error. Switch tabs or reload the page.</div>
    ) : (
      this.props.children
    );
  }
}

export const App: React.FC = () => {
  const [currentSiteId, setCurrentSiteId] = useState<string>(() => siteFromSearch(window.location.search));
  const [siteData, setSiteData] = useState<SiteData>(stubSiteSample as unknown as SiteData);
  const [isSampleFallback, setIsSampleFallback] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [mode, setMode] = useState<Tab>(() => tabFromSearch(window.location.search));
  const [layerStates, setLayerStates] = useState<Record<string, LayerState>>({});
  const [roverOverlayState, setRoverOverlayState] = useState<RoverOverlayState>({ traverse: true, photos: true });
  const [photosAvailable, setPhotosAvailable] = useState(false);
  const [relief, setRelief] = useState(false);
  // The plan Walk and Visor replay (contracts section 7). The Plan view sets it; until then, the sample plan.
  const [plan, setPlan] = useState<Plan>(() => makeInitialPlan(DEFAULT_SITE, { ...stubSiteSample.default_start, kind: 'habitat', label: '' }));
  const [mover, setMover] = useState<Mover>('walker');
  const [profileHover, setProfileHover] = useState<{ lon: number; lat: number } | null>(null);
  const [routeGrid, setRouteGrid] = useState<RouteGrid | null>(null);
  const [routeGridSite, setRouteGridSite] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [doseRates, setDoseRates] = useState({ surface: DEFAULT_SURFACE_DOSE_MGY_PER_DAY, solar: DEFAULT_SOLAR_EVENT_MGY_PER_DAY });
  const [stopNotices, setStopNotices] = useState<Record<string, string>>({});
  const [shelterMove, dispatchShelterMove] = useReducer(shelterMoveReducer, SHELTER_MOVE_IDLE);
  const planWorker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const initializedPlanSite = useRef<string | null>(null);
  const siteLoadId = useRef(0);
  const track = useMemo(() => buildTrack(plan, siteData.origin), [plan, siteData.origin]);
  const wholePlanet = useWholePlanet({ lon: siteData.origin.lon0, lat: siteData.origin.lat0 });
  // Night at the site in Walk (the safety model's call) themes the top bar too, not only the tab body.
  const [walkNight, setWalkNight] = useState(false);
  // A new route or another tab drops the profile hover point, so no dot is left on the map.
  useEffect(() => setProfileHover(null), [plan.route, mode]);
  const playback = usePlayback(track.durationS);

  const loadSite = useCallback(async (siteId: string) => {
    const loadId = ++siteLoadId.current;
    setIsLoading(true);
    const targetUrl = getSiteJsonUrl(siteId);

    try {
      const resp = await fetch(targetUrl);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} fetching ${targetUrl}`);
      }
      const data: SiteData = await resp.json();
      if (loadId !== siteLoadId.current) return;
      setSiteData(data);
      setIsSampleFallback(false);

      const initialStates: Record<string, LayerState> = {};
      data.layers.forEach((layer) => {
        initialStates[layer.id] = {
          enabled: layer.default_on ?? false,
          opacity: 1.0,
        };
      });
      setLayerStates(initialStates);
    } catch {
      if (loadId !== siteLoadId.current) return;
      const fallbackData = {
        ...(stubSiteSample as unknown as SiteData),
        id: siteId,
        title: siteId === 'jezero' ? 'Jezero crater delta (Stub Specification)' : stubSiteSample.title,
        rover: siteId === 'jezero' ? 'Perseverance' : stubSiteSample.rover,
      };

      setSiteData(fallbackData);
      setIsSampleFallback(true);

      const initialStates: Record<string, LayerState> = {};
      fallbackData.layers.forEach((layer) => {
        initialStates[layer.id] = {
          enabled: layer.default_on ?? false,
          opacity: 1.0,
        };
      });
      setLayerStates(initialStates);
    } finally {
      if (loadId === siteLoadId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSite(currentSiteId);
  }, [currentSiteId, loadSite]);

  useEffect(() => {
    let active = true;
    setPhotosAvailable(false);
    if (!siteData.photos_url) return () => { active = false; };
    void fetch(resolveSiteAssetUrl(siteData.id, siteData.photos_url), { method: 'HEAD' })
      .then((response) => {
        if (!active) return;
        setPhotosAvailable(response.ok && (response.headers.get('content-type')?.includes('json') ?? false));
      })
      .catch(() => { if (active) setPhotosAvailable(false); });
    return () => { active = false; };
  }, [siteData.id, siteData.photos_url]);

  useEffect(() => {
    let active = true;
    setRouteGrid(null);
    setRouteGridSite(null);
    if (siteData.id !== currentSiteId) return () => { active = false; };
    void loadGrid(`${TILES_BASE.replace(/\/+$/, '')}/${currentSiteId}`, siteData.origin).then((grid) => {
      if (active) { setRouteGrid(grid); setRouteGridSite(currentSiteId); }
    }).catch(() => {
      if (currentSiteId === 'gale') void loadGrid('/sample/gale', siteData.origin).then((grid) => { if (active) { setRouteGrid(grid); setRouteGridSite(currentSiteId); } }).catch(() => undefined);
    });
    return () => { active = false; };
  }, [currentSiteId, siteData.id, siteData.origin]);

  useEffect(() => {
    let active = true;
    setDoseRates({ surface: DEFAULT_SURFACE_DOSE_MGY_PER_DAY, solar: DEFAULT_SOLAR_EVENT_MGY_PER_DAY });
    if (!siteData.conditions_url) return () => { active = false; };
    void fetch(resolveSiteAssetUrl(siteData.id, siteData.conditions_url))
      .then((response) => response.ok ? response.json() : null)
      .then((conditions: { radiation?: { surface_dose_mgy_per_day?: number; solar_event_mgy_per_day?: number } } | null) => {
        if (!active || !conditions?.radiation) return;
        setDoseRates({ surface: conditions.radiation.surface_dose_mgy_per_day ?? DEFAULT_SURFACE_DOSE_MGY_PER_DAY, solar: conditions.radiation.solar_event_mgy_per_day ?? DEFAULT_SOLAR_EVENT_MGY_PER_DAY });
      }).catch(() => undefined);
    return () => { active = false; };
  }, [siteData.id, siteData.conditions_url]);

  useEffect(() => {
    if (!routeGrid || routeGridSite !== currentSiteId) return;
    if (plan.site !== currentSiteId || initializedPlanSite.current !== currentSiteId) {
      const start = findWalkableCentre(routeGrid);
      setPlan(makeInitialPlan(currentSiteId, start));
      initializedPlanSite.current = currentSiteId;
    }
  }, [routeGrid, routeGridSite, currentSiteId, plan.site]);

  const routeInputKey = useMemo(() => JSON.stringify({ site: plan.site, start: plan.start, stops: plan.stops, params: plan.params }), [plan.site, plan.start, plan.stops, plan.params]);
  useEffect(() => {
    if (!routeGrid || routeGridSite !== currentSiteId || plan.site !== currentSiteId) return;
    const worker = new Worker(new URL('./plan/route.worker.ts', import.meta.url), { type: 'module' });
    planWorker.current?.terminate();
    planWorker.current = worker;
    const id = ++requestId.current;
    let completed = false;
    setComputing(true);
    worker.onmessage = (event: MessageEvent<{ id: number; plan?: Plan; error?: string }>) => {
      if (!isLatestPlanRequest(event.data.id, requestId.current)) return;
      completed = true;
      setComputing(false);
      if (event.data.plan) setPlan(event.data.plan);
    };
    worker.onerror = () => {
      if (!isLatestPlanRequest(id, requestId.current)) return;
      completed = true;
      setComputing(false);
    };
    worker.postMessage({ id, header: routeGrid.header, origin: routeGrid.origin, elev: routeGrid.elevData.slice(), cost: routeGrid.costData.slice(), site: plan.site, params: plan.params, start: plan.start, stops: plan.stops, dose: doseRates.surface, solarDose: doseRates.solar });
    return () => {
      worker.terminate();
      if (isLatestPlanRequest(id, requestId.current) && !completed) {
        requestId.current++;
        setComputing(false);
      }
    };
  }, [routeInputKey, routeGrid, routeGridSite, currentSiteId, doseRates]);

  const { override, setOverride, theme } = useGlobeTheme(
    { lat: siteData.origin.lat0, lon: siteData.origin.lon0 },
    mode === 'walk' || mode === 'visor' ? 'mars' : 'earth',
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', mode);
    params.delete('globe');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [mode]);

  const handleSiteChange = (newSiteId: string) => {
    if (newSiteId !== currentSiteId) {
      setCurrentSiteId(newSiteId);
    }
  };

  const addStop = useCallback((point: { lon: number; lat: number }) => {
    let target = point;
    let notice: string | null = null;
    if (routeGrid) {
      const mask = reachableMask(routeGrid, plan.start);
      const snapped = snapToReachable(routeGrid, mask, point);
      if (snapped) {
        target = { lon: snapped.lon, lat: snapped.lat };
        if (snapped.movedM > 0) {
          notice = `Moved ${Math.round(snapped.movedM)} m to walkable ground`;
        }
      }
    }
    const newId = `s-${Date.now()}`;
    if (notice) {
      setStopNotices((prev) => ({ ...prev, [newId]: notice! }));
    }
    setPlan((current) => {
      const stop: PlanStop = { id: newId, name: nextStopName(current.stops), ...target, dwell_s: current.params.stop_time_s };
      return { ...current, stops: [...current.stops, stop] };
    });
  }, [routeGrid, plan.start]);

  const updateStart = useCallback((newStart: Plan['start']) => {
    let resolvedStart = newStart;
    let movedM = 0;
    if (routeGrid) {
      const startRc = routeGrid.lonlatToRowCol(newStart.lon, newStart.lat);
      if (!routeGrid.isInside(startRc.row, startRc.col) || !routeGrid.isPassable(startRc.row, startRc.col)) {
        const snapped = snapToPassable(routeGrid, newStart);
        if (snapped) {
          resolvedStart = { ...newStart, lon: snapped.lon, lat: snapped.lat };
          movedM = snapped.movedM;
        }
      }
      reachableMask(routeGrid, resolvedStart);
    }
    dispatchShelterMove({ type: 'placed', movedM });
    setPlan((current) => ({ ...current, start: resolvedStart }));
  }, [routeGrid]);

  // A Plan map click adds a stop, or places the shelter while "Move shelter" is on.
  const handleMapPoint = useCallback((point: { lon: number; lat: number }) => {
    if (mapClickAction(shelterMove) === 'place-shelter') updateStart({ ...plan.start, ...point });
    else addStop(point);
  }, [shelterMove, plan.start, updateStart, addStop]);
  const toggleShelterMove = useCallback(() => dispatchShelterMove({ type: 'toggle' }), []);
  const cancelShelterMove = useCallback(() => dispatchShelterMove({ type: 'cancel' }), []);
  // Leaving Plan or changing site ends move mode.
  useEffect(() => dispatchShelterMove({ type: 'cancel' }), [mode, currentSiteId]);

  const updateStop = useCallback((changed: PlanStop) => {
    let target = changed;
    if (routeGrid) {
      const mask = reachableMask(routeGrid, plan.start);
      const snapped = snapToReachable(routeGrid, mask, { lon: changed.lon, lat: changed.lat });
      if (snapped) {
        target = { ...changed, lon: snapped.lon, lat: snapped.lat };
        if (snapped.movedM > 0) {
          const notice = `Moved ${Math.round(snapped.movedM)} m to walkable ground`;
          setStopNotices((prev) => ({ ...prev, [changed.id]: notice }));
        } else {
          setStopNotices((prev) => {
            if (!prev[changed.id]) return prev;
            const next = { ...prev };
            delete next[changed.id];
            return next;
          });
        }
      } else {
        setStopNotices((prev) => {
          if (!prev[changed.id]) return prev;
          const next = { ...prev };
          delete next[changed.id];
          return next;
        });
      }
    }
    setPlan((current) => ({
      ...current,
      stops: current.stops.map((stop) => (stop.id === target.id ? target : stop)),
    }));
  }, [routeGrid, plan.start]);

  const handleImportPlan = useCallback((imported: Plan) => {
    let resolvedStart = imported.start;
    const newNotices: Record<string, string> = {};
    let resolvedStops = imported.stops;

    if (routeGrid) {
      const startRc = routeGrid.lonlatToRowCol(resolvedStart.lon, resolvedStart.lat);
      if (!routeGrid.isInside(startRc.row, startRc.col) || !routeGrid.isPassable(startRc.row, startRc.col)) {
        const snappedStart = snapToPassable(routeGrid, resolvedStart);
        if (snappedStart) {
          resolvedStart = { ...resolvedStart, lon: snappedStart.lon, lat: snappedStart.lat };
        }
      }
      const mask = reachableMask(routeGrid, resolvedStart);
      resolvedStops = imported.stops.map((stop) => {
        const snap = snapToReachable(routeGrid, mask, { lon: stop.lon, lat: stop.lat });
        if (snap) {
          if (snap.movedM > 0) {
            newNotices[stop.id] = `Moved ${Math.round(snap.movedM)} m to walkable ground`;
          }
          return { ...stop, lon: snap.lon, lat: snap.lat };
        }
        return stop;
      });
    }

    setStopNotices(newNotices);
    setPlan({ ...imported, start: normalizeShelter(resolvedStart), stops: resolvedStops });
  }, [routeGrid]);

  const changePlan = useCallback((next: Plan) => {
    setStopNotices((prev) => {
      const currentIds = new Set(next.stops.map((s) => s.id));
      let changed = false;
      const filtered: Record<string, string> = {};
      for (const [id, msg] of Object.entries(prev)) {
        if (currentIds.has(id)) {
          filtered[id] = msg;
        } else {
          changed = true;
        }
      }
      return changed ? filtered : prev;
    });
    setPlan(next);
  }, []);

  const handleToggleLayer = (layerId: string) => {
    setLayerStates((prev) => {
      const current = prev[layerId];
      if (!current) return prev;
      return {
        ...prev,
        [layerId]: {
          ...current,
          enabled: !current.enabled,
        },
      };
    });
  };

  const handleOpacityChange = (layerId: string, opacity: number) => {
    setLayerStates((prev) => {
      const current = prev[layerId];
      if (!current) return prev;
      return {
        ...prev,
        [layerId]: {
          ...current,
          opacity,
        },
      };
    });
  };

  const toggleRoverOverlay = (layer: keyof RoverOverlayState) => {
    setRoverOverlayState((current) => ({ ...current, [layer]: !current[layer] }));
  };

  return (
    <div className="mock plan-mock" style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header className="mock-top" data-theme={mode === 'walk' && walkNight ? 'night' : undefined}>
        <span className="wordmark">Sol-48</span>

        <nav className="s48-seg s48-tabs" aria-label="Tabs">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" aria-pressed={mode === tab.id} aria-current={mode === tab.id ? 'page' : undefined} onClick={() => setMode(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="s48-site-identity">
          <SiteSwitcher
            availableSites={AVAILABLE_SITES}
            currentSite={currentSiteId}
            onSiteChange={handleSiteChange}
            siteTitle={siteData.title}
            roverName={siteData.rover}
          />
          {siteData.size_m && (
            <span className="s48-site-extent num" title="Site footprint">
              {Math.round(siteData.size_m.width / 1000)} × {Math.round(siteData.size_m.height / 1000)} km
            </span>
          )}
        </div>

        <span className="grow" />

        <div className="s48-seg s48-theme" role="group" aria-label="Theme">
          {THEMES.map((option) => (
            <button key={option.id} type="button" aria-pressed={override === option.id} onClick={() => setOverride(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <NoticeBanner
        isSampleFallback={isSampleFallback}
        siteId={currentSiteId}
        tilesBase={TILES_BASE}
      />

      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {mode === 'explore' ? (
          <TabBoundary key="explore">
            <Suspense fallback={<div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>Loading globe...</div>}>
              <GlobePage siteId={currentSiteId} theme={theme} />
            </Suspense>
          </TabBoundary>
        ) : isLoading ? (
          <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
            Loading site...
          </div>
        ) : mode === 'plan' ? (
          <Regions
            id="plan"
            left={
              <LayerPanel
                layers={siteData.layers}
                layerStates={layerStates}
                roverOverlayState={roverOverlayState}
                photosAvailable={photosAvailable}
                onToggleRoverOverlay={toggleRoverOverlay}
                onToggleLayer={handleToggleLayer}
                onOpacityChange={handleOpacityChange}
                globalLayers={wholePlanet.layers}
                globalStates={wholePlanet.states}
                onToggleGlobal={wholePlanet.toggle}
                onGlobalOpacityChange={wholePlanet.setOpacity}
                siteValues={wholePlanet.siteValues}
                caves={wholePlanet.caves.length ? { enabled: wholePlanet.cavesOn, count: wholePlanet.caves.length, credit: CAVE_CREDIT, atSite: wholePlanet.cavesAtSite, onToggle: () => wholePlanet.setCavesOn((on) => !on) } : undefined}
                panelId="plan"
                temperature={wholePlanet.temperatureManifest ? {
                  enabled: wholePlanet.temperature.enabled,
                  opacity: wholePlanet.temperature.opacity,
                  legend: legendRamp(wholePlanet.temperatureManifest.legend),
                  onToggle: () => wholePlanet.setTemperature((t) => ({ ...t, enabled: !t.enabled })),
                  onOpacityChange: (opacity) => wholePlanet.setTemperature((t) => ({ ...t, opacity })),
                  atSite: wholePlanet.temperatureAtSite,
                  row: (
                    <TemperatureRow
                      manifest={wholePlanet.temperatureManifest}
                      bin={wholePlanet.bin}
                      enabled={wholePlanet.temperature.enabled}
                      opacity={wholePlanet.temperature.opacity}
                      kind={wholePlanet.temperature.kind}
                      onToggle={() => wholePlanet.setTemperature((t) => ({ ...t, enabled: !t.enabled }))}
                      onOpacityChange={(opacity) => wholePlanet.setTemperature((t) => ({ ...t, opacity }))}
                      onKindChange={(kind) => wholePlanet.setTemperature((t) => ({ ...t, kind }))}
                    />
                  ),
                } : undefined}
              />
            }
            leftLabel="Layers"
            main={<GlobePlanMap siteData={siteData} layerStates={layerStates} roverOverlayState={roverOverlayState} plan={plan} grid={routeGrid} activePoint={profileHover} relief={relief} wholePlanet={wholePlanet} onMapPoint={handleMapPoint} placingShelter={shelterMove.active} onStartChange={updateStart} onStopChange={updateStop} onRoutePointHover={setProfileHover} />}
            controls={
              <button type="button" className="s48-btn s48-btn--secondary" aria-pressed={relief} onClick={() => setRelief((on) => !on)}>
                3D relief
              </button>
            }
            right={<PlanRail plan={plan} grid={routeGrid} computing={computing} onChange={changePlan} onImport={handleImportPlan} mover={mover} onMoverChange={setMover} activePoint={profileHover} onProfileHover={setProfileHover} stopNotices={stopNotices} shelterMove={shelterMove} onMoveShelter={toggleShelterMove} onCancelMoveShelter={cancelShelterMove} />}
            rightLabel="Plan"
          />
        ) : mode === 'walk' ? (
          <WalkView siteData={siteData} plan={plan} track={track} playback={playback} onPlan={() => setMode('plan')} onNightChange={setWalkNight} />
        ) : (
          <VisorView siteData={siteData} plan={plan} track={track} elapsedS={playback.elapsedS} onPlan={() => setMode('plan')} />
        )}
      </div>
    </div>
  );
};

export default App;
