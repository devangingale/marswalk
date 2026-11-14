// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDistanceKm,
  formatDose,
  formatDust,
  formatElevation,
  formatLat,
  formatLatLon,
  formatLon,
  formatScore,
  scoreBucket,
} from './format';

describe('coordinates', () => {
  it('formats a southern latitude', () => {
    expect(formatLat(-13.5938)).toBe('13.5938° S');
  });
  it('formats a northern latitude', () => {
    expect(formatLat(47.6673)).toBe('47.6673° N');
  });
  it('formats a western longitude', () => {
    expect(formatLon(-58.4688)).toBe('58.4688° W');
  });
  it('formats an eastern longitude', () => {
    expect(formatLon(134.2809)).toBe('134.2809° E');
  });
  it('joins latitude and longitude', () => {
    expect(formatLatLon(18.4447, 77.451)).toBe('18.4447° N, 77.4510° E');
  });
});

describe('formatScore', () => {
  it('rounds to a whole number', () => {
    expect(formatScore(77.96)).toBe('78');
    expect(formatScore(59.33)).toBe('59');
  });
});

describe('scoreBucket', () => {
  it('splits 0-100 into five even bands', () => {
    expect(scoreBucket(0)).toBe(0);
    expect(scoreBucket(19.9)).toBe(0);
    expect(scoreBucket(20)).toBe(1);
    expect(scoreBucket(59.82)).toBe(2);
    expect(scoreBucket(80)).toBe(4);
    expect(scoreBucket(100)).toBe(4);
  });
});

describe('evidence numbers', () => {
  it('shows one decimal for short ice distances', () => {
    expect(formatDistanceKm(0.521)).toBe('0.5');
    expect(formatDistanceKm(2.4)).toBe('2.4');
  });
  it('groups long distances to whole km', () => {
    expect(formatDistanceKm(36.183)).toBe('36');
    expect(formatDistanceKm(2406.14)).toBe('2,406');
  });
  it('rounds radiation dose to a whole number', () => {
    expect(formatDose(258.959)).toBe('259');
  });
  it('shows dust p95 to two decimals', () => {
    expect(formatDust(0.407)).toBe('0.41');
  });
  it('shows signed, grouped elevation', () => {
    expect(formatElevation(-5183)).toBe('-5,183');
    expect(formatElevation(1683.375)).toBe('1,683');
  });
  it('shows whole counts', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(6)).toBe('6');
  });
});
