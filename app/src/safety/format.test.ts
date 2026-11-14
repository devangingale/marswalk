// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import {
  NBSP,
  MINUS,
  formatDuration,
  formatSignedMinutes,
  formatSignedDuration,
  formatDistance,
  formatUtcClock,
  formatLocalClock,
} from './format';

describe('formatDuration', () => {
  it('shows minutes under an hour', () => {
    expect(formatDuration(25 * 60000)).toBe(`25${NBSP}min`);
  });
  it('shows hours and minutes with a padded minute field', () => {
    expect(formatDuration((2 * 60 + 5) * 60000)).toBe(`2${NBSP}h 05${NBSP}min`);
  });
  it('drops the minute field on a whole hour', () => {
    expect(formatDuration(3 * 3600000)).toBe(`3${NBSP}h`);
  });
  it('floors sub-minute and negative values', () => {
    expect(formatDuration(20000)).toBe(`under${NBSP}1${NBSP}min`);
    expect(formatDuration(-5000)).toBe(`under${NBSP}1${NBSP}min`);
  });
});

describe('formatSignedMinutes', () => {
  it('uses a real minus sign for negatives', () => {
    expect(formatSignedMinutes(-12)).toBe(`${MINUS}12${NBSP}min`);
    expect(formatSignedMinutes(25)).toBe(`25${NBSP}min`);
  });
});

describe('formatSignedDuration', () => {
  it('rolls minutes into hours with a sign', () => {
    expect(formatSignedDuration(443)).toBe(`+7${NBSP}h 23${NBSP}min`);
    expect(formatSignedDuration(-20)).toBe(`${MINUS}20${NBSP}min`);
    expect(formatSignedDuration(0)).toBe(`0${NBSP}min`);
  });
});

describe('formatDistance', () => {
  it('uses whole metres under 1 km', () => {
    expect(formatDistance(840)).toBe(`840${NBSP}m`);
  });
  it('uses one decimal from 1 km', () => {
    expect(formatDistance(1800)).toBe(`1.8${NBSP}km`);
  });
});

describe('clocks', () => {
  it('formats a UTC clock to the minute', () => {
    expect(formatUtcClock(Date.UTC(2026, 10, 14, 7, 5))).toBe('07:05');
  });
  it('formats a Mars local clock as HH:MM', () => {
    // Gale (lon_east 137.44): a well-formed 24 h face, not the exact value here.
    const s = formatLocalClock(Date.UTC(2026, 10, 14, 12, 0), 137.44);
    expect(s).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});
