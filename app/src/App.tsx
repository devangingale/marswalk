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
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(true);

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

      const initialStates: Record<string, LayerState> = {};
      data.layers.forEach((layer) => {
        initialStates[layer.id] = {
          enabled: layer.default_on ?? false,
          opacity: 1.0,
        };
      });
      setLayerStates(initialStates);
    } catch {
      const fallbackData = {
        ...(stubSiteSample as unknown as SiteData),
        id: siteId,
        title: siteId === 'jezero' ? 'Jezero Crater Delta (Stub Specification)' : stubSiteSample.title,
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
    <div className="s48-app">
      <NoticeBanner
        isSampleFallback={isSampleFallback}
        siteId={currentSiteId}
        tilesBase={TILES_BASE}
      />

      <header className="s48-header">
        <div className="s48-brand-site-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="s48-app-title">Sol-48 Marswalk</span>
          <SiteSwitcher
            availableSites={AVAILABLE_SITES}
            currentSite={currentSiteId}
            onSiteChange={handleSiteChange}
            siteTitle={siteData.title}
          />
        </div>

        <div className="s48-header-controls" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ModeSwitch currentMode={mode} onModeChange={setMode} />
          {mode === 'plan' && (
            <button
              type="button"
              className="s48-layer-toggle-btn"
              onClick={() => setIsPanelOpen(!isPanelOpen)}
            >
              {isPanelOpen ? 'Hide Layers' : 'Show Layers'}
            </button>
          )}
        </div>
      </header>

      <main className="s48-main">
        {isLoading ? (
          <div className="s48-loading-indicator">Loading site...</div>
        ) : mode === 'plan' ? (
          <>
            <LayerPanel
              layers={siteData.layers}
              layerStates={layerStates}
              onToggleLayer={handleToggleLayer}
              onOpacityChange={handleOpacityChange}
              isOpen={isPanelOpen}
              onTogglePanel={() => setIsPanelOpen(!isPanelOpen)}
            />
            <Map siteData={siteData} layerStates={layerStates} />
          </>
        ) : mode === 'walk' ? (
          <WalkPlaceholder onReturnToPlan={() => setMode('plan')} />
        ) : (
          <VisorPlaceholder onReturnToPlan={() => setMode('plan')} />
        )}
      </main>
    </div>
  );
};

export default App;
