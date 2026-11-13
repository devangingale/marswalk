// Written with AI assistance, directed and reviewed by the team.

/**
 * Loads the small per-site files bundled with the app (contracts sections 4, 8, 9):
 * photos.json, conditions.json and chemistry.geojson.
 */

import { useEffect, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';
import { ChemistryProperties, RoverPhoto, SiteConditions, SiteData } from '../types';
import photosSample from '../fixtures/photos.sample.json';
import { ChemistryFeature } from './nearby';

export interface SiteFeeds {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  photos: RoverPhoto[];
  conditions: SiteConditions | null;
  chemistry: ChemistryFeature[];
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

const EMPTY: SiteFeeds = { status: 'loading', error: null, photos: [], conditions: null, chemistry: [] };

/**
 * Site feeds for Walk. Until the site's photos.json is published, the committed
 * `fixtures/photos.sample.json` stands in for it.
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
        setFeeds({
          status: 'ready',
          error: null,
          photos: photos ?? (photosSample as RoverPhoto[]),
          conditions,
          chemistry: chemistry?.features ?? [],
        });
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
