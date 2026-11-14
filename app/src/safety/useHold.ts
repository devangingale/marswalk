// Written with AI assistance, directed and reviewed by the team.
// Hold-to-confirm for a single safe action (design: "Rover command safety":
// a hold-to-send confirmation). Press and hold for `holdMs`; releasing early
// cancels. Returns the pointer handlers and a 0..1 progress for the UI ring.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface HoldControls {
  holding: boolean;
  progress: number;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
}

export function useHold(onComplete: () => void, holdMs = 1200): HoldControls {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(() => {
    doneRef.current = false;
    startRef.current = Date.now();
    setHolding(true);
    const tick = () => {
      if (startRef.current === null) return;
      const p = Math.min(1, (Date.now() - startRef.current) / holdMs);
      setProgress(p);
      if (p >= 1 && !doneRef.current) {
        doneRef.current = true;
        stop();
        onComplete();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [holdMs, onComplete, stop]);

  const cancel = useCallback(() => {
    if (!doneRef.current) stop();
  }, [stop]);

  return { holding, progress, onPointerDown, onPointerUp: cancel, onPointerLeave: cancel };
}
