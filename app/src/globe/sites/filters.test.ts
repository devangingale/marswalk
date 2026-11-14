// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, FilterState, filterSites, median, radiationMedian } from './filters';
import { Site, SiteKind } from './types';

interface Opts {
  kind?: SiteKind;
  vetoed?: boolean;
  detail?: boolean;
  ice?: number;
  dose?: number;
  caves?: number;
}

function site(id: string, o: Opts = {}): Site {
  return {
    id,
    name: id,
    lat: 0,
    lon: 0,
    kind: o.kind ?? 'new',
    score: 0,
    groups: { terrain: 0, climate: 0, solar: 0, protection: 0, science: 0 },
    evidence: {
      ice_dist_km: o.ice ?? 1000,
      dose_ugy_day: o.dose ?? 250,
      cave_count_zone: o.caves ?? 0,
    } as Site['evidence'],
    vetoed: o.vetoed ?? false,
    veto_reason: [],
    detail_available: o.detail ?? false,
    nearest_hirise_dtm_km: 0,
  };
}

function f(overrides: Partial<FilterState>): FilterState {
  return { ...DEFAULT_FILTERS, ...overrides };
}

describe('median', () => {
  it('returns the middle of an odd list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middle values of an even list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns NaN for an empty list', () => {
    expect(median([])).toBeNaN();
  });
});

describe('radiationMedian', () => {
  it('reads the dose field', () => {
    expect(radiationMedian([site('a', { dose: 100 }), site('b', { dose: 300 })])).toBe(200);
  });
});

describe('filterSites', () => {
  const all = [
    site('new-1', { kind: 'new' }),
    site('landed-1', { kind: 'landed' }),
    site('zone-1', { kind: 'zone2015' }),
    site('vetoed-1', { kind: 'new', vetoed: true }),
  ];

  it('hides vetoed sites by default', () => {
    expect(filterSites(all, DEFAULT_FILTERS).map((s) => s.id)).toEqual(['new-1', 'landed-1', 'zone-1']);
  });

  it('shows vetoed sites when asked', () => {
    expect(filterSites(all, f({ showVetoed: true })).map((s) => s.id)).toEqual([
      'new-1',
      'landed-1',
      'zone-1',
      'vetoed-1',
    ]);
  });

  it('filters by kind', () => {
    expect(filterSites(all, f({ kind: 'landed' })).map((s) => s.id)).toEqual(['landed-1']);
    expect(filterSites(all, f({ kind: 'zone2015' })).map((s) => s.id)).toEqual(['zone-1']);
  });

  it('keeps only sites with detail bundles', () => {
    const list = [site('a', { detail: true }), site('b', { detail: false })];
    expect(filterSites(list, f({ hasDetail: true })).map((s) => s.id)).toEqual(['a']);
  });

  it('keeps ice within 50 km', () => {
    const list = [site('close', { ice: 33.3 }), site('edge', { ice: 50 }), site('far', { ice: 50.1 })];
    expect(filterSites(list, f({ iceNearby: true })).map((s) => s.id)).toEqual(['close', 'edge']);
  });

  it('keeps radiation strictly below the median of the base', () => {
    // doses 100, 200, 300, 400 -> median 250; strictly below keeps 100 and 200.
    const list = [
      site('d100', { dose: 100 }),
      site('d200', { dose: 200 }),
      site('d300', { dose: 300 }),
      site('d400', { dose: 400 }),
    ];
    expect(filterSites(list, f({ lowRadiation: true })).map((s) => s.id)).toEqual(['d100', 'd200']);
  });

  it('keeps sites with at least one cave in the zone', () => {
    const list = [site('none', { caves: 0 }), site('one', { caves: 1 }), site('three', { caves: 3 })];
    expect(filterSites(list, f({ cavesNearby: true })).map((s) => s.id)).toEqual(['one', 'three']);
  });

  it('combines chips with AND', () => {
    const list = [
      site('keep', { kind: 'new', ice: 20, caves: 2 }),
      site('no-cave', { kind: 'new', ice: 20, caves: 0 }),
      site('far-ice', { kind: 'new', ice: 200, caves: 2 }),
    ];
    expect(filterSites(list, f({ iceNearby: true, cavesNearby: true })).map((s) => s.id)).toEqual(['keep']);
  });
});
