// Written with AI assistance, directed and reviewed by the team.

/**
 * Warning ladder and shelter choice (design: "Warnings and shelter",
 * "Night contingency").
 *
 * The ladder is a pure function of the clock, the back-by (turn-back) deadline,
 * sunset, and the projected arrival back at the shelter at the current pace:
 *
 *   ok -> behind-pace -> turn-back -> return-to-shelter
 *
 * Night contingency triggers "when the crew is still out at the back-by time or
 * the projected arrival is after sunset" (design), so the two hard rungs key on
 * (now vs back-by) and (projected arrival vs sunset). No value here is a sourced
 * physical threshold; PACE_SLIP_MIN is a labelled app setting.
 */

import { formatDuration, formatSignedMinutes } from './format';

export type LadderLevel = 'ok' | 'behind-pace' | 'turn-back' | 'return-to-shelter';

/**
 * Minutes behind the required pace at which the advisory rung lights even when
 * the projected arrival is still inside the reserve. App setting, not a sourced
 * figure (there is no published Mars EVA pace tolerance).
 */
export const PACE_SLIP_MIN = 5;

export interface LadderInput {
  /** Current mission time (UTC ms). */
  nowMs: number;
  /** Turn-back deadline: the latest time to start home and still fit the budget. */
  backByMs: number;
  /** Sunset at the crew's site (UTC ms). */
  sunsetMs: number;
  /** Estimated arrival back at the plan shelter at the current pace (UTC ms). */
  projectedArrivalMs: number;
  /** How many minutes slower than the required pace the crew is moving (>= 0). */
  behindPaceMin: number;
  /** Suit consumable time left, seconds. Optional; forces a shelter return when short. */
  suitTimeLeftS?: number;
  /** Estimated time to the nearest shelter, seconds. Optional, pairs with suit time. */
  timeToShelterS?: number;
}

export interface LadderResult {
  level: LadderLevel;
  /** Short line for large type. */
  headline: string;
  /** One supporting line. */
  detail: string;
  /** Minutes until sunset (signed; negative once sunset has passed). */
  minutesToSunset: number;
  /** Minutes until the back-by time (signed; negative once it has passed). */
  minutesToBackBy: number;
  /** Projected arrival relative to sunset (signed; positive is after dark). */
  arrivalAfterSunsetMin: number;
  /** Projected arrival relative to the back-by time (signed; positive is late). */
  arrivalAfterBackByMin: number;
}

function minutesBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 60000);
}

/** The ladder rung and the numbers behind it. Pure: same inputs, same output. */
export function ladderLevel(input: LadderInput): LadderResult {
  const minutesToSunset = minutesBetween(input.nowMs, input.sunsetMs);
  const minutesToBackBy = minutesBetween(input.nowMs, input.backByMs);
  const arrivalAfterSunsetMin = minutesBetween(input.sunsetMs, input.projectedArrivalMs);
  const arrivalAfterBackByMin = minutesBetween(input.backByMs, input.projectedArrivalMs);

  const suitShort =
    input.suitTimeLeftS !== undefined &&
    input.timeToShelterS !== undefined &&
    input.suitTimeLeftS < input.timeToShelterS;
  const pastBackBy = input.nowMs >= input.backByMs;
  const arrivesAfterSunset = input.projectedArrivalMs > input.sunsetMs;
  const arrivesAfterBackBy = input.projectedArrivalMs > input.backByMs;

  let level: LadderLevel;
  if (suitShort || pastBackBy) level = 'return-to-shelter';
  else if (arrivesAfterSunset) level = 'turn-back';
  else if (arrivesAfterBackBy || input.behindPaceMin > PACE_SLIP_MIN) level = 'behind-pace';
  else level = 'ok';

  const base = {
    minutesToSunset,
    minutesToBackBy,
    arrivalAfterSunsetMin,
    arrivalAfterBackByMin,
  };

  switch (level) {
    case 'ok':
      return {
        level,
        headline: 'On pace',
        detail: `Back at the shelter with ${formatDuration(
          -arrivalAfterBackByMin * 60000,
        )} to spare. Sunset in ${formatDuration(minutesToSunset * 60000)}.`,
        ...base,
      };
    case 'behind-pace':
      return {
        level,
        headline: 'Behind pace',
        detail: `At this pace you reach the shelter ${formatSignedMinutes(
          arrivalAfterBackByMin,
        )} after the back-by time. Sunset in ${formatDuration(minutesToSunset * 60000)}.`,
        ...base,
      };
    case 'turn-back':
      return {
        level,
        headline: 'Turn back now',
        detail: `At this pace you arrive ${formatSignedMinutes(
          arrivalAfterSunsetMin,
        )} after sunset. Re-plan the route home to the shelter.`,
        ...base,
      };
    case 'return-to-shelter':
      return {
        level,
        headline: 'Return to shelter',
        detail:
          minutesToSunset >= 0
            ? `Too late for the plan shelter. Sunset in ${formatDuration(
                minutesToSunset * 60000,
              )}; head to the nearest shelter.`
            : `Past sunset by ${formatDuration(
                -minutesToSunset * 60000,
              )}. Head to the nearest shelter.`,
        ...base,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Shelter choice by hazard                                           */
/* ------------------------------------------------------------------ */

/** What is driving the crew to shelter (design: "Shelter by hazard"). */
export type Hazard = 'daylight' | 'pace' | 'radiation' | 'dust';

export type ShelterKind = 'habitat' | 'rover' | 'radiation-shelter' | 'cave' | 'terrain-shield';

export interface ShelterCandidate {
  id: string;
  kind: ShelterKind;
  /** Straight-line distance from the crew, local-frame metres. */
  distanceM: number;
  /** Caves must be surveyed and accessible to count (none are today). */
  accessible?: boolean;
  /** Share of the sky a terrain-shielded spot blocks, 0..1 (from elevation data). */
  skyBlockedFrac?: number;
  /** True when the shelter sits on the planned route (matters for a dust return). */
  onRoute?: boolean;
  /** The plan's own shelter, where the walk starts and ends: the primary safe haven. */
  primary?: boolean;
  /** Name on screen (the plan shelter's label); else the kind's name. */
  name?: string;
}

export interface ShelterChoice {
  shelter: ShelterCandidate;
  reason: string;
}

/** Nearest candidate (the plan shelter wins a tie), or null for an empty list. */
function nearest(candidates: ShelterCandidate[]): ShelterCandidate | null {
  let best: ShelterCandidate | null = null;
  for (const c of candidates) {
    if (best === null || c.distanceM < best.distanceM || (c.distanceM === best.distanceM && c.primary && !best.primary)) best = c;
  }
  return best;
}

/** Pressurised shelters a crew can walk into: habitat, rover, radiation shelter. */
function isPressurised(c: ShelterCandidate): boolean {
  return c.kind === 'habitat' || c.kind === 'rover' || c.kind === 'radiation-shelter';
}

/**
 * Chooses a shelter for the hazard over the candidate shelters with distances
 * (design: "Shelter by hazard"):
 *  - daylight / pace -> nearest of the plan shelter, a habitat, radiation shelter or the pressurised rover.
 *  - radiation -> nearest of habitat, rover, a surveyed accessible cave (none
 *    today), or a terrain-shielded spot (cliff or crater wall).
 *  - dust / low visibility -> the habitat along the planned route.
 * Returns null when the hazard has no eligible candidate.
 */
export function chooseShelter(hazard: Hazard, candidates: ShelterCandidate[]): ShelterChoice | null {
  if (hazard === 'daylight' || hazard === 'pace') {
    const eligible = candidates.filter((c) => c.primary || isPressurised(c));
    const shelter = nearest(eligible);
    if (!shelter) return null;
    return { shelter, reason: shelter.primary ? 'The plan shelter, where the walk ends.' : 'Nearest pressurised shelter.' };
  }

  if (hazard === 'radiation') {
    const eligible = candidates.filter((c) => {
      if (c.kind === 'cave') return c.accessible === true;
      return isPressurised(c) || c.kind === 'terrain-shield';
    });
    const shelter = nearest(eligible);
    if (!shelter) return null;
    const reason =
      shelter.kind === 'terrain-shield'
        ? `Terrain-shielded spot; blocks ${Math.round(
            (shelter.skyBlockedFrac ?? 0) * 100,
          )} % of the sky.`
        : 'Nearest pressurised shelter.';
    return { shelter, reason };
  }

  // dust: the habitat along the planned route; fall back to the nearest habitat.
  const onRoute = candidates.filter((c) => c.kind === 'habitat' && c.onRoute === true);
  const habitats = candidates.filter((c) => c.kind === 'habitat');
  const shelter = nearest(onRoute) ?? nearest(habitats);
  if (!shelter) return null;
  return {
    shelter,
    reason: shelter.onRoute
      ? 'Habitat along the planned route.'
      : 'Nearest habitat; no habitat on the route.',
  };
}
