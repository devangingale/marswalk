// Written with AI assistance, directed and reviewed by the team.
// Layer panel entry for the whole-planet surface temperature: kind switch, opacity, legend, source.

import React, { useState } from 'react';
import {
  KIND_LABELS,
  TEMPERATURE_KINDS,
  TemperatureKind,
  TemperatureManifest,
  binLabel,
  formatCoverage,
  formatLocalHours,
  legendRamp,
  legendTicks,
} from './temperatureManifest';
import './temperature.css';

export interface TemperatureRowProps {
  manifest: TemperatureManifest;
  bin: number;
  enabled: boolean;
  opacity: number;
  kind: TemperatureKind;
  onToggle: () => void;
  onOpacityChange: (opacity: number) => void;
  onKindChange: (kind: TemperatureKind) => void;
}

const TITLE = 'Surface temperature';

function unitLabel(units: string): string {
  return units === 'deg C' ? '°C' : units;
}

export const TemperatureRow: React.FC<TemperatureRowProps> = ({
  manifest,
  bin,
  enabled,
  opacity,
  kind,
  onToggle,
  onOpacityChange,
  onKindChange,
}) => {
  const [expanded, setExpanded] = useState(false);
  const season = manifest.season_bins[bin];
  const variant = season?.[kind];
  const ticks = legendTicks(manifest.legend);
  const units = unitLabel(manifest.legend.units);

  return (
    <div className="s48-layer s48-temp">
      <div className="s48-layer__head">
        <label>
          <input type="checkbox" className="s48-check" checked={enabled} onChange={onToggle} />
          <span className="s48-layer__title">{TITLE}</span>
        </label>
        <button
          type="button"
          className={`s48-layer__info-btn ${expanded ? 'is-active' : ''}`}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`About ${TITLE}`}
          title={manifest.source.dataset}
        >
          <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 7v4M8 5h.01" />
          </svg>
        </button>
      </div>

      <div className="s48-layer__note s48-temp__note">
        {season && <span className="s48-temp__season">{binLabel(season)}</span>}
        {season && <span>{season.default_resolution_deg}°</span>}
        <span>MRO MCS</span>
      </div>

      {expanded && variant && (
        <div className="s48-layer__desc">
          <dl className="s48-temp__facts">
            <dt>Local time</dt>
            <dd>{formatLocalHours(variant.coverage.local_time_hours)}</dd>
            <dt>Coverage</dt>
            <dd>{formatCoverage(variant.coverage)}</dd>
            <dt>Minimum</dt>
            <dd>{variant.values.min_observations_per_cell} observations per cell</dd>
          </dl>
          <div className="s48-layer__desc-meta">Source: {manifest.source.citation}</div>
          <div className="s48-layer__desc-meta">Licence: {manifest.source.licence}</div>
        </div>
      )}

      {enabled && (
        <div className="s48-layer__body">
          <div className="s48-seg s48-temp__kind" role="group" aria-label="Temperature">
            {TEMPERATURE_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => onKindChange(k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="s48-opacity">
            <span>Opacity</span>
            <input
              type="range"
              className="s48-range"
              min="0"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              aria-label={`${TITLE} opacity`}
            />
            <output>{Math.round(opacity * 100)} %</output>
          </div>
          <div className="s48-legend">
            <div className="s48-legend__ramp" style={{ background: legendRamp(manifest.legend) }} aria-hidden="true" />
            <div className="s48-temp__ticks">
              {ticks.map((tick, i) => (
                <span
                  key={i}
                  className={i === 0 ? 'is-first' : i === ticks.length - 1 ? 'is-last' : undefined}
                  style={i === ticks.length - 1 ? undefined : { left: `${tick.at * 100}%` }}
                >
                  <b>{tick.label}</b>
                  {i === ticks.length - 1 && <span className="s48-legend__unit">{units}</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
