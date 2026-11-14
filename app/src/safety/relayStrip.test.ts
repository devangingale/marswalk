// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { parsePasses, relayStripModel, simulatedRelayQueue, sosEarthArrival, type PassesFile } from './relayStrip';

const file: PassesFile = {
  version: 1,
  site: 'gale',
  lat: -4.5895,
  lon_east: 137.4417,
  min_elevation_deg: 10,
  orbiters: ['MRO', 'ODY'],
  passes: [
    {
      orbiter: 'ODY',
      rise_utc: '2026-11-14T06:00:00Z',
      set_utc: '2026-11-14T06:08:00Z',
      peak_utc: '2026-11-14T06:04:00Z',
      peak_elevation_deg: 40,
      duration_s: 480,
    },
    {
      orbiter: 'MRO',
      rise_utc: '2026-11-14T08:00:00Z',
      set_utc: '2026-11-14T08:07:00Z',
      peak_utc: '2026-11-14T08:03:30Z',
      peak_elevation_deg: 23,
      duration_s: 420,
    },
  ],
};

describe('parsePasses', () => {
  it('maps ISO strings to epoch ms', () => {
    const passes = parsePasses(file);
    expect(passes[0].riseUtcMs).toBe(Date.parse('2026-11-14T06:00:00Z'));
    expect(passes[1].orbiter).toBe('MRO');
  });
});

describe('relayStripModel', () => {
  const passes = parsePasses(file);

  it('reports the next upcoming pass with minutes until', () => {
    const m = relayStripModel({
      passes,
      nowMs: Date.parse('2026-11-14T05:40:00Z'),
      lonEastDeg: file.lon_east,
      habitat: 'live',
      queued: 38,
    });
    expect(m.habitat).toBe('live');
    expect(m.nextPass?.orbiter).toBe('ODY');
    expect(m.nextPass?.minutesUntil).toBe(20);
    expect(m.nextPass?.open).toBe(false);
    expect(m.queued).toBe(38);
  });

  it('marks a pass open when now is inside it, with zero minutes until', () => {
    const m = relayStripModel({
      passes,
      nowMs: Date.parse('2026-11-14T06:03:00Z'),
      lonEastDeg: file.lon_east,
      habitat: 'live',
      queued: 0,
    });
    expect(m.nextPass?.orbiter).toBe('ODY');
    expect(m.nextPass?.open).toBe(true);
    expect(m.nextPass?.minutesUntil).toBe(0);
  });

  it('returns no next pass once the window is behind us', () => {
    const m = relayStripModel({
      passes,
      nowMs: Date.parse('2026-11-14T09:00:00Z'),
      lonEastDeg: file.lon_east,
      habitat: 'lost',
      queued: 2,
    });
    expect(m.nextPass).toBeNull();
    expect(m.habitat).toBe('lost');
  });
});

describe('sosEarthArrival', () => {
  const passes = parsePasses(file);

  it('sends on the next pass and adds one light time', () => {
    const est = sosEarthArrival(passes, Date.parse('2026-11-14T05:40:00Z'), file.lon_east);
    expect(est).not.toBeNull();
    expect(est!.pass.orbiter).toBe('ODY');
    expect(est!.lightMin).toBeGreaterThan(2);
    expect(est!.lightMin).toBeLessThan(23);
    expect(est!.earthUtcHhmm).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });

  it('is null when no pass remains', () => {
    expect(sosEarthArrival(passes, Date.parse('2026-11-14T10:00:00Z'), file.lon_east)).toBeNull();
  });
});

describe('simulatedRelayQueue', () => {
  const start = Date.parse('2026-11-14T06:00:00Z');

  it('starts with a few items: the departure fix and the fixes since', () => {
    const q = simulatedRelayQueue({ startMs: start, nowMs: start + 60000, warning: null, sosAtMs: null });
    expect(q).toHaveLength(3);
    expect(q.every((i) => i.kind === 'position')).toBe(true);
  });

  it('adds one fix every 30 s, with no cap', () => {
    const q = simulatedRelayQueue({ startMs: start, nowMs: start + 3600000, warning: null, sosAtMs: null });
    expect(q).toHaveLength(121);
  });

  it('queues the latest warning ahead of positions, and the SOS ahead of all', () => {
    const q = simulatedRelayQueue({ startMs: start, nowMs: start + 30000, warning: 'turn-back', sosAtMs: start + 30000 });
    expect(q.map((i) => i.kind)).toEqual(['sos', 'warning', 'position', 'position']);
  });
});
