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
  optical: 'Optical Imagery',
  topographic: 'Topography & Relief',
  thermal: 'Thermal Inertia',
  spectral: 'Mineralogy & Spectral',
  chemical: 'Chemical Composition',
  radiation: 'Radiation Environment',
  atmospheric: 'Atmosphere & Dust',
  geologic: 'Geology & Geomorphology',
};

function formatResolution(resM: number): string {
  if (resM < 1) {
    const cm = Math.round(resM * 100);
    return `${cm} cm (${resM} m)`;
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
  // Group layers by kind
  const groupedLayers = layers.reduce<Record<string, SiteLayer[]>>((acc, layer) => {
    const kind = layer.kind || 'optical';
    if (!acc[kind]) {
      acc[kind] = [];
    }
    acc[kind].push(layer);
    return acc;
  }, {});

  return (
    <>
      {/* Mobile/Tablet open toggle button when panel is closed */}
      {!isOpen && (
        <button
          onClick={onTogglePanel}
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            zIndex: 30,
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          aria-label="Open Layer Panel"
        >
          <span>☰</span>
          <span>Layers</span>
        </button>
      )}

      {/* Layer Panel Sidebar / Drawer */}
      <aside
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: '320px',
          maxWidth: '85vw',
          backgroundColor: '#0f172a',
          borderRight: '1px solid #1e293b',
          zIndex: 35,
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: isOpen ? '4px 0 16px rgba(0,0,0,0.4)' : 'none',
        }}
      >
        {/* Panel Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#1e293b',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: '#f8fafc',
                margin: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Mission Layers
            </h2>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Stacked datasets by kind &amp; true resolution
            </span>
          </div>
          <button
            onClick={onTogglePanel}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
            }}
            aria-label="Close Layer Panel"
          >
            ✕
          </button>
        </div>

        {/* Panel Content (Scrollable) */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {Object.entries(groupedLayers).map(([kind, kindLayers]) => {
            const kindKey = kind as SiteKind;
            const kindTitle = KIND_LABELS[kindKey] || kind.toUpperCase();

            return (
              <section
                key={kind}
                style={{
                  backgroundColor: '#131e33',
                  border: '1px solid #1e293b',
                  borderRadius: '6px',
                  padding: '10px',
                }}
              >
                <header
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#38bdf8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '8px',
                    paddingBottom: '4px',
                    borderBottom: '1px solid #1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{kindTitle}</span>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>
                    {kindLayers.length} {kindLayers.length === 1 ? 'layer' : 'layers'}
                  </span>
                </header>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {kindLayers.map((layer) => {
                    const state = layerStates[layer.id] || {
                      enabled: layer.default_on,
                      opacity: 1.0,
                    };

                    return (
                      <div
                        key={layer.id}
                        style={{
                          backgroundColor: state.enabled ? '#1e293b' : 'rgba(30, 41, 59, 0.4)',
                          borderRadius: '4px',
                          padding: '8px 10px',
                          border: state.enabled
                            ? '1px solid #334155'
                            : '1px solid transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* Layer Title and Resolution */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              cursor: 'pointer',
                              flex: 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={state.enabled}
                              onChange={() => onToggleLayer(layer.id)}
                              style={{
                                cursor: 'pointer',
                                accentColor: '#2563eb',
                                width: '15px',
                                height: '15px',
                              }}
                            />
                            <div>
                              <div
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: state.enabled ? '#f8fafc' : '#94a3b8',
                                }}
                              >
                                {layer.title}
                              </div>
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: '#38bdf8',
                                  fontFamily: 'monospace, sans-serif',
                                }}
                              >
                                {layer.kind} · {formatResolution(layer.resolution_m)}
                              </div>
                            </div>
                          </label>

                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 5px',
                              borderRadius: '3px',
                              backgroundColor:
                                layer.type === 'raster' ? '#1e3a8a' : '#065f46',
                              color: layer.type === 'raster' ? '#93c5fd' : '#a7f3d0',
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            {layer.type === 'raster' ? 'PMTiles' : 'GeoJSON'}
                          </span>
                        </div>

                        {/* Controls when layer is enabled */}
                        {state.enabled && (
                          <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #334155' }}>
                            {/* Opacity Slider */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                marginBottom: '6px',
                              }}
                            >
                              <span style={{ fontSize: '11px', color: '#94a3b8', minWidth: '45px' }}>
                                Opacity:
                              </span>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={state.opacity}
                                onChange={(e) =>
                                  onOpacityChange(layer.id, parseFloat(e.target.value))
                                }
                                style={{
                                  flex: 1,
                                  height: '4px',
                                  cursor: 'pointer',
                                  accentColor: '#38bdf8',
                                }}
                              />
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: '#cbd5e1',
                                  fontFamily: 'monospace',
                                  minWidth: '32px',
                                  textAlign: 'right',
                                }}
                              >
                                {Math.round(state.opacity * 100)}%
                              </span>
                            </div>

                            {/* Legend Stops */}
                            {layer.legend && layer.legend.stops && layer.legend.stops.length > 0 && (
                              <div style={{ marginTop: '6px' }}>
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '10px',
                                    color: '#94a3b8',
                                    marginBottom: '3px',
                                  }}
                                >
                                  <span>Legend {layer.units ? `(${layer.units})` : ''}:</span>
                                  <span>
                                    {layer.legend.stops[0][0]} →{' '}
                                    {layer.legend.stops[layer.legend.stops.length - 1][0]}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    display: 'flex',
                                    height: '8px',
                                    borderRadius: '2px',
                                    overflow: 'hidden',
                                    border: '1px solid #475569',
                                  }}
                                >
                                  {layer.legend.stops.map(([val, color], idx) => (
                                    <div
                                      key={idx}
                                      style={{
                                        flex: 1,
                                        backgroundColor: color,
                                      }}
                                      title={`${val} ${layer.units || ''}`}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Source and Agency */}
                            <div
                              style={{
                                fontSize: '10px',
                                color: '#64748b',
                                marginTop: '4px',
                                lineHeight: 1.3,
                              }}
                            >
                              {layer.source} · {layer.agency}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </aside>
    </>
  );
};
