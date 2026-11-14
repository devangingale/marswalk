// Written with AI assistance, directed and reviewed by the team.

/**
 * Web Audio player for the daylight beeper (design: "Daylight beeper"). Tones
 * match the on-screen warning level and colour. No sound plays before a user
 * gesture: the AudioContext is created only in `resume()`, which the UI calls
 * from a click. Advisory tones can be muted; the turn-back and sunset tones can
 * only be acknowledged (the caller stops them when acknowledged, never mutes).
 *
 * Pure tones only (sine/triangle), short pips, never a continuous drone. DOM
 * guarded so it is inert under the node test environment and SSR.
 */

import type { LadderLevel } from './ladder';

interface ToneSpec {
  freqHz: number;
  type: OscillatorType;
  /** Pip length, seconds. */
  pipS: number;
  /** Gap between pips in a group, seconds. */
  gapS: number;
  /** Peak gain, 0..1. */
  gain: number;
}

/** One voice per warning level; higher and sharper as the level rises. */
const TONE: Record<LadderLevel, ToneSpec> = {
  ok: { freqHz: 523.25, type: 'sine', pipS: 0.12, gapS: 0.1, gain: 0.12 },
  'behind-pace': { freqHz: 587.33, type: 'sine', pipS: 0.14, gapS: 0.1, gain: 0.16 },
  'turn-back': { freqHz: 659.25, type: 'triangle', pipS: 0.18, gapS: 0.12, gain: 0.2 },
  'return-to-shelter': { freqHz: 880.0, type: 'triangle', pipS: 0.2, gapS: 0.12, gain: 0.24 },
};

export interface BeeperPlayer {
  /** True once the audio context is running (after a user gesture). */
  readonly ready: boolean;
  /** Create/resume the audio context. Call from a user gesture. */
  resume(): Promise<void>;
  /** Suspend the context without tearing it down. */
  suspend(): void;
  /** Play `tones` pips at the level's voice; if `repeating`, keep repeating. */
  play(level: LadderLevel, tones: number, repeating: boolean): void;
  /** Stop any repeating pattern. */
  stop(): void;
  dispose(): void;
}

function audioSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

export function createBeeperPlayer(): BeeperPlayer {
  let ctx: AudioContext | null = null;
  let repeatTimer: ReturnType<typeof setInterval> | null = null;

  function clearRepeat(): void {
    if (repeatTimer !== null) {
      clearInterval(repeatTimer);
      repeatTimer = null;
    }
  }

  function group(level: LadderLevel, tones: number): void {
    if (!ctx || ctx.state !== 'running') return;
    const t = TONE[level];
    const start = ctx.currentTime;
    for (let i = 0; i < tones; i++) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = t.type;
      osc.frequency.value = t.freqHz;
      const at = start + i * (t.pipS + t.gapS);
      // Short attack/decay envelope so pips never click.
      gainNode.gain.setValueAtTime(0.0001, at);
      gainNode.gain.exponentialRampToValueAtTime(t.gain, at + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, at + t.pipS);
      osc.connect(gainNode).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + t.pipS + 0.02);
    }
  }

  return {
    get ready(): boolean {
      return ctx !== null && ctx.state === 'running';
    },
    async resume(): Promise<void> {
      if (!audioSupported()) return;
      if (ctx === null) ctx = new window.AudioContext();
      if (ctx.state !== 'running') await ctx.resume();
    },
    suspend(): void {
      clearRepeat();
      void ctx?.suspend();
    },
    play(level: LadderLevel, tones: number, repeating: boolean): void {
      clearRepeat();
      group(level, tones);
      if (repeating) {
        // Repeat the group on a steady cadence; urgency comes from the voice, not speed.
        repeatTimer = setInterval(() => group(level, tones), level === 'return-to-shelter' ? 1400 : 1800);
      }
    },
    stop(): void {
      clearRepeat();
    },
    dispose(): void {
      clearRepeat();
      void ctx?.close();
      ctx = null;
    },
  };
}
