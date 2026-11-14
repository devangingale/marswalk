// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { ageLabel, dustSeason } from './ConditionsPanel';

const DAY = 86_400_000;

describe('ageLabel', () => {
  it('says "just now" under a minute', () => {
    expect(ageLabel(0, 0)).toBe('just now');
    expect(ageLabel(59_000, 0)).toBe('just now');
  });

  it('reports whole minutes under an hour', () => {
    expect(ageLabel(60_000, 0)).toBe('1 min ago');
    expect(ageLabel(30 * 60_000, 0)).toBe('30 min ago');
    expect(ageLabel(59 * 60_000, 0)).toBe('59 min ago');
  });

  it('reports whole hours under a day', () => {
    expect(ageLabel(3_600_000, 0)).toBe('1 h ago');
    expect(ageLabel(90 * 60_000, 0)).toBe('1 h ago');
    expect(ageLabel(23 * 3_600_000, 0)).toBe('23 h ago');
  });

  it('reports whole days, singular at one', () => {
    expect(ageLabel(DAY, 0)).toBe('1 day ago');
    expect(ageLabel(2 * DAY, 0)).toBe('2 days ago');
  });

  it('matches the panel example: 2026-08-25 read on 2026-11-14 is 81 days', () => {
    expect(ageLabel(Date.UTC(2026, 10, 14), Date.UTC(2026, 7, 25))).toBe('81 days ago');
  });
});

describe('dustSeason', () => {
  it('is low-dust through northern spring and summer (Ls 0-180)', () => {
    expect(dustSeason(0)).toEqual({ label: 'low-dust season', dusty: false });
    expect(dustSeason(90)).toEqual({ label: 'low-dust season', dusty: false });
    expect(dustSeason(179.9)).toEqual({ label: 'low-dust season', dusty: false });
  });

  it('is dust-storm season from Ls 180 to 360', () => {
    expect(dustSeason(180)).toEqual({ label: 'dust storm season', dusty: true });
    expect(dustSeason(251)).toEqual({ label: 'dust storm season', dusty: true });
    expect(dustSeason(359.9)).toEqual({ label: 'dust storm season', dusty: true });
  });

  it('wraps at 360 and normalises out-of-range values', () => {
    expect(dustSeason(360)).toEqual({ label: 'low-dust season', dusty: false });
    expect(dustSeason(540)).toEqual({ label: 'dust storm season', dusty: true });
    expect(dustSeason(-10)).toEqual({ label: 'dust storm season', dusty: true });
  });
});
