// Written with AI assistance, directed and reviewed by the team.

/**
 * SOS hold/cancel state machine (design: "SOS and relay scheduler").
 *
 * Hold for 2 s to arm, then a 10 s window to cancel; if it is not cancelled it
 * is sent. The reducer is pure (every transition takes an explicit `nowMs`), so
 * the timing can be tested at exact values. `createSosController` wraps it with
 * real timers for the UI and is testable under fake timers.
 *
 * On "sent": the always-on habitat link marks it received at once (the simulated
 * adapter's link is live), and the packet enters the relay queue at top priority
 * with the next orbiter pass and an estimated Earth arrival (see relayStrip.ts).
 */

/** Why the SOS was raised (design packet: injury, suit fault, lost, radiation). */
export type SosReason = 'injury' | 'suit-fault' | 'lost' | 'radiation';

export const SOS_REASONS: { id: SosReason; label: string }[] = [
  { id: 'injury', label: 'Injury' },
  { id: 'suit-fault', label: 'Suit fault' },
  { id: 'lost', label: 'Lost' },
  { id: 'radiation', label: 'Radiation' },
];

export type SosPhase = 'idle' | 'holding' | 'armed' | 'sent';

/** Hold time to arm, milliseconds. */
export const HOLD_MS = 2000;
/** Window to cancel after arming, milliseconds. */
export const CANCEL_WINDOW_MS = 10000;

export interface SosState {
  phase: SosPhase;
  reason: SosReason;
  /** When the current hold began (ms); null outside a hold. */
  holdStartMs: number | null;
  /** When arming completed (ms); null until armed. */
  armedAtMs: number | null;
  /** When the SOS was sent (ms); null until sent. */
  sentAtMs: number | null;
}

export type SosEvent =
  | { type: 'press'; nowMs: number }
  | { type: 'release'; nowMs: number }
  | { type: 'tick'; nowMs: number }
  | { type: 'cancel' }
  | { type: 'reason'; reason: SosReason }
  | { type: 'reset' };

export function initialSosState(reason: SosReason = 'injury'): SosState {
  return { phase: 'idle', reason, holdStartMs: null, armedAtMs: null, sentAtMs: null };
}

/** Pure transition. Unknown events for the current phase leave the state as is. */
export function sosReducer(state: SosState, event: SosEvent): SosState {
  switch (event.type) {
    case 'reason':
      // The reason can be set any time before it is sent.
      return state.phase === 'sent' ? state : { ...state, reason: event.reason };

    case 'reset':
      return initialSosState(state.reason);

    case 'cancel':
      return state.phase === 'holding' || state.phase === 'armed'
        ? { ...initialSosState(state.reason) }
        : state;

    case 'press':
      return state.phase === 'idle'
        ? { ...state, phase: 'holding', holdStartMs: event.nowMs }
        : state;

    case 'release':
      // Releasing before the hold completes aborts; once armed the arming latches.
      if (state.phase === 'holding') {
        const held = state.holdStartMs !== null && event.nowMs - state.holdStartMs >= HOLD_MS;
        return held
          ? { ...state, phase: 'armed', armedAtMs: state.holdStartMs! + HOLD_MS }
          : initialSosState(state.reason);
      }
      return state;

    case 'tick':
      if (state.phase === 'holding' && state.holdStartMs !== null) {
        if (event.nowMs - state.holdStartMs >= HOLD_MS) {
          return { ...state, phase: 'armed', armedAtMs: state.holdStartMs + HOLD_MS };
        }
        return state;
      }
      if (state.phase === 'armed' && state.armedAtMs !== null) {
        if (event.nowMs - state.armedAtMs >= CANCEL_WINDOW_MS) {
          return { ...state, phase: 'sent', sentAtMs: state.armedAtMs + CANCEL_WINDOW_MS };
        }
        return state;
      }
      return state;

    default:
      return state;
  }
}

/** Hold progress 0..1 while holding (1 once armed or sent). */
export function holdProgress(state: SosState, nowMs: number): number {
  if (state.phase === 'holding' && state.holdStartMs !== null) {
    return Math.min(1, Math.max(0, (nowMs - state.holdStartMs) / HOLD_MS));
  }
  return state.phase === 'armed' || state.phase === 'sent' ? 1 : 0;
}

/** Milliseconds left in the cancel window while armed (0 otherwise). */
export function cancelRemainingMs(state: SosState, nowMs: number): number {
  if (state.phase === 'armed' && state.armedAtMs !== null) {
    return Math.max(0, CANCEL_WINDOW_MS - (nowMs - state.armedAtMs));
  }
  return 0;
}

export interface SosController {
  getState(): SosState;
  press(): void;
  release(): void;
  cancel(): void;
  setReason(reason: SosReason): void;
  reset(): void;
  /** Stops the internal timer. */
  dispose(): void;
}

/**
 * Wraps the reducer with a 100 ms timer that drives `tick` while holding or
 * armed. `clock()` supplies the current time (injectable for tests); `onChange`
 * fires after every state change, and `onSent` fires once when the SOS is sent.
 */
export function createSosController(opts: {
  clock: () => number;
  onChange: (state: SosState) => void;
  onSent?: (state: SosState) => void;
  reason?: SosReason;
  tickMs?: number;
}): SosController {
  let state = initialSosState(opts.reason);
  let timer: ReturnType<typeof setInterval> | null = null;
  const tickMs = opts.tickMs ?? 100;

  function ensureTimer(): void {
    if (timer === null && (state.phase === 'holding' || state.phase === 'armed')) {
      timer = setInterval(() => dispatch({ type: 'tick', nowMs: opts.clock() }), tickMs);
    }
  }
  function stopTimer(): void {
    if (timer !== null && state.phase !== 'holding' && state.phase !== 'armed') {
      clearInterval(timer);
      timer = null;
    }
  }

  function dispatch(event: SosEvent): void {
    const prev = state;
    state = sosReducer(state, event);
    if (state !== prev) {
      opts.onChange(state);
      if (prev.phase !== 'sent' && state.phase === 'sent') opts.onSent?.(state);
    }
    ensureTimer();
    stopTimer();
  }

  return {
    getState: () => state,
    press: () => dispatch({ type: 'press', nowMs: opts.clock() }),
    release: () => dispatch({ type: 'release', nowMs: opts.clock() }),
    cancel: () => dispatch({ type: 'cancel' }),
    setReason: (reason: SosReason) => dispatch({ type: 'reason', reason }),
    reset: () => dispatch({ type: 'reset' }),
    dispose: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
