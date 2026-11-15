// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { GlobeLayer, ValuesGrid } from '../layerManifest';
import type { Site } from '../sites/types';
import { caveType } from './caveTypes';
import { formatKm, greatCircleKm } from './geo';
import { formatHotspotValue, hotspotSpec } from './hotspots';
import { findPeaks } from './peaks';
import { nearestRanked, topCandidates } from './ranking';
import { placeLabels, thinPoints } from './screen';

const N = 65535;

/** A grid of 10-degree cells from the given raw rows; value = raw * scale + offset. */
function grid(rows: number[][], opts: { west?: number; north?: number; scale?: number; offset?: number } = {}): ValuesGrid {
  return {
    width: rows[0].length,
    height: rows.length,
    west: opts.west ?? -180,
    north: opts.north ?? 60,
    res_deg: 10,
    scale: opts.scale ?? 1,
    offset: opts.offset ?? 0,
    nodata: N,
    data: Uint16Array.from(rows.flat()),
  };
}

describe('greatCircleKm', () => {
  it('measures a degree of longitude on the equator with the Mars radius', () => {
    expect(greatCircleKm(0, 0, 1, 0)).toBeCloseTo(59.27, 2);
  });
  it('measures pole to pole as half the circumference', () => {
    expect(greatCircleKm(0, 90, 0, -90)).toBeCloseTo(10669.45, 1);
  });
});

describe('formatKm', () => {
  it('keeps one decimal under 10 km and groups from 10 000', () => {
    expect(formatKm(3.04)).toBe('3.0 km');
    expect(formatKm(1240.4)).toBe('1240 km');
    expect(formatKm(10_669.3)).toBe('10 669 km');
  });
});

describe('findPeaks', () => {
  it('returns local maxima best first, with values decoded', () => {
    const g = grid(
      [
        [1, 2, 1, 0, 0],
        [2, 9, 2, 0, 5],
        [1, 2, 1, 0, 0],
      ],
      { scale: 0.5, offset: 10 },
    );
    expect(findPeaks(g, { count: 3, minSeparationKm: 0 })).toEqual([
      { lon: -165, lat: 45, value: 14.5 },
      { lon: -135, lat: 45, value: 12.5 },
    ]);
  });

  it('skips a peak closer than the minimum separation to a better one', () => {
    // Cells 10 degrees apart on the equator are about 593 km apart.
    const g = grid([[9, 0, 8, 0, 0, 7]], { north: 5 });
    expect(findPeaks(g, { count: 3, minSeparationKm: 1500 }).map((p) => p.value)).toEqual([9, 7]);
    expect(findPeaks(g, { count: 3, minSeparationKm: 500 }).map((p) => p.value)).toEqual([9, 8, 7]);
  });

  it('finds the lowest values when asked and ignores nodata', () => {
    const g = grid([[5, N, 4, 6, 3, 9]], { north: 5 });
    expect(findPeaks(g, { count: 2, minSeparationKm: 0, lowest: true })).toEqual([
      { lon: -135, lat: 0, value: 3 },
      { lon: -155, lat: 0, value: 4 },
    ]);
  });

  it('wraps columns across 180 degrees on a whole-planet grid', () => {
    const row = Array.from({ length: 36 }, () => 1);
    row[0] = 5;
    row[35] = 6;
    const g = grid([row], { north: 5 });
    // The cell at -175 has a higher neighbour across the antimeridian, so it is not a peak.
    expect(findPeaks(g, { count: 5, minSeparationKm: 0 }).map((p) => p.lon)).toEqual([175, -155, -145, -135, -125]);
  });

  it('breaks ties on a plateau in row order and keeps them apart', () => {
    const g = grid([[0, 0, 0, 0]], { north: 5 });
    expect(findPeaks(g, { count: 4, minSeparationKm: 1000, lowest: true }).map((p) => p.lon)).toEqual([-175, -155]);
  });

  it('breaks ties toward the equator before row order', () => {
    const g = grid([[7], [7], [7]], { north: 15 });
    expect(findPeaks(g, { count: 3, minSeparationKm: 0 }).map((p) => p.lat)).toEqual([0, 10, -10]);
  });

  it('handles a whole-planet quarter-degree grid in well under 100 ms', () => {
    const width = 1440;
    const height = 480;
    const data = new Uint16Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) % 4093;
    const g: ValuesGrid = { width, height, west: -180, north: 60, res_deg: 0.25, scale: 1, offset: 0, nodata: N, data };
    const start = performance.now();
    const peaks = findPeaks(g, { count: 5, minSeparationKm: 500 });
    expect(performance.now() - start).toBeLessThan(100);
    expect(peaks).toHaveLength(5);
  });
});

function site(id: string, score: number, extra: Partial<Site> = {}): Site {
  return { id, name: id, lat: 0, lon: 0, kind: 'new', score, vetoed: false, ...extra } as Site;
}

describe('topCandidates', () => {
  it('ranks non-vetoed new candidates by score, ties in file order', () => {
    const sites = [
      site('a', 50),
      site('b', 80, { vetoed: true }),
      site('c', 70),
      site('d', 90, { kind: 'landed' }),
      site('e', 70),
      site('f', 60),
    ];
    expect(topCandidates(sites, 3).map((r) => [r.rank, r.site.id])).toEqual([
      [1, 'c'],
      [2, 'e'],
      [3, 'f'],
    ]);
  });
});

describe('nearestRanked', () => {
  it('returns the closest ranked site and its distance', () => {
    const ranked = topCandidates([site('a', 90, { lon: 10 }), site('b', 80, { lon: 2 })]);
    const near = nearestRanked(ranked, 0, 0)!;
    expect(near.ranked.site.id).toBe('b');
    expect(near.km).toBeCloseTo(118.55, 2);
    expect(nearestRanked([], 0, 0)).toBeNull();
  });
});

describe('thinPoints', () => {
  it('keeps one point per cell, preferring higher priority, then input order', () => {
    const points = [
      { x: 1, y: 1, priority: 0 },
      { x: 5, y: 5, priority: 1 },
      { x: 9, y: 2, priority: 1 },
      { x: 25, y: 1, priority: 0 },
      { x: 26, y: 3, priority: 0 },
    ];
    expect(thinPoints(points, 10)).toEqual([1, 3]);
    expect(thinPoints(points, 1)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('placeLabels', () => {
  it('places higher priority first and drops overlaps and blocked labels', () => {
    const labels = [
      { rect: [0, 0, 50, 10] as [number, number, number, number], priority: 0 },
      { rect: [40, 5, 90, 15] as [number, number, number, number], priority: 1 },
      { rect: [100, 0, 150, 10] as [number, number, number, number], priority: 0 },
      { rect: [200, 0, 250, 10] as [number, number, number, number], priority: 2 },
    ];
    expect(placeLabels(labels)).toEqual([1, 2, 3]);
    expect(placeLabels(labels, [[195, 0, 210, 20]])).toEqual([1, 2]);
  });
});

describe('caveType', () => {
  it('names catalog codes in plain language and marks openings', () => {
    expect(caveType('sky')).toEqual({ label: 'Skylight', entry: true });
    expect(caveType('APC')).toEqual({ label: 'Atypical pit', entry: true });
    expect(caveType('srp')).toEqual({ label: 'Shallow pit', entry: false });
    expect(caveType('smrp')).toEqual({ label: 'Unclassified', entry: false });
  });
});

describe('hotspots', () => {
  const layer = (id: string, group: string, values = true) =>
    ({ id, group, title: 'Olivine index', values: values ? {} : undefined, legend: { units: 'index' } }) as unknown as GlobeLayer;

  it('marks radiation highest, ice distance lowest, and skips layers without a direction or grid', () => {
    expect(hotspotSpec(layer('dose_ugy_day', 'radiation'))?.lowest).toBe(false);
    expect(hotspotSpec(layer('ice_dist_km', 'ice'))?.lowest).toBe(true);
    expect(hotspotSpec(layer('elevation_m', 'terrain'))).toBeNull();
    expect(hotspotSpec(layer('dose_ugy_day', 'radiation', false))).toBeNull();
  });

  it('takes a new mineral layer as highest-is-notable', () => {
    expect(hotspotSpec(layer('olivine', 'minerals'))).toEqual({
      label: 'Highest olivine index',
      lowest: false,
      decimals: 2,
      unit: 'index',
    });
  });

  it('formats values with the spec decimals and unit', () => {
    expect(formatHotspotValue(hotspotSpec(layer('dose_ugy_day', 'radiation'))!, 312.4)).toBe('312 µGy/day');
    expect(formatHotspotValue(hotspotSpec(layer('SWIM4MIM_Ci_0_1', 'ice'))!, 0.987)).toBe('0.99');
    expect(formatHotspotValue(hotspotSpec(layer('SWIM4MIM_Ci_0_1', 'ice'))!, -0.5)).toBe('−0.50');
  });
});
