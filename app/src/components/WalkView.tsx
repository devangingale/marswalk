// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { Plan } from '../lib/plan';
import { SiteData } from '../types';
import { useSiteFeeds } from '../walk/feeds';
import { formatDistance, formatDose, formatDuration, formatEnergy } from '../walk/format';
import { budgetRemaining, RouteTrack, START_ID, walkStateAt, waypointById } from '../walk/track';
import { Playback, PLAYBACK_RATE } from '../walk/usePlayback';
import { StopDetails } from './StopDetails';
import { WalkMap } from './WalkMap';

interface WalkViewProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  playback: Playback;
}

export const WalkView: React.FC<WalkViewProps> = ({ siteData, plan, track, playback }) => {
  const feeds = useSiteFeeds(siteData);
  const state = walkStateAt(plan, track, playback.elapsedS);
  const budget = budgetRemaining(plan, state.used);
  const next = state.next ? waypointById(plan, state.next.id) : null;
  const focus = waypointById(plan, state.atWaypointId ?? state.next?.id ?? START_ID);
  const turnBack = plan.route.turn_back;

  return (
    <div className="s48-walk">
      <WalkMap siteData={siteData} plan={plan} track={track} lon={state.lon} lat={state.lat} />

      <section className="s48-walk-sheet" aria-label="Walk">
        <div className="s48-walk-controls">
          <button type="button" className="s48-walk-play" onClick={playback.toggle}>
            {playback.playing ? 'Pause' : 'Play'}
          </button>
          <label className="s48-walk-scrubber">
            <span className="s48-walk-scrubber-label">Walk time</span>
            <input
              type="range"
              min={0}
              max={track.durationS}
              step={1}
              value={state.elapsedS}
              onChange={(e) => playback.seek(Number(e.target.value))}
            />
          </label>
          <output className="s48-walk-clock">
            {formatDuration(state.elapsedS)} of {formatDuration(track.durationS)}
          </output>
          <p className="s48-walk-rate">Replay at {PLAYBACK_RATE}× walking speed</p>
        </div>

        <dl className="s48-walk-readout">
          <dt>Next stop</dt>
          <dd>{next ? next.name :`Walk complete, back at ${plan.start.label}`}</dd>
          {state.next && (
            <>
              <dt>Distance to it</dt>
              <dd>{formatDistance(state.next.distanceM)}</dd>
              <dt>Time to it</dt>
              <dd>{formatDuration(state.next.timeS)}</dd>
            </>
          )}
          <dt>Time left</dt>
          <dd>
            {formatDuration(budget.time.remaining)} of {formatDuration(budget.time.total)} limit
          </dd>
          <dt>Energy left</dt>
          <dd>
            {formatEnergy(budget.energy.remaining)} of {formatEnergy(budget.energy.total)}{' '}
            {budget.energy.basis === 'limit' ? 'limit' : 'planned'}
          </dd>
          <dt>Dose left</dt>
          <dd>
            {formatDose(budget.dose.remaining)} of {formatDose(budget.dose.total)} planned
          </dd>
          <dt>Turn-back point</dt>
          <dd className="s48-walk-turnback">
            {state.turnBackPassed === null || !turnBack
              ? 'None in this plan'
              : `${state.turnBackPassed ? 'Passed' : 'Not yet passed'} (binding limit: ${turnBack.reason})`}
          </dd>
        </dl>

        <StopDetails
          waypoint={focus}
          arrived={state.atWaypointId === focus.id}
          feeds={feeds}
          solarEvent={plan.params.solar_event}
        />
      </section>
    </div>
  );
};
