// Written with AI assistance, directed and reviewed by the team.

import React, { useState } from 'react';
import { SiteLayer, LayerState, SiteKind } from '../types';
import '../shell/shell.css';
import type { RoverOverlayState } from '../types';
import {
  formatResolution,
  getLayerDisplayName,
  getLayerSourceAgency,
  formatLegendValue,
  cleanUnits,
} from '../shell/layerFormat';
import { GlobeLayer, groupGlobeLayers, legendSteps } from '../globe/layerManifest';

const LEGEND_STEPS = 16;

export interface CaveOverlay {
  enabled: boolean;
  count: number;
  credit: string;
  /** Distance to the nearest candidate, shown while the layer is on. */
  atSite?: string;
  onToggle: () => void;
}

interface LayerPanelProps {
  layers: SiteLayer[];
  layerStates: Record<string, LayerState>;
  roverOverlayState?: RoverOverlayState;
  photosAvailable?: boolean;
  onToggleRoverOverlay?: (layer: keyof RoverOverlayState) => void;
  globalLayers?: GlobeLayer[];
  globalStates?: Record<string, LayerState>;
  onToggleGlobal?: (layerId: string) => void;
  onGlobalOpacityChange?: (layerId: string, opacity: number) => void;
  caves?: CaveOverlay;
  /** Whole-planet temperature entry, shown as its own group after the manifest layers. */
  temperature?: { enabled: boolean; row: React.ReactNode; atSite?: string };
  /** Value of each shown whole-planet layer at the site, such as 312 µGy/day; keyed by layer id. */
  siteValues?: Record<string, string>;
  onToggleLayer: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  /** Outside the shared layout the panel hides itself; in a Regions panel it is always shown. */
  isOpen?: boolean;
  onTogglePanel?: () => void;
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
  photosAvailable = false,
  onToggleRoverOverlay,
  globalLayers = [],
  globalStates = {},
  onToggleGlobal,
  onGlobalOpacityChange,
  caves,
  temperature,
  siteValues = {},
  onToggleLayer,
  onOpacityChange,
  isOpen = true,
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
    + Object.values(globalStates).filter((s) => s.enabled).length
    + Number(!!caves?.enabled)
    + Number(!!temperature?.enabled)
    + Number(!!roverOverlayState?.traverse) + Number(photosAvailable && !!roverOverlayState?.photos);

  const globalGroups = groupGlobeLayers(globalLayers);
  const caveGroupShown = !!caves && !globalGroups.some((g) => g.group === 'caves');

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
          {onTogglePanel && (
            <button
              type="button"
              className="s48-btn s48-btn--quiet"
              onClick={onTogglePanel}
              aria-label="Close layer panel"
            >
              Hide
            </button>
          )}
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

                        <InfoButton
                          expanded={isExpanded}
                          label={displayName}
                          title={layer.source || displayName}
                          onClick={() => toggleInfo(layer.id)}
                        />
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
          {roverOverlayState && onToggleRoverOverlay && (
            <div>
              <h4>Rover</h4>
              {([
                ['traverse', 'Rover traverse'],
                ...(photosAvailable ? [['photos', 'Rover photos'] as const] : []),
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(globalGroups.length > 0 || caves || temperature) && (
        <div className="panel-sec" style={{ borderBottom: 0 }}>
          <h3>
            <span>Whole planet</span>
          </h3>
          <div className="s48-layers">
            {globalGroups.map(({ group, label, layers: groupLayers }) => (
              <div key={group}>
                <h4>{label}</h4>
                {groupLayers.map((layer) => {
                  const state = globalStates[layer.id] || { enabled: false, opacity: 1 };
                  const isExpanded = !!expandedInfo[`global:${layer.id}`];
                  return (
                    <div key={layer.id} className="s48-layer">
                      <div className="s48-layer__head">
                        <label>
                          <input
                            type="checkbox"
                            className="s48-check"
                            checked={state.enabled}
                            onChange={() => onToggleGlobal?.(layer.id)}
                          />
                          <span className="s48-layer__title" title={layer.title}>
                            {layer.title}
                          </span>
                        </label>
                        <InfoButton
                          expanded={isExpanded}
                          label={layer.title}
                          onClick={() => toggleInfo(`global:${layer.id}`)}
                        />
                      </div>

                      {isExpanded && (
                        <div className="s48-layer__desc">
                          <p>{layer.description}</p>
                          <div className="s48-layer__desc-meta">Source: {layer.source.citation}</div>
                          <div className="s48-layer__desc-meta">Licence: {layer.source.licence}</div>
                          {layer.source.licence_note && (
                            <div className="s48-layer__desc-meta">{layer.source.licence_note}</div>
                          )}
                        </div>
                      )}

                      {state.enabled && (
                        <div className="s48-layer__body">
                          {siteValues[layer.id] && (
                            <p className="s48-layer__at-site">
                              At this site: <b>{siteValues[layer.id]}</b>
                            </p>
                          )}
                          <div className="s48-opacity">
                            <span>Opacity</span>
                            <input
                              type="range"
                              className="s48-range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={state.opacity}
                              onChange={(e) => onGlobalOpacityChange?.(layer.id, parseFloat(e.target.value))}
                              aria-label={`${layer.title} opacity`}
                            />
                            <output>{Math.round(state.opacity * 100)} %</output>
                          </div>
                          <div className="s48-legend">
                            <div className="s48-legend__ramp s48-legend__ramp--steps" aria-hidden="true">
                              {legendSteps(layer.legend.stops, layer.legend.min, layer.legend.max, LEGEND_STEPS).map(
                                (colour, i) => (
                                  <i key={i} style={{ background: colour }} />
                                ),
                              )}
                            </div>
                            <div className="s48-legend__ends">
                              <span>
                                <b>{layer.legend.min_label}</b>
                              </span>
                              <span>
                                <b>{layer.legend.max_label}</b>
                                {layer.legend.units && (
                                  <span className="s48-legend__unit">{layer.legend.units}</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {group === 'caves' && caves && <CaveRow caves={caves} />}
              </div>
            ))}
            {temperature && (
              <div>
                <h4>Temperature</h4>
                {temperature.row}
                {temperature.enabled && temperature.atSite && (
                  <p className="s48-layer__at-site s48-layer__at-site--row">
                    At this site: <b>{temperature.atSite}</b>
                  </p>
                )}
              </div>
            )}
            {caveGroupShown && caves && (
              <div>
                <h4>Caves</h4>
                <CaveRow caves={caves} />
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

const InfoButton: React.FC<{ expanded: boolean; label: string; title?: string; onClick: () => void }> = ({
  expanded,
  label,
  title,
  onClick,
}) => (
  <button
    type="button"
    className={`s48-layer__info-btn ${expanded ? 'is-active' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-expanded={expanded}
    aria-label={`About ${label}`}
    title={title || label}
  >
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4M8 5h.01" />
    </svg>
  </button>
);

const CaveRow: React.FC<{ caves: CaveOverlay }> = ({ caves }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="s48-layer">
      <div className="s48-layer__head">
        <label>
          <input type="checkbox" className="s48-check" checked={caves.enabled} onChange={caves.onToggle} />
          <span className="s48-layer__title">Cave candidates</span>
        </label>
        <InfoButton expanded={expanded} label="Cave candidates" onClick={() => setExpanded(!expanded)} />
      </div>
      {expanded && (
        <div className="s48-layer__desc">
          <p>Possible cave entrances seen in orbital images. None has been explored.</p>
          <div className="s48-layer__desc-meta">Source: {caves.credit}</div>
        </div>
      )}
      {caves.enabled && (
        <div className="s48-layer__body">
          {caves.atSite && (
            <p className="s48-layer__at-site">
              At this site: <b>{caves.atSite}</b>
            </p>
          )}
          <div className="s48-legend s48-legend--points">
            <span className="s48-cave-dot" />
            <span>
              <span className="num">{caves.count}</span> points
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
