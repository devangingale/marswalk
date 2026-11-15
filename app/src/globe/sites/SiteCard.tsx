// Written with AI assistance, directed and reviewed by the team.
// Detail card for a selected site: coordinates, scores, evidence and veto notes.

import React from 'react';
import { Site, Veto } from './types';
import { formatCount, formatDistanceKm, formatDose, formatDust, formatElevation, formatLatLon } from './format';
import { SiteScoreRow } from '../annotations/SiteScoreRow';
import { vetoLines } from './vetoInfo';
import type { HiriseView } from './hirise';
import { HiriseFigure } from './HiriseFigure';
import type { ValuesGrid } from '../layerManifest';
import {
  EXPLORATION_ZONE_CITATION,
  queryCavesZone,
  queryIceZone,
  queryRadiationZone,
  queryHydratedHotspotsZone,
  queryOtherSitesZone,
  type HydratedHotspot,
} from './explorationZone';

interface SiteCardProps {
  site: Site;
  vetoes: Veto[];
  placeName: string | null;
  rank: number | null;
  onClose: () => void;
  /** Extra action for the site, such as entering its surface view. */
  action?: React.ReactNode;
  /** HiRISE image for a ranked site; null when the site is not a HiRISE target. */
  hirise?: HiriseView | null;
  /** All sites to query neighboring sites inside the 100 km circle. */
  allSites?: Site[];
  /** SWIM water ice consistency values grid. */
  swimGrid?: ValuesGrid | null;
  /** Radiation surface dose values grid. */
  radGrid?: ValuesGrid | null;
  /** Hydrated mineral hotspots. */
  hydratedHotspots?: HydratedHotspot[];
}

interface EvidenceRow {
  label: string;
  value: string;
  unit: string;
}

function evidenceRows(site: Site): EvidenceRow[] {
  const e = site.evidence;
  return [
    { label: 'Distance to ice (SWIM, ice likely ≥ +0.5)', value: formatDistanceKm(e.ice_dist_km), unit: 'km' },
    { label: 'Radiation', value: formatDose(e.dose_ugy_day), unit: 'µGy/day' },
    { label: 'Dust p95', value: formatDust(e.dust_p95), unit: '' },
    { label: 'Caves within 100 km', value: formatCount(e.cave_count_zone), unit: '' },
    { label: 'Elevation', value: formatElevation(e.elevation_m), unit: 'm' },
  ];
}

export const SiteCard: React.FC<SiteCardProps> = ({
  site,
  vetoes,
  placeName,
  rank,
  onClose,
  action,
  hirise,
  allSites,
  swimGrid,
  radGrid,
  hydratedHotspots,
}) => {
  const isCandidate = site.kind === 'new';
  const vetos = site.vetoed ? vetoLines(site.veto_reason, vetoes) : [];

  const cavesLine = queryCavesZone(site.evidence.cave_count_zone);
  const iceLine = queryIceZone(site.lon, site.lat, swimGrid ?? null, site.evidence.ice_dist_km);
  const radiationLine = queryRadiationZone(site.lon, site.lat, radGrid ?? null, site.evidence.dose_ugy_day);
  const hydratedLine = queryHydratedHotspotsZone(site.lon, site.lat, hydratedHotspots ?? []);
  const otherSitesLine = allSites ? queryOtherSitesZone(site, allSites) : 'None';

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

      {action && <div className="sites-card__action">{action}</div>}

      <SiteScoreRow score={site.score} rank={rank} groups={site.groups} />

      {hirise && <HiriseFigure view={hirise} />}

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

      <section className="sites-ez" aria-label="Exploration Zone (100 km)">
        <header className="sites-ez__head">
          <h4 className="sites-ez__title">Exploration Zone (100 km)</h4>
          <span className="sites-ez__citation" title="Bussey & Davis 2015 / Bussey & Hoffman 2016">
            {EXPLORATION_ZONE_CITATION}
          </span>
        </header>
        <ul className="sites-ez__list">
          <li className="sites-ez__item">
            <span className="sites-ez__label">Cave candidates</span>
            <span className="sites-ez__value">{cavesLine}</span>
          </li>
          <li className="sites-ez__item">
            <span className="sites-ez__label">Water ice</span>
            <span className="sites-ez__value">{iceLine}</span>
          </li>
          <li className="sites-ez__item">
            <span className="sites-ez__label">Radiation</span>
            <span className="sites-ez__value">{radiationLine}</span>
          </li>
          <li className="sites-ez__item">
            <span className="sites-ez__label">Hydrated minerals</span>
            <span className="sites-ez__value">{hydratedLine}</span>
          </li>
          <li className="sites-ez__item">
            <span className="sites-ez__label">Other sites</span>
            <span className="sites-ez__value">{otherSitesLine}</span>
          </li>
        </ul>
      </section>

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
