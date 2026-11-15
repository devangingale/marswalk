// Written with AI assistance, directed and reviewed by the team.
// HiRISE browse images for ranked sites (GLOBE_BASE/hirise/index.json, written by
// pipeline/candidate_hirise.py) and their mapping onto the site card.

export interface HiriseCovered {
  covered: true;
  name: string;
  observation_id: string;
  product_id: string;
  acquired: string;
  resolution_m_px: number;
  browse_m_px: number;
  emission_deg: number;
  /** Footprint ring as [lon, lat], degrees. */
  footprint: [number, number][];
  page_url: string;
  /** Image path relative to the globe base. */
  image: string;
  image_px: [number, number];
  image_bytes: number;
  /** Site point in image pixels (x right, y down), when the projection allows it. */
  site_px: [number, number] | null;
  observations_covering: number;
  reason: string;
  credit: string;
}

export interface HiriseUncovered {
  covered: false;
  name: string;
  reason: string;
}

export type HiriseEntry = HiriseCovered | HiriseUncovered;

export interface HiriseIndex {
  version: number;
  credit: string;
  licence: string;
  licence_url: string;
  sites: Record<string, HiriseEntry>;
}

export type HiriseView =
  | {
      kind: 'image';
      src: string;
      alt: string;
      observationId: string;
      pageUrl: string;
      date: string;
      resolution: string;
      credit: string;
      width: number;
      height: number;
      /** Site point as a percentage of the image width and height. */
      marker: { x: number; y: number } | null;
    }
  | { kind: 'none' };

function percent(v: number): number {
  return Math.round(v * 1000) / 10;
}

/** What the card shows for a site: an image, a "no coverage" note, or nothing (not a HiRISE target). */
export function hiriseView(index: HiriseIndex | null, siteId: string, base: string): HiriseView | null {
  const entry = index?.sites[siteId];
  if (!entry) return null;
  if (!entry.covered) return { kind: 'none' };
  const [width, height] = entry.image_px;
  return {
    kind: 'image',
    src: `${base}/${entry.image}`,
    alt: `HiRISE observation ${entry.observation_id} over ${entry.name}`,
    observationId: entry.observation_id,
    pageUrl: entry.page_url,
    date: entry.acquired,
    resolution: `${entry.resolution_m_px} m/px (shown at ${entry.browse_m_px.toFixed(1)} m/px)`,
    credit: `Image: ${entry.credit}`,
    width,
    height,
    marker: entry.site_px ? { x: percent(entry.site_px[0] / width), y: percent(entry.site_px[1] / height) } : null,
  };
}

export interface ThumbCrop {
  /** CSS object-position for an object-fit: cover thumbnail. */
  position: string;
  /** Site point as a percentage of the thumbnail box. */
  marker: { x: number; y: number } | null;
}

/** Offset fraction (object-position) along one axis that centres point f, clamped to the image. */
function axisCrop(box: number, shown: number, f: number): { p: number; marker: number } {
  const p = shown === box ? 0.5 : Math.min(1, Math.max(0, (box / 2 - f * shown) / (box - shown)));
  return { p, marker: (p * (box - shown) + f * shown) / box };
}

/**
 * Crop of an image (width x height px) shown with object-fit: cover in a box of the given
 * aspect ratio, centred on the marker (percentages of the image) as far as the image allows.
 */
export function thumbCrop(width: number, height: number, marker: { x: number; y: number } | null, aspect: number): ThumbCrop {
  if (!marker) return { position: '50% 50%', marker: null };
  const scale = Math.max(aspect / width, 1 / height);
  const x = axisCrop(aspect, width * scale, marker.x / 100);
  const y = axisCrop(1, height * scale, marker.y / 100);
  return {
    position: `${percent(x.p)}% ${percent(y.p)}%`,
    marker: { x: percent(x.marker), y: percent(y.marker) },
  };
}

/** The footprint ring of a covered site, or null. */
export function hiriseFootprint(index: HiriseIndex | null, siteId: string): [number, number][] | null {
  const entry = index?.sites[siteId];
  return entry?.covered ? entry.footprint : null;
}
