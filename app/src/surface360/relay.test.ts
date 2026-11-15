// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { relayStatus, type PassBundle } from './relay';

const bundle: PassBundle = {
  site: 'gale',
  lat: -4.5895,
  lon_east: 137.4417,
  window: { start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z' },
  passes: [
    { orbiter: 'MRO', rise_utc: '2026-11-01T01:00:00Z', set_utc: '2026-11-01T01:10:00Z', peak_utc: '2026-11-01T01:05:00Z', peak_elevation_deg: 40, duration_s: 600 },
    { orbiter: 'ODY', rise_utc: '2026-11-01T03:00:00Z', set_utc: '2026-11-01T03:12:00Z', peak_utc: '2026-11-01T03:06:00Z', peak_elevation_deg: 22, duration_s: 720 },
  ],
};
const at = (iso: string) => Date.parse(iso);

describe('relayStatus', () => {
  it('finds the next pass and the time until it rises', () => {
    const s = relayStatus(bundle, at('2026-11-01T00:30:00Z'));
    expect(s).toMatchObject({ kind: 'upcoming', pass: { orbiter: 'MRO' }, risesInS: 1800 });
  });

  it('reports a pass in progress with the time until it sets', () => {
    expect(relayStatus(bundle, at('2026-11-01T03:02:00Z'))).toMatchObject({ kind: 'overhead', pass: { orbiter: 'ODY' }, setsInS: 600 });
  });

  it('says when the clock is outside the computed window, rather than guessing', () => {
    expect(relayStatus(bundle, at('2027-01-01T00:00:00Z')).kind).toBe('outside-window');
    expect(relayStatus(bundle, at('2026-11-01T05:00:00Z')).kind).toBe('outside-window');
  });
});
