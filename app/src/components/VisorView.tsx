// Written with AI assistance, directed and reviewed by the team.

import React from 'react';
import { VisorGlobe, type VisorViewProps } from '../globe/walk/VisorGlobe';
import { useSafetyModel } from '../safety/useSafetyModel';
import { SafetyVisor } from '../safety/SafetyCompact';
import { useSharedPlayback } from '../walk/usePlayback';
import { usePlaybackKeys } from '../walk/usePlaybackKeys';
import { PlaybackBar } from '../walk/PlaybackBar';
import { Regions } from '../shell/Regions';
import './walk.css';

/**
 * Visor on the shared layout: full-bleed and always dark, four readouts (heading, next
 * stop, time remaining, warning ladder state) and SOS over the view; compact playback in
 * the time bar. The beeper and relay detail live in Walk.
 */
export const VisorView: React.FC<Omit<VisorViewProps, 'children'>> = (props) => {
  const playback = useSharedPlayback(props.track.durationS, props.elapsedS);
  usePlaybackKeys(playback, props.track);
  // The safety layer follows the playback, as in Walk.
  const safety = useSafetyModel({
    plan: props.plan,
    origin: props.siteData.origin,
    siteId: props.siteData.id,
    lat: props.siteData.origin.lat0,
    lonEast: props.siteData.origin.lon0,
    elapsedS: props.elapsedS,
  });
  const hasRoute = props.plan.stops.length > 0;

  return (
    <div className="s48-visor-shell" data-theme="dark">
      <Regions
        id="visor"
        bare
        main={
          <VisorGlobe {...props}>
            {(hazard) => (safety && hasRoute ? <SafetyVisor model={safety} hazard={hazard} /> : null)}
          </VisorGlobe>
        }
        time={
          hasRoute ? (
            <PlaybackBar playback={playback} durationS={props.track.durationS} elapsedS={props.elapsedS} compact />
          ) : undefined
        }
      />
    </div>
  );
};

export default VisorView;
