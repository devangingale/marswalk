// Written with AI assistance, directed and reviewed by the team.
// Detail card for a selected site: coordinates, scores, evidence and veto notes.

import React from 'react';
import { GROUP_KEYS, GROUP_LABELS, Site, Veto } from './types';
import {
  formatCount,
  formatDistanceKm,
  formatDose,
  formatDust,
  formatElevation,
  formatLatLon,
  formatScore,
  scoreBucket,
} from './format';
import { vetoLines } from './vetoInfo';

interface SiteCardProps {
  site: Site;
  vetoes: Veto[];
  placeName: string | null;
  rank: number | null;
  onClose: () => void;
}

interface EvidenceRow {
  label: string;
  value: string;
  unit: string;
}

function evidenceRows(site: Site): EvidenceRow[] {
  const e = site.evidence;
  return [
    { label: 'Distance to ice', value: formatDistanceKm(e.ice_dist_km), unit: 'km' },
    { label: 'Radiation', value: formatDose(e.dose_ugy_day), unit: 'µGy/day' },
    { label: 'Dust p95', value: formatDust(e.dust_p95), unit: '' },
    { label: 'Caves within 100 km', value: formatCount(e.cave_count_zone), unit: '' },
    { label: 'Elevation', value: formatElevation(e.elevation_m), unit: 'm' },
  ];
}

export const SiteCard: React.FC<SiteCardProps> = ({ site, vetoes, placeName, rank, onClose }) => {
  const isCandidate = site.kind === 'new';
  const vetos = site.vetoed ? vetoLines(site.veto_reason, vetoes) : [];

  return (
    <section className="sites-card" aria-label={`Site detail: ${site.name}`}>
      <header className="sites-card__head">
        <div>
          <h3 className="sites-card__name">{site.name}</h3>
          {isCandidate && placeName && <p className="sites-card__sub">near {placeName}</p>}
          <p className="sites-card__coords">{formatLatLon(site.lat, site.lon)}</p>
        </div>
        <button type="button" className="s48-btn s48-btn--quiet" onClick={onClose} aria-label="Close site detail">
          Close
        </button>
      </header>

      <div className="sites-card__score">
        <span className="sites-card__score-label">Score</span>
        <span className="sites-score-value" aria-hidden="true">
          <span className={`sites-score-dot sites-dot--${scoreBucket(site.score)}`} />
          {formatScore(site.score)}
        </span>
        <span className="sites-visually-hidden">score {formatScore(site.score)} of 100</span>
        {rank !== null && <span className="sites-card__rank">rank {rank}</span>}
      </div>

      <dl className="sites-groups">
        {GROUP_KEYS.map((key) => {
          const value = site.groups[key];
          return (
            <div key={key} className="sites-group">
              <dt>{GROUP_LABELS[key]}</dt>
              <dd>
                <span className="sites-bar" aria-hidden="true">
                  <span className="sites-bar__fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                </span>
                <span className="sites-group__val">{formatScore(value)}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      <dl className="sites-evidence">
        {evidenceRows(site).map((row) => (
          <div key={row.label} className="sites-evidence__row">
            <dt>{row.label}</dt>
            <dd>
              <span className="sites-evidence__val">{row.value}</span>
              {row.unit && <span className="sites-evidence__unit"> {row.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {site.vetoed && (
        <div className="sites-card__veto">
          <p className="sites-card__veto-head">Vetoed as a landing site</p>
          {vetos.map((v) => (
            <div key={v.label} className="sites-card__veto-item">
              <p className="sites-card__veto-reason">{v.label}</p>
              {v.source && <p className="sites-card__veto-source">{v.source}</p>}
            </div>
          ))}
        </div>
      )}

      <p className={`sites-detail ${site.detail_available ? 'sites-detail--ready' : ''}`}>
        {site.detail_available
          ? 'Detail available: a 1 m terrain bundle exists here'
          : `Detail: nearest HiRISE DTM ${formatDistanceKm(site.nearest_hirise_dtm_km)} km`}
      </p>
    </section>
  );
};
