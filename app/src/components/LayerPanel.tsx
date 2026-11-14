// Written with AI assistance, directed and reviewed by the team.

import React, { useState } from 'react';
import { SiteLayer, LayerState, SiteKind } from '../types';
import '../shell/shell.css';
import type { RoverOverlayState } from './roverOverlays';
import {
  formatResolution,
  getLayerDisplayName,
  getLayerSourceAgency,
  formatLegendValue,
  cleanUnits,
} from '../shell/layerFormat';

interface LayerPanelProps {
  layers: SiteLayer[];
  layerStates: Record<string, LayerState>;
  roverOverlayState: RoverOverlayState;
  onToggleRoverOverlay: (layer: keyof RoverOverlayState) => void;
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

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  layerStates,
  roverOverlayState,
  onToggleRoverOverlay,
  onToggleLayer,
  onOpacityChange,
  isOpen,
  onTogglePanel,
}) => {
  const [expandedInfo, setExpandedInfo] = useState<Record<string, boolean>>({});

  const toggleInfo = (layerId: string) => {
    setExpandedInfo((prev) => ({
      ...prev,
      [layerId]: !prev[layerId],
    }));
  };

  const groupedLayers = layers.reduce<Record<string, SiteLayer[]>>((acc, layer) => {
    const kind = layer.kind || 'optical';
    if (!acc[kind]) {
      acc[kind] = [];
    }
    acc[kind].push(layer);
    return acc;
  }, {});

  const activeCount = Object.values(layerStates).filter((s) => s.enabled).length
    + Number(roverOverlayState.traverse) + Number(roverOverlayState.photos);

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
          <span>
            Layers <small>{activeCount} on</small>
          </span>
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
                  const displayName = getLayerDisplayName(layer);
                  const resText =
                    layer.type === 'points' ? 'Points' : formatResolution(layer.resolution_m);
                  const sourceAgency = getLayerSourceAgency(layer);
                  const isExpanded = !!expandedInfo[layer.id];

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
                          <span className="s48-layer__title" title={displayName}>
                            {displayName}
                          </span>
                        </label>

                        <button
                          type="button"
                          className={`s48-layer__info-btn ${isExpanded ? 'is-active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleInfo(layer.id);
                          }}
                          aria-expanded={isExpanded}
                          aria-label={`About ${displayName}`}
                          title={layer.source || displayName}
                        >
                          <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
                            <circle cx="8" cy="8" r="6.5" />
                            <path d="M8 7v4M8 5h.01" />
                          </svg>
                        </button>
                      </div>

                      {isExpanded && layer.source && (
                        <div className="s48-layer__desc">
                          <p>{layer.source}</p>
                          {layer.agency && (
                            <div className="s48-layer__desc-meta">Agency: {layer.agency}</div>
                          )}
                        </div>
                      )}

                      <div className="s48-layer__note">
                        <span className={isCoarse ? 's48-res s48-res--coarse' : 's48-res'}>
                          {resText}
                        </span>{' '}
                        · {sourceAgency}
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
                              aria-label={`${displayName} opacity`}
                            />
                            <output>{Math.round(state.opacity * 100)} %</output>
                          </div>

                          {layer.legend &&
                            layer.legend.stops &&
                            layer.legend.stops.length > 0 && (
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
                                    <b>{formatLegendValue(layer.legend.stops[0][0])}</b>
                                    {cleanUnits(layer.units) && (
                                      <span className="s48-legend__unit">
                                        {cleanUnits(layer.units)}
                                      </span>
                                    )}
                                  </span>
                                  <span>
                                    <b>
                                      {formatLegendValue(
                                        layer.legend.stops[layer.legend.stops.length - 1][0]
                                      )}
                                    </b>
                                  </span>
                                </div>
                              </div>
                            )}

                          {layer.type === 'points' && (
                            <div className="s48-legend s48-legend--points">
                              <span className="pt" />
                              <span>
                                {displayName} ({cleanUnits(layer.units) || 'target point'})
                              </span>
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
          <div>
            <h4>Rover</h4>
            {([
              ['traverse', 'Rover traverse'],
              ['photos', 'Rover photos'],
            ] as const).map(([key, title]) => (
              <div key={key} className="s48-layer rover-overlay-layer">
                <div className="s48-layer__head">
                  <label>
                    <input
                      type="checkbox"
                      className="s48-check"
                      checked={roverOverlayState[key]}
                      onChange={() => onToggleRoverOverlay(key)}
                    />
                    <span className="s48-layer__title">{title}</span>
                  </label>
                </div>
                {roverOverlayState[key] && (
                  <div className="s48-legend rover-overlay-layer__legend">
                    <span className={`rover-overlay-swatch rover-overlay-swatch--${key}`} aria-hidden="true" />
                    <span>{key === 'traverse' ? 'Rover path' : 'Photo site · size by count'}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
