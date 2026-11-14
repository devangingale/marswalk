// Written with AI assistance, directed and reviewed by the team.

/**
 * Dev-only scenario override for the warning ladder, so each rung can be
 * screenshotted without waiting out a real walk. Read from `?safety=<level>`.
 *
 * Guarded by `import.meta.env.DEV`: in a production build the guard is a constant
 * `false`, so the bundler drops this whole path (dead-code elimination). The
 * scenario does not bypass the ladder logic; it feeds `ladderLevel` coherent
 * numbers, so the panel shows real, formatted times.
 */

import type { LadderInput } from './ladder';

export type SafetyScenario = 'ok' | 'behind-pace' | 'turn-back' | 'return-to-shelter';

const SCENARIOS: SafetyScenario[] = ['ok', 'behind-pace', 'turn-back', 'return-to-shelter'];

/** The forced scenario, or null when none is set or this is a production build. */
export function readScenario(search: string): SafetyScenario | null {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(search).get('safety');
  return v !== null && (SCENARIOS as string[]).includes(v) ? (v as SafetyScenario) : null;
}

const MIN = 60000;

/**
 * Coherent ladder inputs that make `ladderLevel` return `scenario`, anchored to
 * the sol's back-by and sunset. Also returns the effective "now" so the rest of
 * the panel (beeper step, relay strip, crew position) lines up with the rung.
 */
export function scenarioLadderInput(
  scenario: SafetyScenario,
  sol: { backByMs: number; sunsetMs: number },
): { input: LadderInput; nowMs: number } {
  const { backByMs, sunsetMs } = sol;
  switch (scenario) {
    case 'ok':
      return {
        nowMs: backByMs - 120 * MIN,
        input: {
          nowMs: backByMs - 120 * MIN,
          backByMs,
          sunsetMs,
          projectedArrivalMs: backByMs - 20 * MIN,
          behindPaceMin: 0,
        },
      };
    case 'behind-pace':
      return {
        nowMs: backByMs - 40 * MIN,
        input: {
          nowMs: backByMs - 40 * MIN,
          backByMs,
          sunsetMs,
          projectedArrivalMs: backByMs + 15 * MIN,
          behindPaceMin: 12,
        },
      };
    case 'turn-back':
      return {
        nowMs: backByMs - 15 * MIN,
        input: {
          nowMs: backByMs - 15 * MIN,
          backByMs,
          sunsetMs,
          projectedArrivalMs: sunsetMs + 25 * MIN,
          behindPaceMin: 22,
        },
      };
    case 'return-to-shelter':
      return {
        nowMs: sunsetMs + 3 * MIN,
        input: {
          nowMs: sunsetMs + 3 * MIN,
          backByMs,
          sunsetMs,
          projectedArrivalMs: sunsetMs + 40 * MIN,
          behindPaceMin: 35,
          suitTimeLeftS: 40 * 60,
          timeToShelterS: 55 * 60,
        },
      };
  }
}

/**
 * Dev-only crew spread for the pair warning, `?pair=<metres>`: the second crew
 * member is moved that far east of the lead. Null when unset or in production.
 */
export function readPairSpread(search: string): number | null {
  if (!import.meta.env.DEV) return null;
  const v = Number(new URLSearchParams(search).get('pair'));
  return Number.isFinite(v) && v > 0 ? v : null;
}
