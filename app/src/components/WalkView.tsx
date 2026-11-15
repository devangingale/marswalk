// Written with AI assistance, directed and reviewed by the team.

import React, { useEffect, useMemo } from 'react';
import './walk.css';
import { Plan } from '../lib/plan';
import { SiteData } from '../types';
import { useSiteFeeds } from '../walk/feeds';
import { formatDistance, formatDose, formatDuration, formatEnergy } from '../walk/format';
import { budgetRemaining, RouteTrack, walkStateAt, waypointById, START_ID } from '../walk/track';
import { Playback } from '../walk/usePlayback';
import { usePlaybackKeys } from '../walk/usePlaybackKeys';
import { PlaybackBar } from '../walk/PlaybackBar';
import { declutterCrewLabels } from '../walk/labelDeclutter';
import { StopDetails } from './StopDetails';
import { DirectionsPanel, useDirectionsNow } from './DirectionsPanel';
import { WalkGlobe } from '../globe/walk/WalkGlobe';
import { useSafetyModel } from '../safety/useSafetyModel';
import { SafetyPanel } from '../safety/SafetyCompact';
import { Regions } from '../shell/Regions';

interface WalkViewProps {
  siteData: SiteData;
  plan: Plan;
  track: RouteTrack;
  playback: Playback;
  onPlan: () => void;
  /** Told when night at the site starts or ends, so the top bar can follow the night theme. */
  onNightChange?: (night: boolean) => void;
}

/**
 * Walk on the shared layout: Safety panel on the left, the chase-camera map in the
 * middle, the next stop on the right, playback in the time bar under the map.
 */
export const WalkView: React.FC<WalkViewProps> = ({ siteData, plan, track, playback, onPlan, onNightChange }) => {
  // Every hook runs before the empty-route return, so the hook order never changes.
  usePlaybackKeys(playback, track);
  const feeds = useSiteFeeds(siteData);
  // The safety layer follows the playback: the crew is where the walk is.
  const safety = useSafetyModel({
    plan,
    origin: siteData.origin,
    siteId: siteData.id,
    lat: siteData.origin.lat0,
    lonEast: siteData.origin.lon0,
    elapsedS: playback.elapsedS,
  });
  const markers = safety?.markers ?? null;
  const crew = useMemo(() => declutterCrewLabels(markers, plan.start), [markers, plan.start]);
  const theme = safety?.night ? 'night' : undefined;
  const night = !!safety?.night;
  useEffect(() => {
    onNightChange?.(night);
  }, [night, onNightChange]);
  useEffect(() => () => onNightChange?.(false), [onNightChange]);

  // Directions run before the empty-route return too, so the hook order never changes.
  const walkState = walkStateAt(plan, track, playback.elapsedS);
  const directions = useDirectionsNow(plan, track, siteData.origin, walkState);
  const turnPoint = directions.next && !directions.next.kind.startsWith('arrive') ? directions.next : null;

  if (plan.stops.length === 0) {
    return (
      <div className="s48-walk s48-walk--empty" data-theme={theme}>
        <Regions
          id="walk"
          main={
            <>
              <WalkGlobe siteData={siteData} plan={plan} track={track} lon={plan.start.lon} lat={plan.start.lat} alongM={0} />
              <section className="s48-empty-route">
                <button type="button" onClick={onPlan}>
                  Add stops in Plan
                </button>
              </section>
            </>
          }
        />
      </div>
    );
  }

  const state = walkState;
  const budget = budgetRemaining(plan, state.used);
  const next = state.next ? waypointById(plan, state.next.id) : null;
  const focus = waypointById(plan, state.atWaypointId ?? state.next?.id ?? START_ID);
  const turnBack = plan.route.turn_back;

  const isEnd = state.next === null || (state.elapsedS >= track.durationS && track.durationS > 0);
  const timeRemaining = isEnd ? (plan.route.totals.time_s || track.durationS) : budget.time.remaining;
  const energyRemaining = isEnd ? plan.route.totals.energy_kj : budget.energy.remaining;
  const doseRemaining = isEnd ? plan.route.totals.dose_mgy : budget.dose.remaining;

  const stopPanel = (
    <div className="s48-walk-sheet">
      <DirectionsPanel
        plan={plan}
        track={track}
        origin={siteData.origin}
        state={state}
        nowUtcMs={safety?.nowWall}
        lat={siteData.origin.lat0}
        lonEast={siteData.origin.lon0}
      />
      <section className="s48-walk-section s48-walk-headline" aria-label="Next stop">
        <h2>{next?.name ?? `Back at ${plan.start.label}`}</h2>
        {state.next && (
          <div className="s48-walk-distance">
            <strong>{formatDistance(state.next.distanceM)}</strong>
            <span>{formatDuration(state.next.timeS)} to stop</span>
          </div>
        )}
      </section>
      <section className="s48-walk-section" aria-labelledby="s48-walk-budget-title">
        <h3 id="s48-walk-budget-title">{isEnd ? 'Route totals' : 'Remaining'}</h3>
        <dl className="s48-walk-budget">
          <Budget label="Time" value={formatDuration(timeRemaining)} max={budget.time.total} remaining={timeRemaining} />
          <Budget label="Energy" value={formatEnergy(energyRemaining)} max={budget.energy.total} remaining={energyRemaining} />
          <Budget label="Dose" value={formatDose(doseRemaining)} max={budget.dose.total} remaining={doseRemaining} />
        </dl>
        <p className="s48-walk-turnback">
          {turnBack
            ? `${state.turnBackPassed ? 'Past' : 'Before'} turn-back point, ${turnBack.reason} limit`
            : 'No turn-back point'}
        </p>
      </section>
      <StopDetails
        waypoint={focus}
        arrived={state.atWaypointId === focus.id}
        feeds={feeds}
        solarEvent={plan.params.solar_event}
      />
    </div>
  );

  return (
    <div className="s48-walk" data-theme={theme}>
      <Regions
        id="walk"
        left={safety ? <SafetyPanel model={safety} /> : undefined}
        leftLabel="Safety"
        right={stopPanel}
        rightLabel="Stop"
        main={
          <WalkGlobe
            siteData={siteData}
            plan={plan}
            track={track}
            lon={state.lon}
            lat={state.lat}
            alongM={state.alongM}
            crew={crew}
            turnPoint={turnPoint}
          />
        }
        time={
          <PlaybackBar
            playback={playback}
            durationS={track.durationS}
            elapsedS={state.elapsedS}
            siteData={siteData}
            plan={plan}
          />
        }
      />
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
