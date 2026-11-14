// Written with AI assistance, directed and reviewed by the team.

/**
 * Daylight beeper schedule (design: "Daylight beeper").
 *
 * An audible countdown as nightfall approaches. The steps, in order:
 *   - 60 min to back-by: a single soft tone (advisory, mutable).
 *   - 30 min to back-by: two tones (advisory, mutable).
 *   - back-by time: a repeating tone with the turn-back message (acknowledge-only).
 *   - sunset: an urgent tone until acknowledged (acknowledge-only).
 *
 * Each tone matches the on-screen warning level and colour. This module is the
 * schedule and the "which step is live now" logic only; the Web Audio player is
 * in beeperPlayer.ts.
 */

import type { LadderLevel } from './ladder';

/** How a step may be silenced. Advisory steps mute; hard steps only acknowledge. */
export type BeeperControl = 'mutable' | 'acknowledge';

export interface BeeperStep {
  id: 'back-by-60' | 'back-by-30' | 'back-by' | 'sunset';
  /** When the step becomes live (UTC ms). */
  atMs: number;
  /** Warning level, so the tone and the on-screen colour match. */
  level: LadderLevel;
  /** Number of tone pips in the pattern. */
  tones: number;
  /** Whether the tone repeats until silenced. */
  repeating: boolean;
  /** Mute (advisory) or acknowledge-only (turn-back, sunset). */
  control: BeeperControl;
  /** Short label for the step row. */
  label: string;
}

const MIN = 60000;

/**
 * The four steps for a sol, sorted by time. `backByMs` is the turn-back deadline
 * and `sunsetMs` is sunset, both UTC ms.
 */
export function beeperSchedule(backByMs: number, sunsetMs: number): BeeperStep[] {
  const steps: BeeperStep[] = [
    {
      id: 'back-by-60',
      atMs: backByMs - 60 * MIN,
      level: 'behind-pace',
      tones: 1,
      repeating: false,
      control: 'mutable',
      label: '60 min to back-by',
    },
    {
      id: 'back-by-30',
      atMs: backByMs - 30 * MIN,
      level: 'behind-pace',
      tones: 2,
      repeating: false,
      control: 'mutable',
      label: '30 min to back-by',
    },
    {
      id: 'back-by',
      atMs: backByMs,
      level: 'turn-back',
      tones: 1,
      repeating: true,
      control: 'acknowledge',
      label: 'Back-by time',
    },
    {
      id: 'sunset',
      atMs: sunsetMs,
      level: 'return-to-shelter',
      tones: 1,
      repeating: true,
      control: 'acknowledge',
      label: 'Sunset',
    },
  ];
  return steps.sort((a, b) => a.atMs - b.atMs);
}

/**
 * The step that should be sounding at `nowMs`: the latest step whose time has
 * arrived. Steps whose id is in `acknowledged` are treated as silenced, so the
 * next-earlier live step (if any) takes over. Returns null before the first step.
 */
export function currentBeeperStep(
  schedule: BeeperStep[],
  nowMs: number,
  acknowledged: ReadonlySet<string> = new Set(),
): BeeperStep | null {
  let live: BeeperStep | null = null;
  for (const step of schedule) {
    if (step.atMs > nowMs) break;
    if (acknowledged.has(step.id)) continue;
    live = step;
  }
  return live;
}

/**
 * The step crossed strictly between `prevMs` and `nowMs` (prev exclusive, now
 * inclusive): the one to sound once as time advances. Null when no step is
 * crossed in that interval. Used to fire a tone exactly on each boundary.
 */
export function stepCrossed(
  schedule: BeeperStep[],
  prevMs: number,
  nowMs: number,
): BeeperStep | null {
  let crossed: BeeperStep | null = null;
  for (const step of schedule) {
    if (step.atMs > prevMs && step.atMs <= nowMs) crossed = step;
  }
  return crossed;
}
