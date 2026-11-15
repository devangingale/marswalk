import { useEffect } from 'react';
import { Playback } from './usePlayback';
import { RouteTrack, START_ID } from './track';
import { playbackKeyAction, PlaybackKeyTarget, playbackSeekTarget } from './playbackKeys';
import { stepSpeed } from './playbackSpeed';

function eventTarget(target: EventTarget | null): PlaybackKeyTarget | null {
  if (!(target instanceof HTMLElement)) return null;
  return {
    tagName: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : null,
    isContentEditable: target.isContentEditable,
  };
}

export function usePlaybackKeys(playback: Playback, track: RouteTrack): void {
  useEffect(() => {
    const stopTimes = track.legs
      .filter(({ leg }) => leg.to !== START_ID)
      .map(({ leg, startTimeS }) => startTimeS + leg.time_s);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = playbackKeyAction(event.key, eventTarget(event.target), track.durationS > 0);
      if (!action) return;
      event.preventDefault();
      if (action === 'toggle') {
        playback.toggle();
        return;
      }
      if (action === 'slower' || action === 'faster') {
        playback.setSpeed(stepSpeed(playback.speed, action === 'slower' ? -1 : 1));
        return;
      }
      const target = playbackSeekTarget(action, playback.elapsedS, track.durationS, stopTimes);
      if (target !== null) playback.seek(target);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback, track]);
}
