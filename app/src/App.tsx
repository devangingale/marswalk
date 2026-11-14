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
    <div className="mock plan-mock" style={{ width: '100vw', height: '100vh' }}>
      <header className="mock-top">
        <span className="wordmark">Sol-48</span>

        <ModeSwitch currentMode={mode} onModeChange={setMode} />

        <SiteSwitcher
          availableSites={AVAILABLE_SITES}
          currentSite={currentSiteId}
          onSiteChange={handleSiteChange}
          siteTitle={siteData.title}
          roverName={siteData.rover}
        />

        <span className="grow" />

        {mode === 'plan' && (
          <button
            type="button"
            className="s48-btn s48-btn--secondary"
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            aria-label="Toggle layer panel"
          >
            <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 2l6 3.2-6 3.2-6-3.2z" />
              <path d="M2 8.4l6 3.2 6-3.2" />
              <path d="M2 11.4l6 3.2 6-3.2" />
            </svg>
            <span>{isPanelOpen ? 'Hide layers' : 'Layers'}</span>
          </button>
        )}

        <span className="meta">
          {siteData.size_m ? `${Math.round(siteData.size_m.width / 1000)} × ${Math.round(siteData.size_m.height / 1000)} km` : ''}
        </span>
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
          <div className="plan-body">
            <LayerPanel
              layers={siteData.layers}
              layerStates={layerStates}
              onToggleLayer={handleToggleLayer}
              onOpacityChange={handleOpacityChange}
              isOpen={isPanelOpen}
              onTogglePanel={() => setIsPanelOpen(!isPanelOpen)}
            />
            <Map siteData={siteData} layerStates={layerStates} />
          </div>
        ) : mode === 'walk' ? (
          <WalkPlaceholder onReturnToPlan={() => setMode('plan')} />
        ) : (
          <VisorPlaceholder onReturnToPlan={() => setMode('plan')} />
        )}
      </div>
    </div>
  );
};

export default App;
