// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { SiteLayer, LayerState, SiteKind } from '../types';

interface LayerPanelProps {
  layers: SiteLayer[];
  layerStates: Record<string, LayerState>;
  onToggleLayer: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  isOpen: boolean;
  onTogglePanel: () => void;
}

const KIND_LABELS: Record<SiteKind, string> = {
  optical: 'Optical',
  topographic: 'Topographic',
  thermal: 'Thermal',
  spectral: 'Spectral',
  chemical: 'Chemical',
  radiation: 'Radiation',
  atmospheric: 'Atmospheric',
  geologic: 'Geologic',
};

function formatResolution(resM: number): string {
  if (resM < 1) {
    return `${resM} m`;
  }
  if (resM >= 1000) {
    return `${resM / 1000} km`;
  }
  return `${resM} m`;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  layerStates,
  onToggleLayer,
  onOpacityChange,
  isOpen,
  onTogglePanel,
}) => {
  const groupedLayers = layers.reduce<Record<string, SiteLayer[]>>((acc, layer) => {
    const kind = layer.kind || 'optical';
    if (!acc[kind]) {
      acc[kind] = [];
    }
    acc[kind].push(layer);
    return acc;
  }, {});

  const activeCount = Object.values(layerStates).filter((s) => s.enabled).length;

  return (
    <aside
      className="panel"
      style={{
        display: isOpen ? 'block' : 'none',
        overflowY: 'auto',
      }}
    >
      <div className="panel-sec" style={{ borderBottom: 0 }}>
        <h3>
          <span>Layers <small>{activeCount} on</small></span>
          <button
            type="button"
            className="s48-btn s48-btn--quiet"
            onClick={onTogglePanel}
            aria-label="Close layer panel"
          >
            Hide
          </button>
        </h3>

        <div className="s48-layers">
          {Object.entries(groupedLayers).map(([kind, kindLayers]) => {
            const kindKey = kind as SiteKind;
            const kindTitle = KIND_LABELS[kindKey] || kind;

            return (
              <div key={kind}>
                <h4>{kindTitle}</h4>
                {kindLayers.map((layer) => {
                  const state = layerStates[layer.id] || {
                    enabled: layer.default_on,
                    opacity: 1.0,
                  };

                  const isCoarse = layer.resolution_m >= 5;

                  return (
                    <div key={layer.id} className="s48-layer">
                      <div className="s48-layer__head">
                        <label>
                          <input
                            type="checkbox"
                            className="s48-check"
                            checked={state.enabled}
                            onChange={() => onToggleLayer(layer.id)}
                          />
                          <span>{layer.title}</span>
                        </label>
                        {isCoarse && (
                          <span className="s48-chip">
                            <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
                              <rect x="2" y="2" width="12" height="12" />
                              <path d="M6 2v12M10 2v12M2 6h12M2 10h12" />
                            </svg>
                            Coarse · {formatResolution(layer.resolution_m)}
                          </span>
                        )}
                      </div>

                      <div className="s48-layer__note">
                        {layer.type === 'points' ? 'Points' : formatResolution(layer.resolution_m)} · {layer.source} · {layer.agency}
                      </div>

                      {state.enabled && (
                        <div className="s48-layer__body">
                          <div className="s48-opacity">
                            <span>Opacity</span>
                            <input
                              type="range"
                              className="s48-range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={state.opacity}
                              onChange={(e) =>
                                onOpacityChange(layer.id, parseFloat(e.target.value))
                              }
                            />
                            <output>{Math.round(state.opacity * 100)} %</output>
                          </div>

                          {layer.legend && layer.legend.stops && layer.legend.stops.length > 0 && (
                            <div className="s48-legend">
                              <div
                                className="s48-legend__ramp"
                                style={{
                                  background: `linear-gradient(to right, ${layer.legend.stops
                                    .map(([, color]) => color)
                                    .join(', ')})`,
                                }}
                              />
                              <div className="s48-legend__ends">
                                <span>
                                  <b>{layer.legend.stops[0][0]}</b> {layer.units || ''}
                                </span>
                                <span>
                                  <b>{layer.legend.stops[layer.legend.stops.length - 1][0]}</b>
                                </span>
                              </div>
                            </div>
                          )}

                          {layer.type === 'points' && (
                            <div className="s48-legend s48-legend--points">
                              <span className="pt" />
                              <span>{layer.title} ({layer.units || 'target point'})</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
