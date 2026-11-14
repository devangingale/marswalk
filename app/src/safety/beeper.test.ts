// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { beeperSchedule, currentBeeperStep, stepCrossed } from './beeper';

const MIN = 60000;
const backByMs = Date.UTC(2026, 10, 14, 17, 30);
const sunsetMs = Date.UTC(2026, 10, 14, 18, 0);

describe('beeperSchedule', () => {
  const schedule = beeperSchedule(backByMs, sunsetMs);

  it('has the four steps at the right times and levels', () => {
    expect(schedule.map((s) => s.id)).toEqual(['back-by-60', 'back-by-30', 'back-by', 'sunset']);
    expect(schedule[0].atMs).toBe(backByMs - 60 * MIN);
    expect(schedule[1].atMs).toBe(backByMs - 30 * MIN);
    expect(schedule[2].atMs).toBe(backByMs);
    expect(schedule[3].atMs).toBe(sunsetMs);
  });

  it('makes the two advisory steps mutable and the hard steps acknowledge-only', () => {
    expect(schedule[0].tones).toBe(1);
    expect(schedule[0].control).toBe('mutable');
    expect(schedule[1].tones).toBe(2);
    expect(schedule[1].control).toBe('mutable');
    expect(schedule[2].repeating).toBe(true);
    expect(schedule[2].control).toBe('acknowledge');
    expect(schedule[3].repeating).toBe(true);
    expect(schedule[3].control).toBe('acknowledge');
  });
});

describe('currentBeeperStep', () => {
  const schedule = beeperSchedule(backByMs, sunsetMs);

  it('is null before the first step', () => {
    expect(currentBeeperStep(schedule, backByMs - 90 * MIN)).toBeNull();
  });

  it('picks the latest step that has arrived', () => {
    expect(currentBeeperStep(schedule, backByMs - 45 * MIN)?.id).toBe('back-by-60');
    expect(currentBeeperStep(schedule, backByMs - 10 * MIN)?.id).toBe('back-by-30');
    expect(currentBeeperStep(schedule, backByMs + 5 * MIN)?.id).toBe('back-by');
    expect(currentBeeperStep(schedule, sunsetMs + 5 * MIN)?.id).toBe('sunset');
  });

  it('falls back to the previous live step when the latest is acknowledged', () => {
    const acked = new Set(['sunset']);
    expect(currentBeeperStep(schedule, sunsetMs + 5 * MIN, acked)?.id).toBe('back-by');
  });
});

describe('stepCrossed', () => {
  const schedule = beeperSchedule(backByMs, sunsetMs);

  it('reports a boundary crossed in the interval, inclusive of now', () => {
    expect(stepCrossed(schedule, backByMs - 61 * MIN, backByMs - 59 * MIN)?.id).toBe('back-by-60');
    expect(stepCrossed(schedule, backByMs, sunsetMs)?.id).toBe('sunset');
  });

  it('reports nothing when no boundary falls inside', () => {
    expect(stepCrossed(schedule, backByMs - 50 * MIN, backByMs - 40 * MIN)).toBeNull();
  });
});
