// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { buildHabitatAlert, createSimulatedHabitat } from './habitatAlert';

describe('buildHabitatAlert', () => {
  it('packs position, heading, pace and suit time left, rounded for the link', () => {
    const a = buildHabitatAlert({
      nowMs: 1000,
      trigger: 'arrival-after-sunset',
      crew: [
        { id: 'EV1', lon: 137.41234567, lat: -4.71234567, uncertaintyM: 12.4 },
        { id: 'EV2', lon: 137.4123, lat: -4.7123, uncertaintyM: 12.6 },
      ],
      headingDeg: 213.6,
      paceMS: 0.8333,
      suitTimeLeftS: 5400.4,
    });
    expect(a).toEqual({
      atMs: 1000,
      trigger: 'arrival-after-sunset',
      crew: [
        { id: 'EV1', lon: 137.412346, lat: -4.712346, uncertaintyM: 12 },
        { id: 'EV2', lon: 137.4123, lat: -4.7123, uncertaintyM: 13 },
      ],
      headingDeg: 214,
      paceMS: 0.83,
      suitTimeLeftS: 5400,
    });
  });

  it('wraps the heading into 0-359', () => {
    const a = buildHabitatAlert({
      nowMs: 0,
      trigger: 'out-at-back-by',
      crew: [],
      headingDeg: 359.7,
      paceMS: 1,
      suitTimeLeftS: 0,
    });
    expect(a.headingDeg).toBe(0);
  });
});

describe('createSimulatedHabitat', () => {
  const alert = buildHabitatAlert({
    nowMs: 0,
    trigger: 'out-at-back-by',
    crew: [],
    headingDeg: 0,
    paceMS: 1,
    suitTimeLeftS: 60,
  });

  it('receives an alert at once over a live link', () => {
    const hab = createSimulatedHabitat(() => 5000);
    expect(hab.send(alert, 'live')).toEqual({ received: true, atMs: 5000, seq: 1 });
    expect(hab.sent()).toEqual([alert]);
  });

  it('holds an alert while the link is lost, then receives the resend', () => {
    const hab = createSimulatedHabitat(() => 5000);
    expect(hab.send(alert, 'lost')).toEqual({ received: false, atMs: null, seq: 1 });
    expect(hab.sent()).toEqual([]);
    expect(hab.send(alert, 'live')).toEqual({ received: true, atMs: 5000, seq: 2 });
  });
});
