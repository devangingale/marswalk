// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { SiteData, LayerState, AppMode } from './types';
import {
  TILES_BASE,
  AVAILABLE_SITES,
  DEFAULT_SITE,
  getSiteJsonUrl,
  resolveSiteAssetUrl,
} from './config';
import stubSiteSample from './fixtures/site.sample.json';
import samplePlan from './fixtures/plan.sample.json';
import { Plan } from './lib/plan';
import { buildTrack } from './walk/track';
import { usePlayback } from './walk/usePlayback';
import { NoticeBanner } from './components/NoticeBanner';
import { ModeSwitch } from './components/ModeSwitch';
import { SiteSwitcher } from './components/SiteSwitcher';
import { LayerPanel } from './components/LayerPanel';
import { Map } from './components/Map';
import type { RoverOverlayState } from './components/roverOverlays';
import { WalkView } from './components/WalkView';
import { VisorView } from './components/VisorView';
import { PlanRail } from './plan/PlanRail';
import { findWalkableCentre, makeInitialPlan, nextStopName } from './plan/planLogic';
import { loadGrid, type RouteGrid } from './lib/grid';
import type { PlanStop } from './lib/plan';
import { DEFAULT_SURFACE_DOSE_MGY_PER_DAY, DEFAULT_SOLAR_EVENT_MGY_PER_DAY } from './lib/energy';
import './plan/plan.css';
import './styles/visualReview.css';

export const App: React.FC = () => {
  const [currentSiteId, setCurrentSiteId] = useState<string>(DEFAULT_SITE);
  const [siteData, setSiteData] = useState<SiteData>(stubSiteSample as unknown as SiteData);
  const [isSampleFallback, setIsSampleFallback] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [mode, setMode] = useState<AppMode>('plan');
  const [layerStates, setLayerStates] = useState<Record<string, LayerState>>({});
  const [roverOverlayState, setRoverOverlayState] = useState<RoverOverlayState>({ traverse: true, photos: true });
  const [photosAvailable, setPhotosAvailable] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(() => window.innerWidth >= 1200);
  // The plan Walk and Visor replay (contracts section 7). The Plan view sets it; until then, the sample plan.
  const [plan, setPlan] = useState<Plan>(samplePlan as unknown as Plan);
  const [routeGrid, setRouteGrid] = useState<RouteGrid | null>(null);
  const [routeGridSite, setRouteGridSite] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [doseRates, setDoseRates] = useState({ surface: DEFAULT_SURFACE_DOSE_MGY_PER_DAY, solar: DEFAULT_SOLAR_EVENT_MGY_PER_DAY });
  const planWorker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const userBuiltPlan = useRef(false);
  const initializedPlanSite = useRef<string | null>(null);
  const siteLoadId = useRef(0);
  const track = useMemo(() => buildTrack(plan, siteData.origin), [plan, siteData.origin]);
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
      const initial = currentSiteId === 'gale' && !userBuiltPlan.current ? samplePlan as unknown as Plan : makeInitialPlan(currentSiteId, start);
      setPlan({ ...initial, site: currentSiteId, start });
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
    setComputing(true);
    worker.onmessage = (event: MessageEvent<{ id: number; plan?: Plan; error?: string }>) => {
      if (event.data.id !== requestId.current) return;
      setComputing(false);
      if (event.data.plan) setPlan(event.data.plan);
    };
    worker.postMessage({ id, header: routeGrid.header, origin: routeGrid.origin, elev: routeGrid.elevData.slice(), cost: routeGrid.costData.slice(), site: plan.site, params: plan.params, start: plan.start, stops: plan.stops, dose: doseRates.surface, solarDose: doseRates.solar });
    return () => worker.terminate();
  }, [routeInputKey, routeGrid, routeGridSite, currentSiteId, doseRates]);

  const handleSiteChange = (newSiteId: string) => {
    if (newSiteId !== currentSiteId) {
      setCurrentSiteId(newSiteId);
    }
  };

  const addStop = useCallback((point: { lon: number; lat: number }) => {
    userBuiltPlan.current = true;
    setPlan((current) => {
      const stop: PlanStop = { id: `s-${Date.now()}`, name: nextStopName(current.stops), ...point, dwell_s: current.params.stop_time_s };
      return { ...current, stops: [...current.stops, stop] };
    });
  }, []);
  const updateStart = useCallback((start: Plan['start']) => { userBuiltPlan.current = true; setPlan((current) => ({ ...current, start })); }, []);
  const updateStop = useCallback((changed: PlanStop) => { userBuiltPlan.current = true; setPlan((current) => ({ ...current, stops: current.stops.map((stop) => stop.id === changed.id ? changed : stop) })); }, []);
  const changePlan = useCallback((next: Plan) => { userBuiltPlan.current = true; setPlan(next); }, []);

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
      <header className="mock-top">
        <span className="wordmark">Sol-48</span>

        <ModeSwitch currentMode={mode} onModeChange={setMode} />

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

        {mode === 'plan' && !isPanelOpen && (
          <button
            type="button"
            className="s48-btn s48-btn--secondary"
            onClick={() => setIsPanelOpen(true)}
            aria-label="Open layer panel"
          >
            <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 2l6 3.2-6 3.2-6-3.2z" />
              <path d="M2 8.4l6 3.2 6-3.2" />
              <path d="M2 11.4l6 3.2 6-3.2" />
            </svg>
            <span>Layers</span>
          </button>
        )}
      </header>

      <NoticeBanner
        isSampleFallback={isSampleFallback}
        siteId={currentSiteId}
        tilesBase={TILES_BASE}
      />

      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
            Loading site...
          </div>
        ) : mode === 'plan' ? (
          <div className={`plan-body${isPanelOpen ? '' : ' plan-body--layers-closed'}`}>
            <LayerPanel
              layers={siteData.layers}
              layerStates={layerStates}
              roverOverlayState={roverOverlayState}
              photosAvailable={photosAvailable}
              onToggleRoverOverlay={toggleRoverOverlay}
              onToggleLayer={handleToggleLayer}
              onOpacityChange={handleOpacityChange}
              isOpen={isPanelOpen}
              onTogglePanel={() => setIsPanelOpen(!isPanelOpen)}
            />
            <Map siteData={siteData} layerStates={layerStates} roverOverlayState={roverOverlayState} plan={plan} onMapPoint={addStop} onStartChange={updateStart} onStopChange={updateStop} />
            <PlanRail plan={plan} grid={routeGrid} computing={computing} onChange={changePlan} onImport={(imported) => { userBuiltPlan.current = true; setPlan(imported); }} />
          </div>
        ) : mode === 'walk' ? (
          <WalkView siteData={siteData} plan={plan} track={track} playback={playback} onPlan={() => setMode('plan')} />
        ) : (
          <VisorView siteData={siteData} plan={plan} track={track} elapsedS={playback.elapsedS} onPlan={() => setMode('plan')} />
        )}
      </div>
    </div>
  );
};

export default App;
