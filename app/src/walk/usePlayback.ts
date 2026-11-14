// Written with AI assistance, directed and reviewed by the team.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Seconds of walk replayed per second of playback. */
export const PLAYBACK_RATE = 60;

export interface Playback {
  elapsedS: number;
  playing: boolean;
  toggle: () => void;
  seek: (elapsedS: number) => void;
}

type SharedControls = Pick<Playback, 'toggle' | 'seek'>;
let sharedControls: SharedControls | null = null;
let sharedPlaying = false;
const listeners = new Set<(playing: boolean) => void>();

function publishPlaying(playing: boolean) {
  sharedPlaying = playing;
  listeners.forEach((listener) => listener(playing));
}

/** Controls the active route clock from views that receive elapsed time only. */
export function useSharedPlayback(durationS: number, elapsedS: number): Playback {
  const [playing, setPlaying] = useState(sharedPlaying);
  useEffect(() => {
    listeners.add(setPlaying);
    setPlaying(sharedPlaying);
    return () => { listeners.delete(setPlaying); };
  }, []);
  return {
    elapsedS,
    playing,
    toggle: () => sharedControls?.toggle(),
    seek: (value) => sharedControls?.seek(Math.min(Math.max(value, 0), durationS)),
  };
}

/** Replay clock over [0, durationS], shared by Walk and Visor. */
export function usePlayback(durationS: number): Playback {
  const [elapsedS, setElapsedS] = useState(0);
  const [playing, setPlaying] = useState(false);
  const elapsedRef = useRef(0);

  const seek = useCallback(
    (s: number) => {
      const clamped = Math.min(Math.max(s, 0), durationS);
      elapsedRef.current = clamped;
      setElapsedS(clamped);
      publishPlaying(playing);
    },
    [durationS, playing]
  );

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(durationS, elapsedRef.current + ((now - last) / 1000) * PLAYBACK_RATE);
      last = now;
      elapsedRef.current = next;
      setElapsedS(next);
      if (next >= durationS) {
        setPlaying(false);
        publishPlaying(false);
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, durationS]);

  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false);
      publishPlaying(false);
      return;
    }
    if (elapsedRef.current >= durationS) seek(0);
    setPlaying(true);
    publishPlaying(true);
  }, [playing, durationS, seek]);

  useEffect(() => {
    sharedControls = { toggle, seek };
    return () => {
      if (sharedControls?.toggle === toggle) sharedControls = null;
    };
  }, [toggle, seek]);

  return { elapsedS, playing, toggle, seek };
}
