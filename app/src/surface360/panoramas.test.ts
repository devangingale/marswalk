// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_MANIFEST,
  bearingDeg,
  clampFov,
  columnForBearing,
  distanceM,
  enuDirection,
  frameHeadingDeg,
  loadManifest,
  nearestStop,
  parseManifest,
  traverseOf,
  traverses,
  type PanoramaManifest,
  type PanoramaStop,
} from './panoramas';

const stop = (id: string, prev: string | null, next: string | null, lon = 0, lat = 0): PanoramaStop => ({
  id,
  name: id,
  sol: 1,
  lat,
  lon_east: lon,
  height: 0,
  heading: 0,
  pitch: 0,
  roll: 0,
  image_url: `./${id}.jpg`,
  walkability: 'safe',
  next_orbiter_pass: '00:00:00',
  next_id: next,
  prev_id: prev,
  pois: [],
});

describe('parseManifest', () => {
  it('accepts the sample, which follows the contract', () => {
    expect(parseManifest(SAMPLE_MANIFEST)).not.toBeNull();
    expect(SAMPLE_MANIFEST.stops[0]).toMatchObject({ id: 'sol_4', lat: 18.4447, lon_east: 77.4508, height: -2569.0 });
  });

  it('rejects missing fields, a bad walkability and duplicate ids', () => {
    const good = stop('a', null, null);
    expect(parseManifest({ stops: [{ ...good, walkability: 'risky' }] })).toBeNull();
    expect(parseManifest({ stops: [{ ...good, lat: undefined }] })).toBeNull();
    expect(parseManifest({ stops: [{ ...good, pois: [{ id: 'p' }] }] })).toBeNull();
    expect(parseManifest({ stops: [good, good] })).toBeNull();
    expect(parseManifest({ stops: [] })).toBeNull();
    expect(parseManifest('<!doctype html>')).toBeNull();
  });
});

describe('loadManifest', () => {
  it('falls back to the sample when the fetch fails or the body is not the contract', async () => {
    const html = (async () => new Response('<!doctype html>', { status: 200 })) as unknown as typeof fetch;
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect((await loadManifest('/data/panoramas.json', html)).isSample).toBe(true);
    expect((await loadManifest('/data/panoramas.json', missing)).isSample).toBe(true);
  });

  it('uses a valid manifest and resolves images against its URL', async () => {
    const body = { stops: [stop('a', null, null)] };
    const ok = (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const loaded = await loadManifest('/x/panoramas.json', ok);
    expect(loaded.isSample).toBe(false);
    expect(new URL(loaded.manifest.stops[0].image_url, loaded.baseUrl).pathname).toBe('/x/a.jpg');
  });
});

describe('geometry', () => {
  it('measures distance on the Mars sphere', () => {
    // One degree of latitude on Mars is about 59.3 km.
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
    // The image centre sits on local -x, which Cesium turns to compass 270° + heading.
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

  it('splits the sample into the Jezero and Gale traverses', () => {
    const chains = traverses(SAMPLE_MANIFEST);
    expect(chains).toHaveLength(2);
    expect(chains.flat()).toHaveLength(SAMPLE_MANIFEST.stops.length);
  });

  it('finds the nearest stop', () => {
    expect(nearestStop(manifest, { lon: 1.9, lat: 0 }).stop.id).toBe('c');
    expect(nearestStop(SAMPLE_MANIFEST, { lon: 137.39, lat: -4.78 }).stop.id.startsWith('gale_')).toBe(true);
  });
});
