// Written with AI assistance, directed and reviewed by the team.
// Playback speed for Walk and Visor: seconds of walk replayed per second of playback.
// One setting shared by both views, remembered in localStorage when the browser allows it.

import { useEffect, useState } from 'react';

/** The speeds offered, slowest first. ×1 is real time. */
export const PLAYBACK_SPEEDS = [1, 5, 10, 30, 60] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_SPEED: PlaybackSpeed = 10;

export const SPEED_STORAGE_KEY = 's48.playbackSpeed';

/** A stored or typed value as an offered speed; anything else is the default. */
export function parseSpeed(value: unknown): PlaybackSpeed {
  const n = typeof value === 'string' ? Number(value) : value;
  return (PLAYBACK_SPEEDS as readonly unknown[]).includes(n) ? (n as PlaybackSpeed) : DEFAULT_SPEED;
}

/** One step slower (-1) or faster (+1), held at ×1 and ×60. */
export function stepSpeed(speed: PlaybackSpeed, direction: -1 | 1): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(speed);
  const next = Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, (index < 0 ? PLAYBACK_SPEEDS.indexOf(DEFAULT_SPEED) : index) + direction));
  return PLAYBACK_SPEEDS[next];
}

/** The next speed, wrapping from ×60 back to ×1 (Visor's cycling button). */
export function cycleSpeed(speed: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(speed);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
}

export function speedLabel(speed: PlaybackSpeed): string {
  return `×${speed}`;
}

/** Elapsed walk time after dtS seconds of playback at speed, held at durationS. */
export function advanceElapsed(elapsedS: number, dtS: number, speed: number, durationS: number): number {
  return Math.min(durationS, elapsedS + Math.max(0, dtS) * speed);
}

type SpeedStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SpeedStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSpeed(storage: SpeedStorage | null = defaultStorage()): PlaybackSpeed {
  try {
    return parseSpeed(storage?.getItem(SPEED_STORAGE_KEY));
  } catch {
    return DEFAULT_SPEED;
  }
}

export function saveSpeed(speed: PlaybackSpeed, storage: SpeedStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(SPEED_STORAGE_KEY, String(speed));
  } catch {
    /* private window or blocked storage: the speed lasts for this session only */
  }
}

/* One speed for the page, so Walk and Visor (and the running clock) agree. */
let current: PlaybackSpeed | null = null;
const listeners = new Set<(speed: PlaybackSpeed) => void>();

export function getSpeed(): PlaybackSpeed {
  if (current === null) current = loadSpeed();
  return current;
}

export function setSpeed(speed: PlaybackSpeed): void {
  current = parseSpeed(speed);
  saveSpeed(current);
  listeners.forEach((listener) => listener(current as PlaybackSpeed));
}

export function subscribeSpeed(listener: (speed: PlaybackSpeed) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The shared playback speed and its setter. */
export function usePlaybackSpeed(): [PlaybackSpeed, (speed: PlaybackSpeed) => void] {
  const [speed, setLocal] = useState(getSpeed);
  useEffect(() => {
    setLocal(getSpeed());
    return subscribeSpeed(setLocal);
  }, []);
  return [speed, setSpeed];
}
