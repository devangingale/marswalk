// Written with AI assistance, directed and reviewed by the team.
// Pure re-scoring of candidate sites from adjustable group weights.

import { GROUP_KEYS, GroupKey, Site, Weights } from './types';

/** A site carried with its live (re-weighted) score and its rank in the list. */
export interface RankedSite {
  site: Site;
  score: number;
  rank: number;
}

/**
 * Normalise five group weights so they sum to 1. Negative weights are clamped
 * to 0 first; if every weight is 0 the five groups share the weight equally.
 */
export function normalizeWeights(weights: Weights): Weights {
  const clamped = GROUP_KEYS.map((k) => Math.max(0, weights[k]));
  const total = clamped.reduce((a, b) => a + b, 0);
  const out = {} as Weights;
  if (total === 0) {
    const even = 1 / GROUP_KEYS.length;
    GROUP_KEYS.forEach((k) => {
      out[k] = even;
    });
    return out;
  }
  GROUP_KEYS.forEach((k, i) => {
    out[k] = clamped[i] / total;
  });
  return out;
}

/** Weighted sum of the five group scores, with the weights normalised to sum 1. */
export function scoreGroups(groups: Record<GroupKey, number>, weights: Weights): number {
  const w = normalizeWeights(weights);
  return GROUP_KEYS.reduce((sum, k) => sum + (groups[k] ?? 0) * w[k], 0);
}

/**
 * Re-score and rank a set of sites under the given weights. Sorted by live
 * score descending; ties keep the input order. Rank starts at 1.
 */
export function rescore(sites: Site[], weights: Weights): RankedSite[] {
  const w = normalizeWeights(weights);
  return sites
    .map((site, index) => ({ site, index, score: scoreGroups(site.groups, w) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ site, score }, i) => ({ site, score, rank: i + 1 }));
}
