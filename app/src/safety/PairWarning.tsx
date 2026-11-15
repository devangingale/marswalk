// Written with AI assistance, directed and reviewed by the team.
import React from 'react';
import type { PairSeparation } from './pair';
import { PAIR_LIMIT_M } from './pair';
import { formatBearing, formatDistance, NBSP } from './format';
import { Notch, Alert } from './glyphs';

/**
 * Pair tracking warning in the ladder's style (design: "Pair tracking: both
 * astronauts on screen, warning if they separate"). Shown only while the pair
 * is past the limit: caution past it, danger past twice it.
 */
export const PairWarning: React.FC<{ pair: PairSeparation | null; compact?: boolean }> = ({ pair, compact }) => {
  if (!pair || pair.level === 'together') return null;
  const far = pair.level === 'far';
  return (
    <section
      className={`s48-ladder s48-pair ${far ? 'is-danger' : 'is-caution'} ${compact ? 's48-pair--compact' : ''}`}
      aria-label="Pair tracking"
      role="alert"
    >
      <div className="s48-ladder__head">
        <span className="s48-ladder__glyph">{far ? <Alert /> : <Notch />}</span>
        <h2 className="s48-ladder__headline">Crew apart</h2>
      </div>
      <dl className="s48-pair__figs">
        <div>
          <dt>
            {pair.a} to {pair.b}
          </dt>
          <dd>
            <strong>{formatDistance(pair.distanceM)}</strong> {formatBearing(pair.bearingDeg)}
          </dd>
        </div>
        <div>
          <dt>Limit</dt>
          <dd>
            {PAIR_LIMIT_M}
            {NBSP}m
          </dd>
        </div>
      </dl>
    </section>
  );
};
