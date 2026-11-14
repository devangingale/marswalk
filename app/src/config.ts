// Written with AI assistance, directed and reviewed by the team.

/**
 * Base URL for tile bundles and site metadata.
 * Overridable by Vite environment variable VITE_TILES_BASE.
 */
export const TILES_BASE: string =
  (import.meta.env.VITE_TILES_BASE as string) || '/sample';

/**
 * Available sites configured for the mission.
 * Gale (Mount Sharp) is the primary full site; Jezero is the validation site.
 */
export const AVAILABLE_SITES: string[] = ['gale', 'jezero'];

export const DEFAULT_SITE: string = 'gale';

/**
 * Mars mean volumetric radius in metres (contracts section 3).
 * Never use Earth radius for distance calculations.
 */
export const MARS_RADIUS_METERS = 3396190;

/**
 * Resolves the site.json URL for a given site ID.
 */
export function getSiteJsonUrl(siteId: string): string {
  const base = TILES_BASE.replace(/\/+$/, '');
  return `${base}/${siteId}/site.json`;
}

/**
 * Resolves relative URLs within a site bundle to an absolute URL path.
 */
export function resolveSiteAssetUrl(siteId: string, relativeOrAbsoluteUrl: string): string {
  if (relativeOrAbsoluteUrl.startsWith('http://') || relativeOrAbsoluteUrl.startsWith('https://')) {
    return relativeOrAbsoluteUrl;
  }
  if (relativeOrAbsoluteUrl.startsWith('/')) {
    return relativeOrAbsoluteUrl;
  }
  const base = TILES_BASE.replace(/\/+$/, '');
  return `${base}/${siteId}/${relativeOrAbsoluteUrl}`;
}
