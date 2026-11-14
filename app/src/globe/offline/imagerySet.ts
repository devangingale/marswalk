// Written with AI assistance, directed and reviewed by the team.
import type { SiteBasemap, SiteData, SiteLayer } from '../../types';

export interface SiteImagerySet {
  basemap?: SiteBasemap;
  layers: SiteLayer[];
}

/** Offline keeps bundle imagery and adds the bundle basemap when it is available. */
export function offlineImagerySet(mode: 'ion' | 'offline', site: SiteData): SiteImagerySet {
  return {
    ...(mode === 'offline' && site.basemap ? { basemap: site.basemap } : {}),
    layers: site.layers.filter((layer) => layer.type === 'raster'),
  };
}
