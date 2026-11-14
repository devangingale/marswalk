// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sosReducer,
  initialSosState,
  holdProgress,
  cancelRemainingMs,
  createSosController,
  HOLD_MS,
  CANCEL_WINDOW_MS,
  type SosState,
} from './sos';

describe('sosReducer (pure, exact times)', () => {
  it('arms only after a full 2 s hold', () => {
    let s = initialSosState();
    s = sosReducer(s, { type: 'press', nowMs: 0 });
    expect(s.phase).toBe('holding');
    s = sosReducer(s, { type: 'tick', nowMs: 1999 });
    expect(s.phase).toBe('holding');
    s = sosReducer(s, { type: 'tick', nowMs: 2000 });
    expect(s.phase).toBe('armed');
    expect(s.armedAtMs).toBe(HOLD_MS);
  });

  it('aborts when the button is released before 2 s', () => {
    let s = sosReducer(initialSosState(), { type: 'press', nowMs: 0 });
    s = sosReducer(s, { type: 'release', nowMs: 1200 });
    expect(s.phase).toBe('idle');
    expect(s.holdStartMs).toBeNull();
  });

  it('latches armed if released after 2 s', () => {
    let s = sosReducer(initialSosState(), { type: 'press', nowMs: 0 });
    s = sosReducer(s, { type: 'release', nowMs: 2500 });
    expect(s.phase).toBe('armed');
  });

  it('sends after the 10 s cancel window and not before', () => {
    let s: SosState = { phase: 'armed', reason: 'injury', holdStartMs: 0, armedAtMs: 2000, sentAtMs: null };
    s = sosReducer(s, { type: 'tick', nowMs: 2000 + CANCEL_WINDOW_MS - 1 });
    expect(s.phase).toBe('armed');
    s = sosReducer(s, { type: 'tick', nowMs: 2000 + CANCEL_WINDOW_MS });
    expect(s.phase).toBe('sent');
    expect(s.sentAtMs).toBe(2000 + CANCEL_WINDOW_MS);
  });

  it('cancels within the window and returns to idle', () => {
    let s: SosState = { phase: 'armed', reason: 'lost', holdStartMs: 0, armedAtMs: 2000, sentAtMs: null };
    s = sosReducer(s, { type: 'cancel' });
    expect(s.phase).toBe('idle');
    expect(s.reason).toBe('lost'); // the chosen reason survives a cancel
  });

  it('keeps the reason change until it is sent, then freezes it', () => {
    let s = sosReducer(initialSosState(), { type: 'reason', reason: 'radiation' });
    expect(s.reason).toBe('radiation');
    s = { ...s, phase: 'sent', sentAtMs: 1 };
    s = sosReducer(s, { type: 'reason', reason: 'injury' });
    expect(s.reason).toBe('radiation');
  });

  it('reports hold progress and cancel countdown', () => {
    const holding: SosState = { phase: 'holding', reason: 'injury', holdStartMs: 0, armedAtMs: null, sentAtMs: null };
    expect(holdProgress(holding, 1000)).toBeCloseTo(0.5);
    const armed: SosState = { phase: 'armed', reason: 'injury', holdStartMs: 0, armedAtMs: 2000, sentAtMs: null };
    expect(cancelRemainingMs(armed, 2000 + 4000)).toBe(6000);
  });
});

describe('createSosController (fake timers)', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms after 2 s and sends after a further 10 s with no cancel', () => {
    const states: string[] = [];
    let sent = false;
    const c = createSosController({
      clock,
      onChange: (s) => states.push(s.phase),
      onSent: () => {
        sent = true;
      },
    });

    c.press();
    // advance 2 s of real + fake time together
    for (let t = 0; t < 2000; t += 100) {
      now += 100;
      vi.advanceTimersByTime(100);
    }
    expect(c.getState().phase).toBe('armed');
    expect(sent).toBe(false);

    for (let t = 0; t < 10000; t += 100) {
      now += 100;
      vi.advanceTimersByTime(100);
    }
    expect(c.getState().phase).toBe('sent');
    expect(sent).toBe(true);
    expect(states).toContain('holding');
    expect(states).toContain('armed');
    c.dispose();
  });

  it('cancels in the window and never sends', () => {
    let sent = false;
    const c = createSosController({ clock, onChange: () => {}, onSent: () => (sent = true) });
    c.press();
    for (let t = 0; t < 2000; t += 100) {
      now += 100;
      vi.advanceTimersByTime(100);
    }
    expect(c.getState().phase).toBe('armed');
    now += 3000;
    vi.advanceTimersByTime(3000);
    c.cancel();
    now += 10000;
    vi.advanceTimersByTime(10000);
    expect(c.getState().phase).toBe('idle');
    expect(sent).toBe(false);
    c.dispose();
  });
});
