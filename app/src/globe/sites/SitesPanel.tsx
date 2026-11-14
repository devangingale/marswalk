// Written with AI assistance, directed and reviewed by the team.
// The "Sites" tab: ranked list, filter chips and adjustable weight sliders.

import React from 'react';
import { GROUP_KEYS, GROUP_LABELS, GroupKey, Site, Weights } from './types';
import { RankedSite, normalizeWeights } from './scoring';
import { FilterState, ICE_NEARBY_KM, KindChip } from './filters';
import { formatScore, scoreBucket } from './format';

interface SitesPanelProps {
  rows: RankedSite[];
  placeNames: Map<string, string | null>;
  selectedId: string | null;
  onSelect: (site: Site) => void;
  filters: FilterState;
  onKind: (kind: KindChip) => void;
  onToggle: (chip: 'hasDetail' | 'iceNearby' | 'lowRadiation' | 'cavesNearby' | 'showVetoed') => void;
  weights: Weights;
  onWeight: (key: GroupKey, value: number) => void;
  onResetWeights: () => void;
  weightsAreDefault: boolean;
  onHide: () => void;
}

const KIND_CHIPS: { key: KindChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'landed', label: 'Landed' },
  { key: 'zone2015', label: '2015 zones' },
];

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({
  on,
  onClick,
  children,
}) => (
  <button type="button" className={`sites-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onClick}>
    {children}
  </button>
);

export const SitesPanel: React.FC<SitesPanelProps> = ({
  rows,
  placeNames,
  selectedId,
  onSelect,
  filters,
  onKind,
  onToggle,
  weights,
  onWeight,
  onResetWeights,
  weightsAreDefault,
  onHide,
}) => {
  const normalized = normalizeWeights(weights);

  return (
    <aside className="panel sites-panel">
      <div className="panel-sec sites-controls">
        <h3>
          <span>
            Sites <small>{rows.length} shown</small>
          </span>
          <button type="button" className="s48-btn s48-btn--quiet" onClick={onHide} aria-label="Close site panel">
            Hide
          </button>
        </h3>

        <div className="sites-chips" role="group" aria-label="Filter by kind">
          {KIND_CHIPS.map((c) => (
            <Chip key={c.key} on={filters.kind === c.key} onClick={() => onKind(c.key)}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="sites-chips" role="group" aria-label="Filter by criteria">
          <Chip on={filters.hasDetail} onClick={() => onToggle('hasDetail')}>
            Has detail
          </Chip>
          <Chip on={filters.iceNearby} onClick={() => onToggle('iceNearby')}>
            Ice nearby ({ICE_NEARBY_KM} km)
          </Chip>
          <Chip on={filters.lowRadiation} onClick={() => onToggle('lowRadiation')}>
            Low radiation
          </Chip>
          <Chip on={filters.cavesNearby} onClick={() => onToggle('cavesNearby')}>
            Caves nearby
          </Chip>
          <Chip on={filters.showVetoed} onClick={() => onToggle('showVetoed')}>
            Show vetoed
          </Chip>
        </div>

        <div className="sites-weights">
          <div className="sites-weights__head">
            <span>Weights</span>
            <button
              type="button"
              className="s48-btn s48-btn--quiet"
              onClick={onResetWeights}
              disabled={weightsAreDefault}
            >
              Reset
            </button>
          </div>
          {GROUP_KEYS.map((key) => (
            <label key={key} className="sites-weight">
              <span className="sites-weight__name">{GROUP_LABELS[key]}</span>
              <input
                type="range"
                className="s48-range"
                min={0}
                max={1}
                step={0.05}
                value={weights[key]}
                onChange={(e) => onWeight(key, parseFloat(e.target.value))}
                aria-label={`${GROUP_LABELS[key]} weight`}
              />
              <output className="sites-weight__val">{Math.round(normalized[key] * 100)} %</output>
            </label>
          ))}
        </div>
      </div>

      <ol className="sites-list">
        {rows.map(({ site, score, rank }) => {
          const place = site.kind === 'new' ? placeNames.get(site.id) : null;
          return (
            <li key={site.id}>
              <button
                type="button"
                className={`sites-row ${selectedId === site.id ? 'is-selected' : ''} ${site.vetoed ? 'is-vetoed' : ''}`}
                onClick={() => onSelect(site)}
                aria-pressed={selectedId === site.id}
              >
                <span className="sites-row__rank">{rank}</span>
                <span className="sites-row__main">
                  <span className="sites-row__name">{site.name}</span>
                  {place && <span className="sites-row__place">near {place}</span>}
                  <span className="sites-bar" aria-hidden="true">
                    <span
                      className={`sites-bar__fill sites-fill--${scoreBucket(score)}`}
                      style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                    />
                  </span>
                </span>
                <span className="sites-row__score">{formatScore(score)}</span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="sites-empty">No sites match these filters.</li>}
      </ol>
    </aside>
  );
};
