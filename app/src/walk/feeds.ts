// Written with AI assistance, directed and reviewed by the team.

/**
 * Loads the small per-site files bundled with the app (contracts sections 4, 8, 9):
 * photos.json, conditions.json and chemistry.geojson.
 */

import { useEffect, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';
import { ChemistryProperties, RoverPhoto, SiteConditions, SiteData } from '../types';
import { ChemistryFeature } from './nearby';

export interface SiteFeeds {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  photos: RoverPhoto[];
  photosAvailable: boolean;
  conditions: SiteConditions | null;
  chemistry: ChemistryFeature[];
  chemistryAvailable: boolean;
}

/**
 * Fetches a bundled JSON file, resolving null when it is not there: a 404, or the app's
 * index.html served in its place by the dev server or the Vercel rewrite.
 */
export async function fetchJsonIfPresent<T>(url: string): Promise<T | null> {
  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  if (!(resp.headers.get('content-type') ?? '').includes('json')) return null;
  return (await resp.json()) as T;
}

const EMPTY: SiteFeeds = {
  status: 'loading', error: null, photos: [], photosAvailable: false,
  conditions: null, chemistry: [], chemistryAvailable: false,
};

export function readySiteFeeds(
  photos: RoverPhoto[] | null,
  conditions: SiteConditions | null,
  chemistry: FeatureCollection<Point, ChemistryProperties> | null,
): SiteFeeds {
  return {
    status: 'ready',
    error: null,
    photos: photos ?? [],
    photosAvailable: photos !== null,
    conditions,
    chemistry: chemistry?.features ?? [],
    chemistryAvailable: chemistry !== null,
  };
}

/**
 * Site feeds for Walk. Missing per-site feeds stay unavailable instead of borrowing another site's data.
 */
export function useSiteFeeds(siteData: SiteData): SiteFeeds {
  const [feeds, setFeeds] = useState<SiteFeeds>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    setFeeds(EMPTY);
    const site = siteData.id;

    Promise.all([
      fetchJsonIfPresent<RoverPhoto[]>(siteData.photos_url ?? `/data/${site}/photos.json`),
      fetchJsonIfPresent<SiteConditions>(siteData.conditions_url ?? `/data/${site}/conditions.json`),
      fetchJsonIfPresent<FeatureCollection<Point, ChemistryProperties>>(
        siteData.chemistry_url ?? `/data/${site}/chemistry.geojson`
      ),
    ])
      .then(([photos, conditions, chemistry]) => {
        if (cancelled) return;
        setFeeds(readySiteFeeds(photos, conditions, chemistry));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFeeds({ ...EMPTY, status: 'error', error: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [siteData]);

  return feeds;
}
