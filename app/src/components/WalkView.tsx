// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import './walk.css';
import { Plan } from '../lib/plan';
import { SiteData } from '../types';
import { useSiteFeeds } from '../walk/feeds';
import { formatDistance, formatDose, formatDuration, formatEnergy } from '../walk/format';
import { budgetRemaining, RouteTrack, walkStateAt, waypointById, START_ID } from '../walk/track';
import { Playback } from '../walk/usePlayback';
import { usePlaybackKeys } from '../walk/usePlaybackKeys';
import { PlaybackBar } from '../walk/PlaybackBar';
import { StopDetails } from './StopDetails';
import { WalkGlobe } from '../globe/walk/WalkGlobe';

interface WalkViewProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  playback: Playback;
  onPlan: () => void;
}

export const WalkView: React.FC<WalkViewProps> = ({ siteData, plan, track, playback, onPlan }) => {
  usePlaybackKeys(playback, track);

  if (plan.stops.length === 0) {
    return (
      <div className="s48-walk s48-walk--empty">
        <div className="s48-walk-map-area">
          <WalkGlobe
            siteData={siteData}
            plan={plan}
            track={track}
            lon={plan.start.lon}
            lat={plan.start.lat}
            alongM={0}
          />
        </div>
        <section className="s48-empty-route">
          <button type="button" onClick={onPlan}>
            Add stops in Plan
          </button>
        </section>
      </div>
    );
  }

  const feeds = useSiteFeeds(siteData);
  const state = walkStateAt(plan, track, playback.elapsedS);
  const budget = budgetRemaining(plan, state.used);
  const next = state.next ? waypointById(plan, state.next.id) : null;
  const focus = waypointById(plan, state.atWaypointId ?? state.next?.id ?? START_ID);
  const turnBack = plan.route.turn_back;

  return (
    <div className="s48-walk">
      <div className="s48-walk-map-area">
        <WalkGlobe
          siteData={siteData}
          plan={plan}
          track={track}
          lon={state.lon}
          lat={state.lat}
          alongM={state.alongM}
        />
        <PlaybackBar
          playback={playback}
          durationS={track.durationS}
          elapsedS={state.elapsedS}
          siteData={siteData}
          plan={plan}
        />
      </div>
      <section className="s48-walk-sheet" aria-label="Walk">
        <header className="s48-walk-headline">
          <h1>{next?.name ?? `Back at ${plan.start.label}`}</h1>
          {state.next && (
            <div className="s48-walk-distance">
              <strong>{formatDistance(state.next.distanceM)}</strong>
              <span>{formatDuration(state.next.timeS)} to stop</span>
            </div>
          )}
        </header>
        <dl className="s48-walk-budget">
          <Budget
            label="Time"
            value={formatDuration(budget.time.remaining)}
            max={budget.time.total}
            remaining={budget.time.remaining}
          />
          <Budget
            label="Energy"
            value={formatEnergy(budget.energy.remaining)}
            max={budget.energy.total}
            remaining={budget.energy.remaining}
          />
          <Budget
            label="Dose"
            value={formatDose(budget.dose.remaining)}
            max={budget.dose.total}
            remaining={budget.dose.remaining}
          />
        </dl>
        <p className="s48-walk-turnback">
          {turnBack
            ? `${state.turnBackPassed ? 'Past' : 'Before'} turn-back point - ${turnBack.reason} limit`
            : 'No turn-back point'}
        </p>
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

function Budget({ label, value, max, remaining }: { label: string; value: string; max: number; remaining: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(100, (remaining / max) * 100)) : 0;
  return (
    <div className="s48-budget-row">
      <dt>{label}</dt>
      <dd>
        {value}
        <span className="s48-budget-rail">
          <i style={{ width: `${ratio}%` }} />
        </span>
      </dd>
    </div>
  );
}
