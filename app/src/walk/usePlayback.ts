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
    },
    [durationS]
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
      return;
    }
    if (elapsedRef.current >= durationS) seek(0);
    setPlaying(true);
  }, [playing, durationS, seek]);

  return { elapsedS, playing, toggle, seek };
}
