// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useState, useCallback } from 'react';
import { SiteData, LayerState, AppMode } from './types';
import {
  TILES_BASE,
  AVAILABLE_SITES,
  DEFAULT_SITE,
  getSiteJsonUrl,
} from './config';
import stubSiteSample from './fixtures/site.sample.json';
import { NoticeBanner } from './components/NoticeBanner';
import { ModeSwitch } from './components/ModeSwitch';
import { SiteSwitcher } from './components/SiteSwitcher';
import { LayerPanel } from './components/LayerPanel';
import { Map } from './components/Map';
import { WalkPlaceholder } from './components/WalkPlaceholder';
import { VisorPlaceholder } from './components/VisorPlaceholder';

export const App: React.FC = () => {
  const [currentSiteId, setCurrentSiteId] = useState<string>(DEFAULT_SITE);
  const [siteData, setSiteData] = useState<SiteData>(stubSiteSample as unknown as SiteData);
  const [isSampleFallback, setIsSampleFallback] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [mode, setMode] = useState<AppMode>('plan');
  const [layerStates, setLayerStates] = useState<Record<string, LayerState>>({});
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(window.innerWidth >= 1024);

  // Load site.json or fall back to stub
  const loadSite = useCallback(async (siteId: string) => {
    setIsLoading(true);
    const targetUrl = getSiteJsonUrl(siteId);

    try {
      const resp = await fetch(targetUrl);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} fetching ${targetUrl}`);
      }
      const data: SiteData = await resp.json();
      setSiteData(data);
      setIsSampleFallback(false);

      // Initialize layer states
      const initialStates: Record<string, LayerState> = {};
      data.layers.forEach((layer) => {
        initialStates[layer.id] = {
          enabled: layer.default_on ?? false,
          opacity: 1.0,
        };
      });
      setLayerStates(initialStates);
    } catch {
      // Fallback to contract-shaped stub fixture
      const fallbackData = {
        ...(stubSiteSample as unknown as SiteData),
        id: siteId,
        title: siteId === 'jezero' ? 'Jezero Crater Delta (Sample Stub)' : stubSiteSample.title,
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
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSite(currentSiteId);
  }, [currentSiteId, loadSite]);

  const handleSiteChange = (newSiteId: string) => {
    if (newSiteId !== currentSiteId) {
      setCurrentSiteId(newSiteId);
    }
  };

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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#090d16',
        color: '#f8fafc',
      }}
    >
      {/* 7. Visible "sample data missing" notice when falling back to stub */}
      <NoticeBanner
        isSampleFallback={isSampleFallback}
        siteId={currentSiteId}
        tilesBase={TILES_BASE}
      />

      {/* Top Application Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #1e293b',
          zIndex: 40,
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Brand & Mission Title (No NASA insignia per constraints) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 800,
              fontSize: '15px',
              letterSpacing: '0.04em',
              color: '#f8fafc',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: '#e06c53', // Mars Oxide
                boxShadow: '0 0 8px #e06c53',
              }}
            />
            <span>SOL-48</span>
            <span style={{ color: '#64748b', fontWeight: 400, fontSize: '13px' }}>| MARSWALK</span>
          </div>

          <div style={{ height: '18px', width: '1px', backgroundColor: '#334155' }} />

          {/* 2. Site Switcher (Gale / Jezero) */}
          <SiteSwitcher
            availableSites={AVAILABLE_SITES}
            currentSite={currentSiteId}
            onSiteChange={handleSiteChange}
            siteTitle={siteData.title}
            roverName={siteData.rover}
          />
        </div>

        {/* 3. Top-Level Mode Switch: Plan / Walk / Visor */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ModeSwitch currentMode={mode} onModeChange={setMode} />

          {/* Layer Panel Toggle for mobile/tablet */}
          {mode === 'plan' && (
            <button
              onClick={() => setIsPanelOpen(!isPanelOpen)}
              style={{
                backgroundColor: isPanelOpen ? '#1e293b' : '#0f172a',
                color: isPanelOpen ? '#38bdf8' : '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isPanelOpen ? 'Hide Layers' : 'Show Layers'}
            </button>
          )}
        </div>
      </header>

      {/* Main Viewport Content */}
      <main style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          >
            LOADING MISSION DATA [{currentSiteId.toUpperCase()}]...
          </div>
        ) : mode === 'plan' ? (
          <>
            {/* 4. Layer Panel grouped by kind */}
            <LayerPanel
              layers={siteData.layers}
              layerStates={layerStates}
              onToggleLayer={handleToggleLayer}
              onOpacityChange={handleOpacityChange}
              isOpen={isPanelOpen}
              onTogglePanel={() => setIsPanelOpen(!isPanelOpen)}
            />

            {/* Interactive Map with PMTiles, Terrain, and Custom Mars Scale Bar */}
            <Map siteData={siteData} layerStates={layerStates} />
          </>
        ) : mode === 'walk' ? (
          <WalkPlaceholder
            siteData={siteData}
            onReturnToPlan={() => setMode('plan')}
          />
        ) : (
          <VisorPlaceholder
            siteData={siteData}
            onReturnToPlan={() => setMode('plan')}
          />
        )}
      </main>
    </div>
  );
};

export default App;
