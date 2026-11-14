// Written with AI assistance, directed and reviewed by the team.
import React from 'react';
import type { NightModel } from './useSafetyModel';
import { formatBearing, formatLocalClock, formatWalkDistance, formatDistance } from './format';
import { DotFilled, DotHollow } from './glyphs';

/**
 * Night contingency display (design: "Night display: dark, route corridor,
 * distance and bearing to shelter, next hazard in large type"). The way back is
 * the walked track reversed; the habitat is alerted automatically.
 */
export const NightPanel: React.FC<{ night: NightModel; lonEast: number; compact?: boolean }> = ({
  night,
  lonEast,
  compact,
}) => {
  const { shelter, hazard, habitat } = night;
  return (
    <section className={`s48-night ${compact ? 's48-night--compact' : ''}`} aria-label="Night return">
      <h3 className="s48-night__title">Night return</h3>
      <div className="s48-night__nav">
        <div className="s48-night__row">
          <span className="s48-night__label">Rover drop-off</span>
          <strong className="s48-night__dist">{formatWalkDistance(shelter.distanceM)}</strong>
          <span className="s48-night__bearing">{formatBearing(shelter.bearingDeg)}</span>
        </div>
        <div className="s48-night__row">
          <span className="s48-night__label">Next hazard</span>
          {hazard === undefined ? (
            <span className="s48-night__none">Loading</span>
          ) : hazard === null ? (
            <span className="s48-night__none">None on the way back</span>
          ) : (
            <>
              <strong className="s48-night__dist">{formatWalkDistance(hazard.alongM)}</strong>
              <span className="s48-night__bearing">{formatBearing(hazard.bearingDeg)}</span>
            </>
          )}
        </div>
      </div>
      <dl className="s48-night__figs">
        <div>
          <dt>Way back</dt>
          <dd>{formatDistance(night.wayBackM)} on the walked track</dd>
        </div>
        {hazard ? (
          <div>
            <dt>Hazard margin</dt>
            <dd>{formatDistance(hazard.marginM)}</dd>
          </div>
        ) : null}
      </dl>
      <p className={`s48-night__habitat ${habitat?.received ? 'is-received' : ''}`}>
        {habitat?.received ? <DotFilled /> : <DotHollow />}
        {habitat?.received && habitat.atMs !== null
          ? `Habitat alerted ${formatLocalClock(habitat.atMs, lonEast)}`
          : 'Habitat alert queued until the link returns'}
      </p>
    </section>
  );
};
