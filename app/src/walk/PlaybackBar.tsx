import { useMemo } from 'react';
import { formatDuration } from './format';
import { Playback, PLAYBACK_RATE } from './usePlayback';
import { SiteData } from '../types';
import { Plan } from '../lib/plan';
import { timelineReadoutsAt } from './timelineReadouts';
import './playbackBar.css';

export interface PlaybackBarProps {
  playback: Playback;
  durationS: number;
  elapsedS: number;
  siteData?: SiteData;
  plan?: Plan;
  /** Visor: play, scrubber and time only. */
  compact?: boolean;
}

const KEYS_HINT = 'Space: play or pause · Left/Right: step 1 % · Page Up/Down: previous or next stop';

/** The playback bar in the time region under the map, in Walk and Visor. */
export function PlaybackBar({ playback, durationS, elapsedS, siteData, plan, compact = false }: PlaybackBarProps) {
  const readouts = useMemo(() => {
    if (compact || !siteData || !plan) return null;
    return timelineReadoutsAt({
      elapsedS,
      durationS,
      lat: siteData.origin.lat0,
      lon: siteData.origin.lon0,
      siteId: siteData.id,
      timeLimitS: plan.params?.time_limit_s,
    });
  }, [compact, siteData, plan, elapsedS, durationS]);

  return (
    <div className={`s48-playback${compact ? ' s48-playback--compact' : ''}`}>
      <button
        type="button"
        className="s48-playback__play"
        onClick={playback.toggle}
        aria-label={playback.playing ? 'Pause' : 'Play'}
        aria-keyshortcuts="Space ArrowLeft ArrowRight PageUp PageDown"
        title={KEYS_HINT}
      >
        {playback.playing ? 'Pause' : 'Play'}
      </button>
      <input
        className="s48-playback__scrub"
        aria-label="Walk position"
        title={KEYS_HINT}
        type="range"
        min={0}
        max={durationS}
        step={1}
        value={elapsedS}
        onChange={(event) => playback.seek(Number(event.target.value))}
      />
      <output className="s48-playback__time" aria-label="Elapsed and total">
        {formatDuration(elapsedS)} / {formatDuration(durationS)}
      </output>
      {readouts && (
        <span className="s48-playback__readouts" aria-label="Timeline conditions">
          <span title="Estimated surface temperature">{readouts.tempFormatted}</span>
          <span title="Time to sunset">{readouts.sunsetFormatted}</span>
        </span>
      )}
      {!compact && <span className="s48-playback__speed" title="Playback speed">×{PLAYBACK_RATE}</span>}
    </div>
  );
}
