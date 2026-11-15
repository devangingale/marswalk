// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import published from '../../public/panoramas.json';
import { geodesicBearingDeg, geodesicM } from './geodesic';
import {
  bearingDeg,
  clampFov,
  columnForBearing,
  distanceM,
  enuDirection,
  frameHeadingDeg,
  loadManifest,
  nearestStop,
  panoramaSources,
  parseManifest,
  stopById,
  stopLonLat,
  traverseOf,
  traverses,
  type PanoramaManifest,
  type PanoramaStop,
} from './panoramas';

const stop = (id: string, prev: string | null, next: string | null, lon = 0, lat = 0): PanoramaStop => ({
  id,
  name: id,
  rover: 'Curiosity',
  mission: 'Mars Science Laboratory',
  sol: 1,
  sol_end: null,
  sol_source: 'caption',
  pose_sol: 1,
  position_source: 'gale_poses.csv, sol 1',
  lat,
  lon_east: lon,
  height: 0,
  heading: 0,
  heading_source: 'rover yaw, sol 1',
  horizon_offset_deg: 0,
  horizon_source: 'curated',
  pitch: 0,
  roll: 0,
  image_url: `./${id}.jpg`,
  image_url_hi: null,
  image_hi_width: null,
  walkability: null,
  slope_deg: null,
  walkability_source: null,
  passes_url: null,
  next_id: next,
  prev_id: prev,
  drive_m_to_next: null,
  pia_id: 'PIA00000',
  instrument: 'Mastcam',
  caption: 'caption',
  credit: 'NASA/JPL-Caltech/MSSS',
  source_url: 'https://science.nasa.gov/photojournal/',
});

const real = parseManifest(published)!;

describe('parseManifest', () => {
  it('accepts the manifest build_panoramas.py published', () => {
    expect(real).not.toBeNull();
    const rovers = new Set(real.stops.map((s) => s.rover));
    expect([...rovers].sort()).toEqual(['Curiosity', 'Opportunity', 'Perseverance', 'Spirit']);
    expect(new Set(real.stops.map((s) => s.pia_id)).size).toBe(real.stops.length);
    for (const s of real.stops) {
      expect(s.caption.length).toBeGreaterThan(40);
      expect(s.credit).toMatch(/^NASA\/JPL/); // e.g. NASA/JPL-Caltech/MSSS, NASA/JPL/Cornell
      expect(s.source_url).toBe(`https://photojournal.jpl.nasa.gov/catalog/${s.pia_id}`);
    }
    // PIA20840's caption states its pointing ("south is in the center").
    expect(stopById(real, 'gale_1451')).toMatchObject({ pia_id: 'PIA20840', heading: 180, heading_source: 'caption' });
    // Spirit's traverse has no elevation: shown as unknown, never as 0.
    expect(real.stops.filter((s) => s.rover === 'Spirit').every((s) => s.height === null)).toBe(true);
  });

  it('allows null walkability and passes, and rejects bad values, missing fields and duplicate ids', () => {
    const good = stop('a', null, null);
    expect(parseManifest({ stops: [good] })).not.toBeNull();
    expect(parseManifest({ stops: [{ ...good, walkability: 'risky' }] })).toBeNull();
    expect(parseManifest({ stops: [{ ...good, pia_id: undefined }] })).toBeNull();
    expect(parseManifest({ stops: [{ ...good, drive_m_to_next: '2 km' }] })).toBeNull();
    expect(parseManifest({ stops: [good, good] })).toBeNull();
    expect(parseManifest({ stops: [] })).toBeNull();
    expect(parseManifest('<!doctype html>')).toBeNull();
  });
});

describe('panoramaSources', () => {
  it('uses R2 first in production, then the copy bundled with the app', () => {
    expect(panoramaSources({ DEV: false }, 'https://cdn.example')).toEqual(['https://cdn.example/panoramas.json', '/panoramas.json']);
  });

  it('falls back to the bundled copy (2048 px textures) when R2 is not configured, and uses it in development', () => {
    expect(panoramaSources({ DEV: false }, '')).toEqual(['/panoramas.json']);
    expect(panoramaSources({ DEV: true }, 'https://cdn.example')).toEqual(['/panoramas.json']);
    expect(panoramaSources({ DEV: false, VITE_PANORAMAS_URL: '/x.json' }, '')).toEqual(['/x.json', '/panoramas.json']);
  });
});

describe('loadManifest', () => {
  it('fails with every reason when no source loads', async () => {
    const html = (async () => new Response('<!doctype html>', { status: 200 })) as unknown as typeof fetch;
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(loadManifest('/panoramas.json', html)).rejects.toThrow('not JSON');
    await expect(loadManifest(['/a.json', '/b.json'], missing)).rejects.toThrow(/a\.json: HTTP 404.*b\.json: HTTP 404/);
  });

  it('falls back to the next source when R2 is unreachable, resolving images against the one that loaded', async () => {
    const body = JSON.stringify({ stops: [stop('a', null, null)] });
    const fetcher = (async (url: string) =>
      url.startsWith('https://cdn.example') ? new Response('', { status: 503 }) : new Response(body, { status: 200 })) as unknown as typeof fetch;
    const loaded = await loadManifest(['https://cdn.example/panoramas.json', '/panoramas.json'], fetcher);
    expect(new URL(loaded.manifest.stops[0].image_url, loaded.baseUrl).pathname).toBe('/a.jpg');
    expect(new URL(loaded.baseUrl).host).not.toBe('cdn.example');
  });

  it('uses a valid manifest and resolves images against its URL', async () => {
    const body = { stops: [stop('a', null, null)] };
    const ok = (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const loaded = await loadManifest('/x/panoramas.json', ok);
    expect(new URL(loaded.manifest.stops[0].image_url, loaded.baseUrl).pathname).toBe('/x/a.jpg');
  });
});

describe('the published traverse', () => {
  it('links only same-rover stops, in sol order, with the real drive distance', () => {
    const chains = traverses(real);
    expect(chains.flat()).toHaveLength(real.stops.length);
    for (const chain of chains) {
      expect(new Set(chain.map((s) => s.rover)).size).toBe(1);
      expect(chain.map((s) => s.sol)).toEqual([...chain.map((s) => s.sol)].sort((a, b) => a - b));
      for (const [a, b] of chain.slice(0, -1).map((s, i) => [s, chain[i + 1]] as const)) {
        // The rover drove at least the straight line between two stops (allowing rounding).
        if (a.drive_m_to_next !== null) expect(a.drive_m_to_next).toBeGreaterThanOrEqual(geodesicM(a, b) - 1);
      }
    }
    // One chain per rover.
    expect(chains.map((c) => c[0].rover).sort()).toEqual(['Curiosity', 'Opportunity', 'Perseverance', 'Spirit']);
    expect(stopById(real, 'jezero_53')!.sol_end).toBe(64);
  });

  it('points chevrons along the ellipsoidal geodesic, close to the spherical bearing', () => {
    const a = stopById(real, 'gale_3167')!;
    const b = stopById(real, a.next_id)!;
    expect(Math.abs(geodesicBearingDeg(a, b)! - bearingDeg(stopLonLat(a), stopLonLat(b)))).toBeLessThan(0.5);
    expect(Math.abs(geodesicM(a, b) - distanceM(stopLonLat(a), stopLonLat(b))) / geodesicM(a, b)).toBeLessThan(0.01);
    expect(geodesicBearingDeg(a, { ...a, id: 'twin' })).toBeNull();
  });
});

describe('geometry', () => {
  it('measures distance on the Mars sphere', () => {
    expect(distanceM({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(59_275, -2);
  });

  it('gives compass bearings', () => {
    expect(bearingDeg({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(0);
    expect(bearingDeg({ lon: 0, lat: 0 }, { lon: 1, lat: 0 })).toBeCloseTo(90);
    expect(bearingDeg({ lon: 0, lat: 0 }, { lon: 0, lat: -1 })).toBeCloseTo(180);
    expect(bearingDeg({ lon: 0, lat: 0 }, { lon: -1, lat: 0 })).toBeCloseTo(270);
  });

  it('points directions in east-north-up', () => {
    const [e, n, u] = enuDirection(90, 0);
    expect([e, n, u].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0]);
    expect(enuDirection(0, 90)[2]).toBeCloseTo(1);
  });

  it('maps the image centre to the stop heading and wraps left to right clockwise', () => {
    expect(columnForBearing(45, 45)).toBeCloseTo(0.5);
    expect(columnForBearing(45, 135)).toBeCloseTo(0.75);
    expect(columnForBearing(45, 225)).toBeCloseTo(0);
    expect((frameHeadingDeg(45) + 270) % 360).toBe(45);
  });

  it('clamps the optical zoom to 20°–90°', () => {
    expect(clampFov(5)).toBe(20);
    expect(clampFov(120)).toBe(90);
    expect(clampFov(60)).toBe(60);
  });
});

describe('traverses', () => {
  const manifest: PanoramaManifest = {
    stops: [stop('b', 'a', 'c', 1), stop('a', null, 'b', 0), stop('c', 'b', null, 2), stop('x', null, null, 50)],
  };

  it('follows next_id from each start', () => {
    expect(traverses(manifest).map((chain) => chain.map((s) => s.id))).toEqual([['a', 'b', 'c'], ['x']]);
    expect(traverseOf(manifest, manifest.stops[2]).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('survives a cycle', () => {
    const loop: PanoramaManifest = { stops: [stop('p', 'q', 'q'), stop('q', 'p', 'p')] };
    expect(traverses(loop).flat()).toHaveLength(2);
  });

  it('finds the nearest stop', () => {
    expect(nearestStop(manifest, { lon: 1.9, lat: 0 }).stop.id).toBe('c');
    expect(nearestStop(real, { lon: 137.39, lat: -4.78 }).stop.rover).toBe('Curiosity');
  });
});
