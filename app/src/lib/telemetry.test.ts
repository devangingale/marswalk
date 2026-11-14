// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { GridOrigin, localMetresToLonLat, MARS_R, degToRad, radToDeg } from './grid';
import { densifyLine, Plan } from './plan';
import { buildTrack, walkStateAt, pointAlong } from '../walk/track';
import { TelemetrySnapshot } from './telemetry';
import { createSimulatedAdapter, localMetreDistance, DEFAULT_ROVER_SPEED_M_S } from './telemetrySim';

const origin: GridOrigin = { lon0: 137.0, lat0: -5.0, lat_c: -5.0 };

function at(x_m: number, y_m: number): [number, number] {
  const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);
  return [lon, lat];
}

/** Out 100 m due east to s1 (125 s, dwell 600 s), back 100 m due west (125 s). Duration 850 s. */
function syntheticPlan(): Plan {
  const start = at(0, 0);
  const s1 = at(100, 0);
  return {
    version: 1,
    site: 'test',
    params: { crew: 2, time_limit_s: 3600, suit_mass_kg: 120, body_mass_kg: 80, stop_time_s: 600, solar_event: false },
    start: { lon: start[0], lat: start[1], label: 'Rover drop-off' },
    stops: [{ id: 's1', name: 'Ridge', lon: s1[0], lat: s1[1], dwell_s: 600 }],
    route: {
      legs: [
        { from: 'start', to: 's1', line: densifyLine([start, s1], origin), distance_m: 100, time_s: 125, climb_m: 0, descent_m: 0, energy_kj: 50, max_slope_deg: 0 },
        { from: 's1', to: 'start', line: densifyLine([s1, start], origin), distance_m: 100, time_s: 125, climb_m: 0, descent_m: 0, energy_kj: 40, max_slope_deg: 0 },
      ],
      returns_to_start: true,
      totals: { distance_m: 200, time_s: 850, climb_m: 0, descent_m: 0, energy_kj: 120, dose_mgy: 0.01 },
      turn_back: null,
      feasible: true,
      warnings: [],
    },
  };
}

const plan = syntheticPlan();
const track = buildTrack(plan, origin);

/** Sample a single snapshot at `elapsedMs` into the walk (clock starts at 0). */
function snapshotAt(elapsedMs: number, options?: Parameters<typeof createSimulatedAdapter>[3]): TelemetrySnapshot {
  let now = 0;
  const adapter = createSimulatedAdapter(plan, track, () => now, options); // t0 = 0
  now = elapsedMs;
  let snap: TelemetrySnapshot | null = null;
  const unsub = adapter.subscribe((s) => {
    snap = s;
  });
  unsub();
  if (snap === null) throw new Error('subscribe did not deliver a snapshot');
  return snap;
}

describe('simulated telemetry adapter: crew follow the planned track', () => {
  it('lead crew position at t equals pointAlong for the planned time', () => {
    const elapsedS = 62.5; // half-way out along the first leg
    const snap = snapshotAt(elapsedS * 1000);
    const alongM = walkStateAt(plan, track, elapsedS).alongM;
    const expected = pointAlong(track.vertices, 0, track.vertices.length - 1, alongM);
    expect(snap.crew[0].lon).toBe(expected.lon);
    expect(snap.crew[0].lat).toBe(expected.lat);
  });

  it('the second crew member trails 3 m behind the lead', () => {
    const elapsedS = 62.5;
    const snap = snapshotAt(elapsedS * 1000);
    const leadAlong = walkStateAt(plan, track, elapsedS).alongM;
    const trail = pointAlong(track.vertices, 0, track.vertices.length - 1, leadAlong - 3);
    expect(snap.crew).toHaveLength(2);
    expect(snap.crew[1].lon).toBe(trail.lon);
    expect(snap.crew[1].lat).toBe(trail.lat);
  });
});

describe('simulated telemetry adapter: suit consumables', () => {
  it('O2 is 100 % at the start', () => {
    const snap = snapshotAt(0);
    expect(snap.crew[0].suit.o2Pct).toBe(100);
    expect(snap.crew[0].suit.powerPct).toBe(100);
  });

  it('O2 is 0 % at the planned end plus the 1 h secondary O2', () => {
    const endPlusSecondaryMs = (track.durationS + 3600) * 1000;
    const snap = snapshotAt(endPlusSecondaryMs);
    expect(snap.crew[0].suit.o2Pct).toBe(0);
    expect(snap.crew[0].suit.powerPct).toBe(0);
  });
});

describe('simulated telemetry adapter: rover commands', () => {
  it('come_to_me returns an ETA from straight-line distance and the default speed', async () => {
    // Build a target exactly 920 m due east of the rover (the drop-off).
    const lat = plan.start.lat;
    const dLonDeg = radToDeg(920 / (MARS_R * Math.cos(degToRad(lat))));
    const target = { lon: plan.start.lon + dLonDeg, lat };

    // Sanity: this is exactly 920 m under the adapter's distance function.
    expect(localMetreDistance(plan.start, target)).toBeCloseTo(920, 6);

    const adapter = createSimulatedAdapter(plan, track, () => 0);
    const receipt = await adapter.command({ kind: 'come_to_me', lon: target.lon, lat: target.lat });
    expect(receipt.accepted).toBe(true);
    expect(receipt.etaS).toBeCloseTo(920 / DEFAULT_ROVER_SPEED_M_S, 6);
    expect(receipt.etaS).toBeCloseTo(220.8, 6); // 920 m at 15 km/h = 220.8 s
  });

  it('send_route with fewer than two points is rejected', async () => {
    const adapter = createSimulatedAdapter(plan, track, () => 0);
    const receipt = await adapter.command({ kind: 'send_route', route: [] });
    expect(receipt.accepted).toBe(false);
    expect(receipt.etaS).toBeNull();
  });
});

describe('simulated telemetry adapter: subscription', () => {
  it('unsubscribe stops callbacks', async () => {
    const adapter = createSimulatedAdapter(plan, track, () => 0);
    let count = 0;
    const unsub = adapter.subscribe(() => {
      count += 1;
    });
    expect(count).toBe(1); // immediate snapshot on subscribe
    unsub();
    await adapter.command({ kind: 'come_to_me', lon: plan.start.lon, lat: plan.start.lat });
    expect(count).toBe(1); // no further callbacks after unsubscribe

    // A still-subscribed callback does receive the command's snapshot.
    let live = 0;
    adapter.subscribe(() => {
      live += 1;
    });
    expect(live).toBe(1);
    await adapter.command({ kind: 'come_to_me', lon: plan.start.lon, lat: plan.start.lat });
    expect(live).toBe(2);
  });

  it('every value is marked simulated', () => {
    const adapter = createSimulatedAdapter(plan, track, () => 0);
    expect(adapter.simulated).toBe(true);
  });
});
