import { useMemo } from 'react';
import { formatDuration } from './format';
import { Playback } from './usePlayback';
import { SiteData } from '../types';
import { Plan } from '../lib/plan';
import { timelineReadoutsAt } from './timelineReadouts';
import '../components/walk.css';
import './playbackBar.css';

export interface PlaybackBarProps {
  playback: Playback;
  durationS: number;
  elapsedS: number;
  siteData?: SiteData;
  plan?: Plan;
}

export function PlaybackBar({ playback, durationS, elapsedS, siteData, plan }: PlaybackBarProps) {
  const readouts = useMemo(() => {
    if (!siteData || !plan) return null;
    return timelineReadoutsAt({
      elapsedS,
      durationS,
      lat: siteData.origin.lat0,
      lon: siteData.origin.lon0,
      siteId: siteData.id,
      timeLimitS: plan.params?.time_limit_s,
    });
  }, [siteData, plan, elapsedS, durationS]);

  return (
    <div className="s48-playback">
      <button
        type="button"
        className="s48-walk-play"
        onClick={playback.toggle}
        aria-label={playback.playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-keyshortcuts="Space ArrowLeft ArrowRight"
        title="Space: play or pause · Left/Right: previous or next stop"
      >
        {playback.playing ? 'Pause' : 'Play'}
      </button>
      <input
        aria-label="Walk position"
        type="range"
        min={0}
        max={durationS}
        step={1}
        value={elapsedS}
        onChange={(event) => playback.seek(Number(event.target.value))}
      />
      <output>
        {formatDuration(elapsedS)} / {formatDuration(durationS)}
      </output>
      {readouts && (
        <div className="s48-playback-readouts" aria-label="Timeline conditions">
          <span className="s48-playback-temp" title="Estimated surface temperature">
            {readouts.tempFormatted}
          </span>
          <span className="s48-playback-sunset" title="Time to sunset">
            {readouts.sunsetFormatted}
          </span>
        </div>
      )}
      <span>x60</span>
    </div>
  );
}
