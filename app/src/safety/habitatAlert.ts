// Written with AI assistance, directed and reviewed by the team.

/**
 * Habitat alert for the night contingency (design: "alerts the habitat
 * automatically: position, heading, pace, suit time left; help comes from the
 * habitat crew, not Earth"). The packet is pure data; the simulated habitat
 * receives it at once over a live local link and holds it while the link is
 * lost, the same behaviour as the simulated telemetry adapter's habitat link.
 */

import type { NightTrigger } from './navigate';

export interface HabitatAlert {
  atMs: number;
  trigger: NightTrigger;
  /** Each crew fix, six decimals (about 6 cm) and whole-metre uncertainty. */
  crew: { id: string; lon: number; lat: number; uncertaintyM: number }[];
  /** Lead crew heading, whole degrees 0-359. */
  headingDeg: number;
  /** Current walking pace, metres per second, two decimals. */
  paceMS: number;
  /** Suit consumables left, whole seconds. */
  suitTimeLeftS: number;
}

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

export function buildHabitatAlert(input: {
  nowMs: number;
  trigger: NightTrigger;
  crew: { id: string; lon: number; lat: number; uncertaintyM: number }[];
  headingDeg: number;
  paceMS: number;
  suitTimeLeftS: number;
}): HabitatAlert {
  return {
    atMs: input.nowMs,
    trigger: input.trigger,
    crew: input.crew.map((c) => ({
      id: c.id,
      lon: round(c.lon, 6),
      lat: round(c.lat, 6),
      uncertaintyM: Math.round(c.uncertaintyM),
    })),
    headingDeg: Math.round(input.headingDeg) % 360,
    paceMS: round(input.paceMS, 2),
    suitTimeLeftS: Math.round(input.suitTimeLeftS),
  };
}

export interface HabitatReceipt {
  received: boolean;
  /** When the habitat received it; null while held. */
  atMs: number | null;
  /** Send attempt number, from 1. */
  seq: number;
}

export interface SimulatedHabitat {
  send(alert: HabitatAlert, link: 'live' | 'lost'): HabitatReceipt;
  /** Alerts the habitat has received, in order. */
  sent(): HabitatAlert[];
}

export function createSimulatedHabitat(clock: () => number): SimulatedHabitat {
  const received: HabitatAlert[] = [];
  let seq = 0;
  return {
    send(alert, link) {
      seq++;
      if (link !== 'live') return { received: false, atMs: null, seq };
      received.push(alert);
      return { received: true, atMs: clock(), seq };
    },
    sent: () => [...received],
  };
}
