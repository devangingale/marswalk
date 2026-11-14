// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { normalizeWeights, rescore, scoreGroups } from './scoring';
import { GroupKey, Site, Weights } from './types';

const EVEN: Weights = { terrain: 0.2, climate: 0.2, solar: 0.2, protection: 0.2, science: 0.2 };

function groups(values: [number, number, number, number, number]): Record<GroupKey, number> {
  return { terrain: values[0], climate: values[1], solar: values[2], protection: values[3], science: values[4] };
}

function site(id: string, values: [number, number, number, number, number]): Site {
  return {
    id,
    name: id,
    lat: 0,
    lon: 0,
    kind: 'new',
    score: 0,
    groups: groups(values),
    evidence: {} as Site['evidence'],
    vetoed: false,
    veto_reason: [],
    detail_available: false,
    nearest_hirise_dtm_km: 0,
  };
}

describe('normalizeWeights', () => {
  it('scales weights to sum to 1', () => {
    const w = normalizeWeights({ terrain: 2, climate: 2, solar: 2, protection: 2, science: 2 });
    expect(w).toEqual(EVEN);
  });

  it('clamps negative weights to zero before normalising', () => {
    const w = normalizeWeights({ terrain: -1, climate: 1, solar: 1, protection: 1, science: 1 });
    expect(w).toEqual({ terrain: 0, climate: 0.25, solar: 0.25, protection: 0.25, science: 0.25 });
  });

  it('falls back to an even split when every weight is zero', () => {
    expect(normalizeWeights({ terrain: 0, climate: 0, solar: 0, protection: 0, science: 0 })).toEqual(EVEN);
  });
});

describe('scoreGroups', () => {
  it('averages the five groups under even weights', () => {
    expect(scoreGroups(groups([10, 20, 30, 40, 50]), EVEN)).toBe(30);
  });

  it('returns a single group when only its weight is non-zero', () => {
    const w: Weights = { terrain: 0, climate: 0, solar: 1, protection: 0, science: 0 };
    expect(scoreGroups(groups([10, 20, 83.55, 40, 50]), w)).toBe(83.55);
  });

  it('normalises before weighting', () => {
    const w: Weights = { terrain: 3, climate: 1, solar: 0, protection: 0, science: 0 };
    // (80*3 + 40*1) / 4 = 70
    expect(scoreGroups(groups([80, 40, 0, 0, 0]), w)).toBe(70);
  });
});

describe('rescore', () => {
  it('ranks sites by live score descending', () => {
    const ranked = rescore([site('a', [10, 10, 10, 10, 10]), site('b', [90, 90, 90, 90, 90]), site('c', [50, 50, 50, 50, 50])], EVEN);
    expect(ranked.map((r) => r.site.id)).toEqual(['b', 'c', 'a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((r) => r.score)).toEqual([90, 50, 10]);
  });

  it('keeps input order for ties', () => {
    const ranked = rescore([site('first', [50, 50, 50, 50, 50]), site('second', [50, 50, 50, 50, 50])], EVEN);
    expect(ranked.map((r) => r.site.id)).toEqual(['first', 'second']);
  });

  it('re-ranks when the weights change', () => {
    // science-heavy site vs terrain-heavy site; weighting all on science flips the order.
    const sci = site('sci', [10, 10, 10, 10, 99]);
    const terr = site('terr', [99, 10, 10, 10, 10]);
    const sciWeights: Weights = { terrain: 0, climate: 0, solar: 0, protection: 0, science: 1 };
    expect(rescore([terr, sci], sciWeights).map((r) => r.site.id)).toEqual(['sci', 'terr']);
    const terrWeights: Weights = { terrain: 1, climate: 0, solar: 0, protection: 0, science: 0 };
    expect(rescore([sci, terr], terrWeights).map((r) => r.site.id)).toEqual(['terr', 'sci']);
  });
});
