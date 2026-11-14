// Written with AI assistance, directed and reviewed by the team.

/**
 * Base URL for tile bundles and site metadata. Set VITE_TILES_BASE to override;
 * development defaults to the local full bundles and production to the sample.
 */
export const TILES_BASE: string =
  (import.meta.env.VITE_TILES_BASE as string) ||
  (import.meta.env.MODE === 'development' ? '/local-bundles' : '/sample');

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
 * Resolves the base URL of a site's published bundle (contracts section 4).
 */
export function getSiteBaseUrl(siteId: string): string {
  const base = TILES_BASE.replace(/\/+$/, '');
  return `${base}/${siteId}`;
}

/**
 * Resolves the site.json URL for a given site ID.
 */
export function getSiteJsonUrl(siteId: string): string {
  return `${getSiteBaseUrl(siteId)}/site.json`;
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
  return `${getSiteBaseUrl(siteId)}/${relativeOrAbsoluteUrl}`;
}
