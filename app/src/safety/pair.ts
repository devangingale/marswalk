// Written with AI assistance, directed and reviewed by the team.

/**
 * Pair tracking and hazard margins (design: "Night contingency" pair tracking;
 * "Hardware links" positioning without GPS).
 *
 * No published Mars EVA crew-separation limit or hazard stand-off was found
 * (docs/research/eva-limits.md has none), so every limit here is a labelled app
 * setting, not a sourced figure.
 */

import { distanceBearing } from './navigate';

/** Largest crew separation before the pair warning lights, metres. App setting. */
export const PAIR_LIMIT_M = 50;

/** Hazard stand-off in daylight, metres: the visor's impassable-ground radius (walk/hazard.ts). */
export const HAZARD_MARGIN_DAY_M = 10;
/** Hazard stand-off at night, metres: twice the daylight margin. App setting. */
export const HAZARD_MARGIN_NIGHT_M = 20;

export type PairLevel = 'together' | 'separated' | 'far';

export interface PairSeparation {
  /** Ids of the two crew members farthest apart. */
  a: string;
  b: string;
  distanceM: number;
  /** Bearing from `a` to `b`, degrees clockwise from north. */
  bearingDeg: number;
  /** Distance beyond the limit, metres; 0 or less while together. */
  overByM: number;
  /** together up to the limit, separated past it, far past twice the limit. */
  level: PairLevel;
}

interface CrewFix {
  id: string;
  lon: number;
  lat: number;
}

/**
 * The widest separation among the crew against `limitM`. Pure: exact inputs,
 * exact outputs. Null with fewer than two crew.
 */
export function pairSeparation(crew: CrewFix[], limitM: number = PAIR_LIMIT_M): PairSeparation | null {
  let best: Omit<PairSeparation, 'overByM' | 'level'> | null = null;
  for (let i = 0; i < crew.length; i++) {
    for (let j = i + 1; j < crew.length; j++) {
      const { distanceM, bearingDeg } = distanceBearing(crew[i], crew[j]);
      if (best === null || distanceM > best.distanceM) {
        best = { a: crew[i].id, b: crew[j].id, distanceM, bearingDeg };
      }
    }
  }
  if (!best) return null;
  const level: PairLevel =
    best.distanceM > 2 * limitM ? 'far' : best.distanceM > limitM ? 'separated' : 'together';
  return { ...best, overByM: best.distanceM - limitM, level };
}

/**
 * Hazard stand-off widened by the position uncertainty: the base margin for the
 * light, plus the uncertainty radius (design: hazard margins widen as
 * uncertainty grows). A missing or negative uncertainty adds nothing.
 */
export function hazardMarginM(uncertaintyM: number, light: 'day' | 'night'): number {
  const base = light === 'night' ? HAZARD_MARGIN_NIGHT_M : HAZARD_MARGIN_DAY_M;
  return base + (Number.isFinite(uncertaintyM) && uncertaintyM > 0 ? uncertaintyM : 0);
}
