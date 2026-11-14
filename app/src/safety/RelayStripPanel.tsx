// Written with AI assistance, directed and reviewed by the team.
import React from 'react';
import type { RelayStripModel } from './relayStrip';
import { NBSP } from './format';
import { DotFilled, DotHollow } from './glyphs';

/**
 * Relay status strip (design: "Status strip in Walk and Visor"). Habitat link
 * state, the next real orbiter pass in site local time, and the queue depth.
 * Transmission is simulated and labelled so; pass times are real (SPICE).
 */
export const RelayStrip: React.FC<{ model: RelayStripModel; simulated: boolean }> = ({
  model,
  simulated,
}) => {
  const { habitat, nextPass, queued } = model;
  return (
    <section className="s48-relay" aria-label="Relay status">
      <div className={`s48-relay__link ${habitat === 'live' ? 'is-live' : 'is-lost'}`}>
        {habitat === 'live' ? <DotFilled /> : <DotHollow />}
        <span className="s48-relay__who">Habitat</span>
        <span className="s48-relay__state">{habitat === 'live' ? 'live' : 'lost'}</span>
      </div>

      <div className="s48-relay__link">
        <DotHollow />
        <span className="s48-relay__who">Earth</span>
        {nextPass ? (
          <span className="s48-relay__state">
            {nextPass.open ? (
              <>pass open · {nextPass.orbiter}</>
            ) : (
              <>
                next pass {nextPass.orbiter} {nextPass.localHhmm}
                {NBSP}({nextPass.minutesUntil}
                {NBSP}min)
              </>
            )}
          </span>
        ) : (
          <span className="s48-relay__state">no more passes this sol</span>
        )}
      </div>

      <div className="s48-relay__queue">
        <span className="s48-relay__count">{queued}</span>
        <span className="s48-relay__who">queued</span>
      </div>

      {simulated && <span className="s48-relay__sim">Transmission simulated</span>}
    </section>
  );
};
