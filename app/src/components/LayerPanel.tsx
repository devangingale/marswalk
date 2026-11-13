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

  return (
    <aside
      className={`s48-layer-panel ${isOpen ? 's48-layer-panel-open' : 's48-layer-panel-closed'}`}
      style={{ display: isOpen ? 'block' : 'none' }}
    >
      <div className="s48-layer-panel-header">
        <h2>Layers</h2>
        <button
          type="button"
          className="s48-layer-panel-toggle-btn"
          onClick={onTogglePanel}
          aria-label="Toggle layer panel"
        >
          Hide
        </button>
      </div>

      <div className="s48-layer-panel-body">
        {Object.entries(groupedLayers).map(([kind, kindLayers]) => {
          const kindKey = kind as SiteKind;
          const kindTitle = KIND_LABELS[kindKey] || kind;

          return (
            <section key={kind} className="s48-layer-group">
              <h3 className="s48-layer-group-title">{kindTitle}</h3>
              <ul className="s48-layer-list">
                {kindLayers.map((layer) => {
                  const state = layerStates[layer.id] || {
                    enabled: layer.default_on,
                    opacity: 1.0,
                  };

                  return (
                    <li key={layer.id} className="s48-layer-item">
                      <div className="s48-layer-row">
                        <label className="s48-layer-label">
                          <input
                            type="checkbox"
                            className="s48-layer-checkbox"
                            checked={state.enabled}
                            onChange={() => onToggleLayer(layer.id)}
                          />
                          <span className="s48-layer-title">{layer.title}</span>
                        </label>
                        <span className="s48-layer-resolution">
                          · {formatResolution(layer.resolution_m)}
                        </span>
                        <span className="s48-layer-type-badge">
                          ({layer.type === 'raster' ? 'PMTiles' : 'GeoJSON'})
                        </span>
                      </div>

                      {state.enabled && (
                        <div className="s48-layer-details">
                          <div className="s48-layer-opacity">
                            <label htmlFor={`s48-opacity-${layer.id}`}>
                              Opacity: {Math.round(state.opacity * 100)}%
                            </label>
                            <input
                              id={`s48-opacity-${layer.id}`}
                              type="range"
                              className="s48-layer-slider"
                              min="0"
                              max="1"
                              step="0.05"
                              value={state.opacity}
                              onChange={(e) =>
                                onOpacityChange(layer.id, parseFloat(e.target.value))
                              }
                            />
                          </div>

                          {layer.legend && layer.legend.stops && layer.legend.stops.length > 0 && (
                            <div className="s48-layer-legend">
                              <span className="s48-layer-legend-title">
                                Legend {layer.units ? `(${layer.units})` : ''}:
                              </span>
                              <div className="s48-layer-legend-stops">
                                {layer.legend.stops.map(([val, color], idx) => (
                                  <span
                                    key={idx}
                                    className="s48-layer-legend-chip"
                                    style={{
                                      display: 'inline-block',
                                      width: '16px',
                                      height: '10px',
                                      backgroundColor: color,
                                      marginRight: '2px',
                                      verticalAlign: 'middle',
                                    }}
                                    title={`${val} ${layer.units || ''}`}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="s48-layer-source">
                            {layer.source} · {layer.agency}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
};
