// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { MARS_R } from '../lib/grid';
import type { TrackVertex } from '../walk/track';
import { distanceBearing, nightReturnRoute, nextHazardOnReturn, nightShelter, nightTrigger } from './navigate';

const M_PER_DEG = (MARS_R * Math.PI) / 180;

/** A straight track due north from the equator, one vertex every 100 m. */
function northTrack(n: number): TrackVertex[] {
  return Array.from({ length: n }, (_, i) => ({
    lon: 0,
    lat: (i * 100) / M_PER_DEG,
    x_m: 0,
    y_m: i * 100,
    along_m: i * 100,
  }));
}

describe('distanceBearing', () => {
  it('is 100 m due east', () => {
    const r = distanceBearing({ lon: 0, lat: 0 }, { lon: 100 / M_PER_DEG, lat: 0 });
    expect(r.distanceM).toBeCloseTo(100, 6);
    expect(r.bearingDeg).toBeCloseTo(90, 6);
  });

  it('is 100 m due south', () => {
    const r = distanceBearing({ lon: 0, lat: 0 }, { lon: 0, lat: -100 / M_PER_DEG });
    expect(r.distanceM).toBeCloseTo(100, 6);
    expect(r.bearingDeg).toBeCloseTo(180, 6);
  });

  it('is 0 m and 0 degrees to itself', () => {
    expect(distanceBearing({ lon: 5, lat: 5 }, { lon: 5, lat: 5 })).toEqual({ distanceM: 0, bearingDeg: 0 });
  });
});

describe('nightReturnRoute', () => {
  it('reverses the walked track from the current position', () => {
    const track = northTrack(5); // 0..400 m
    const here = { lon: 0, lat: 250 / M_PER_DEG };
    const r = nightReturnRoute(track, 250, here);
    expect(r.line.map((p) => Math.round(p.lat * M_PER_DEG))).toEqual([250, 200, 100, 0]);
    expect(r.line[0]).toEqual(here);
    expect(r.lengthM).toBeCloseTo(250, 6);
  });

  it('skips a vertex the crew is standing on', () => {
    const track = northTrack(5);
    const r = nightReturnRoute(track, 200, { lon: 0, lat: 200 / M_PER_DEG });
    expect(r.line.map((p) => Math.round(p.lat * M_PER_DEG))).toEqual([200, 100, 0]);
    expect(r.lengthM).toBeCloseTo(200, 6);
  });

  it('starts from the reported fix, not the track, when they differ', () => {
    const track = northTrack(3);
    const here = { lon: 30 / M_PER_DEG, lat: 150 / M_PER_DEG }; // 30 m east of the track at 150 m
    const r = nightReturnRoute(track, 150, here);
    expect(r.line[0]).toEqual(here);
    // 30 m east and 50 m south back to the 100 m vertex, then 100 m to the start.
    expect(r.lengthM).toBeCloseTo(Math.hypot(30, 50) + 100, 3);
  });

  it('is the single point at the start', () => {
    const track = northTrack(3);
    const r = nightReturnRoute(track, 0, { lon: 0, lat: 0 });
    expect(r.line).toEqual([{ lon: 0, lat: 0 }]);
    expect(r.lengthM).toBe(0);
  });
});

describe('nextHazardOnReturn', () => {
  const track = northTrack(6); // 0..500 m

  it('finds the nearest flagged vertex behind the crew', () => {
    const flags = [false, true, false, true, false, false];
    const r = nextHazardOnReturn(track, flags, 450);
    expect(r).not.toBeNull();
    expect(r!.alongReturnM).toBeCloseTo(150, 6);
    expect(Math.round(r!.lat * M_PER_DEG)).toBe(300);
  });

  it('counts a hazard at the crew position as zero ahead', () => {
    const flags = [false, false, false, true, false, false];
    expect(nextHazardOnReturn(track, flags, 300)!.alongReturnM).toBe(0);
  });

  it('ignores hazards still ahead on the outward route', () => {
    const flags = [false, false, false, false, true, true];
    expect(nextHazardOnReturn(track, flags, 350)).toBeNull();
  });

  it('is null without flags', () => {
    expect(nextHazardOnReturn(track, [], 300)).toBeNull();
  });
});

describe('nightTrigger', () => {
  const base = { minutesToBackBy: 30, arrivalAfterSunsetMin: -10 };

  it('is off while the crew is due back before sunset and before back-by', () => {
    expect(nightTrigger(base)).toBeNull();
  });

  it('triggers on a projected arrival after sunset', () => {
    expect(nightTrigger({ ...base, arrivalAfterSunsetMin: 25 })).toBe('arrival-after-sunset');
  });

  it('does not trigger on arrival exactly at sunset', () => {
    expect(nightTrigger({ ...base, arrivalAfterSunsetMin: 0 })).toBeNull();
  });

  it('triggers when the crew is still out at back-by', () => {
    expect(nightTrigger({ ...base, minutesToBackBy: 0 })).toBe('out-at-back-by');
    expect(nightTrigger({ minutesToBackBy: -5, arrivalAfterSunsetMin: 40 })).toBe('out-at-back-by');
  });
});

describe('nightShelter', () => {
  const sites = [
    { id: 'dropoff', alongM: 0 },
    { id: 'node', alongM: 300 },
    { id: 'off-track', alongM: null },
  ];

  it('picks the nearest shelter behind the crew on the walked track', () => {
    expect(nightShelter(sites, 450)!.id).toBe('node');
  });

  it('falls back to the drop-off before the crew reaches a node', () => {
    expect(nightShelter(sites, 250)!.id).toBe('dropoff');
  });

  it('counts a shelter the crew is standing at', () => {
    expect(nightShelter(sites, 300)!.id).toBe('node');
  });

  it('is null when no shelter is on the walked track', () => {
    expect(nightShelter([{ id: 'off-track', alongM: null }], 450)).toBeNull();
  });
});
