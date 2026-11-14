// Written with AI assistance, directed and reviewed by the team.
import { ImageryLayer, ImageryLayerCollection } from 'cesium';

export type GlobeImageryRole = 'offline-basemap' | 'site-orbital' | 'temperature' | 'whole-planet' | 'site-data';

const ROLE_BASE: Record<GlobeImageryRole, number> = {
  'offline-basemap': 0,
  'site-orbital': 100,
  temperature: 200,
  'whole-planet': 201,
  'site-data': 1000,
};

const SITE_DATA_ORDER: Record<string, number> = {
  slope: 0,
  walkability: 1,
  spectral: 2,
  thermal: 3,
};

/** Stable draw rank, with manifest order for whole-planet layers and the required site-data order. */
export function imageryLayerRank(role: GlobeImageryRole, order = 0, siteLayerId = ''): number {
  if (role === 'whole-planet') return ROLE_BASE[role] + order;
  if (role !== 'site-data') return ROLE_BASE[role];
  const category = siteLayerId === 'slope' || siteLayerId === 'walkability'
    ? SITE_DATA_ORDER[siteLayerId]
    : siteLayerId === 'thermal' || siteLayerId === 'thermal_inertia'
      ? SITE_DATA_ORDER.thermal
      : SITE_DATA_ORDER.spectral;
  return ROLE_BASE[role] + category * 100 + order;
}

const ranks = new WeakMap<ImageryLayerCollection, Map<ImageryLayer, number>>();

/** Register a layer's draw rank and restore the complete managed order after every add or swap. */
export function orderImageryLayer(
  collection: ImageryLayerCollection,
  layer: ImageryLayer,
  rank: number,
): void {
  let collectionRanks = ranks.get(collection);
  if (!collectionRanks) {
    collectionRanks = new Map();
    ranks.set(collection, collectionRanks);
  }
  collectionRanks.set(layer, rank);
  const ordered = [...collectionRanks]
    .filter(([managed]) => collection.contains(managed))
    .sort(([left, leftRank], [right, rightRank]) =>
      leftRank - rightRank || collection.indexOf(left) - collection.indexOf(right),
    )
    .map(([managed]) => managed);

  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    while (collection.indexOf(current) < collection.indexOf(previous)) collection.raise(current);
  }
}
