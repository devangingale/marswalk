import { useEffect } from 'react';
import { Playback } from './usePlayback';
import { RouteTrack, START_ID } from './track';
import { playbackKeyAction, PlaybackKeyTarget } from './playbackKeys';

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
      const action = playbackKeyAction(event.key, eventTarget(event.target), stopTimes.length > 0);
      if (!action) return;
      event.preventDefault();
      if (action === 'toggle') {
        playback.toggle();
        return;
      }

      const current = playback.elapsedS;
      const stopTimesWithStart = [0, ...stopTimes];
      const target = action === 'previous-stop'
        ? stopTimesWithStart.filter((time) => time < current - 0.01).at(-1)
        : stopTimes.find((time) => time > current + 0.01);
      if (target !== undefined) playback.seek(target);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback, track]);
}
