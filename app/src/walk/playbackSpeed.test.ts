import { describe, expect, it } from 'vitest';
import {
  advanceElapsed,
  cycleSpeed,
  DEFAULT_SPEED,
  loadSpeed,
  parseSpeed,
  PLAYBACK_SPEEDS,
  saveSpeed,
  speedLabel,
  SPEED_STORAGE_KEY,
  stepSpeed,
} from './playbackSpeed';
import { playbackKeyAction } from './playbackKeys';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
}

const throwing = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

describe('playback speed', () => {
  it('offers ×1 to ×60 and defaults to ×10', () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 5, 10, 30, 60]);
    expect(DEFAULT_SPEED).toBe(10);
    expect(loadSpeed(memoryStorage())).toBe(10);
    expect(speedLabel(1)).toBe('×1');
  });

  it('remembers the speed and survives blocked or bad storage', () => {
    const storage = memoryStorage();
    saveSpeed(30, storage);
    expect(storage.data.get(SPEED_STORAGE_KEY)).toBe('30');
    expect(loadSpeed(storage)).toBe(30);
    expect(loadSpeed(memoryStorage({ [SPEED_STORAGE_KEY]: '7' }))).toBe(10);
    expect(loadSpeed(memoryStorage({ [SPEED_STORAGE_KEY]: 'fast' }))).toBe(10);
    expect(loadSpeed(throwing)).toBe(10);
    expect(() => saveSpeed(5, throwing)).not.toThrow();
    expect(loadSpeed(null)).toBe(10);
    expect(parseSpeed(60)).toBe(60);
  });

  it('steps slower and faster, held at ×1 and ×60', () => {
    expect(stepSpeed(10, -1)).toBe(5);
    expect(stepSpeed(10, 1)).toBe(30);
    expect(stepSpeed(1, -1)).toBe(1);
    expect(stepSpeed(60, 1)).toBe(60);
  });

  it('cycles through every speed and wraps to ×1 (Visor button)', () => {
    expect(cycleSpeed(1)).toBe(5);
    expect(cycleSpeed(30)).toBe(60);
    expect(cycleSpeed(60)).toBe(1);
  });

  it('advances elapsed walk time by dt × speed, held at the end', () => {
    expect(advanceElapsed(100, 0.5, 10, 1000)).toBe(105);
    expect(advanceElapsed(100, 2, 1, 1000)).toBe(102);
    expect(advanceElapsed(100, 0.25, 60, 1000)).toBe(115);
    expect(advanceElapsed(990, 1, 60, 1000)).toBe(1000);
    expect(advanceElapsed(100, -1, 10, 1000)).toBe(100);
  });

  it('a speed change mid-playback continues from the same position', () => {
    // 1 s at ×10, then the user picks ×60, then 1 s more: no jump at the change.
    const atChange = advanceElapsed(0, 1, 10, 10_000);
    expect(atChange).toBe(10);
    expect(advanceElapsed(atChange, 0, 60, 10_000)).toBe(10);
    expect(advanceElapsed(atChange, 1, 60, 10_000)).toBe(70);
  });

  it('- and [ slow down, + = and ] speed up, never inside a text field', () => {
    for (const key of ['-', '_', '[']) expect(playbackKeyAction(key, null, true)).toBe('slower');
    for (const key of ['+', '=', ']']) expect(playbackKeyAction(key, null, false)).toBe('faster');
    expect(playbackKeyAction('-', { tagName: 'INPUT', type: 'number' }, true)).toBeNull();
    expect(playbackKeyAction('ArrowLeft', null, true)).toBe('step-back');
    expect(playbackKeyAction('PageDown', null, true)).toBe('next-stop');
  });
});
