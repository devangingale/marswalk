// Written with AI assistance, directed and reviewed by the team.
// Whole-planet surface temperature on the globe: one imagery layer for the current season bin
// and kind, swapped when either changes, with its value and count grids for the hover readout.

import {
  Credit,
  Ellipsoid,
  GeographicTilingScheme,
  ImageryLayer,
  ImageryLayerCollection,
  Rectangle,
  UrlTemplateImageryProvider,
} from 'cesium';
import { globeAssetUrl } from '../layerManifest';
import {
  TemperatureGrid,
  TemperatureKind,
  TemperatureManifest,
  TemperatureReading,
  TemperatureVariant,
  decodeCounts,
  decodeValues,
  maxLevel,
  temperatureAt,
} from './temperatureManifest';

export async function loadTemperatureManifest(base: string): Promise<TemperatureManifest> {
  const url = globeAssetUrl(base, 'temperature.json');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return (await response.json()) as TemperatureManifest;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.arrayBuffer();
}

export async function loadTemperatureGrid(base: string, variant: TemperatureVariant): Promise<TemperatureGrid> {
  const { url, counts, min_observations_per_cell, ...header } = variant.values;
  const [values, countBytes] = await Promise.all([
    fetchBuffer(globeAssetUrl(base, url)),
    fetchBuffer(globeAssetUrl(base, counts.url)),
  ]);
  return {
    values: { ...header, data: decodeValues(values, header.width, header.height) },
    counts: decodeCounts(countBytes, counts),
    minObservations: min_observations_per_cell,
  };
}

export interface TemperatureState {
  enabled: boolean;
  opacity: number;
  kind: TemperatureKind;
  bin: number;
}

export class GlobeTemperatureLayer {
  private imagery: ImageryLayer | null = null;
  private key = '';
  private readonly grids = new Map<string, TemperatureGrid>();
  private readonly pending = new Set<string>();
  private state: TemperatureState | null = null;

  constructor(
    private readonly target: ImageryLayerCollection,
    private readonly base: string,
    readonly manifest: TemperatureManifest,
  ) {}

  private variant(state: TemperatureState): TemperatureVariant | null {
    return this.manifest.season_bins[state.bin]?.[state.kind] ?? null;
  }

  apply(state: TemperatureState): void {
    this.state = state;
    const variant = this.variant(state);
    if (!state.enabled || !variant) {
      if (this.imagery) this.imagery.show = false;
      return;
    }
    const key = `${state.bin}:${state.kind}`;
    if (key !== this.key || !this.imagery) {
      const provider = new UrlTemplateImageryProvider({
        url: globeAssetUrl(this.base, variant.tiles),
        tilingScheme: new GeographicTilingScheme({ ellipsoid: Ellipsoid.MARS }),
        minimumLevel: 0,
        maximumLevel: maxLevel(variant),
        rectangle: Rectangle.fromDegrees(-180, -90, 180, 90),
        credit: new Credit(this.manifest.source.dataset),
      });
      const next = new ImageryLayer(provider);
      // Swap in place: the new season takes the old layer's slot, under the site layers.
      if (this.imagery) {
        const index = this.target.indexOf(this.imagery);
        this.target.add(next, Math.max(0, index));
        this.target.remove(this.imagery, true);
      } else {
        this.target.add(next);
        this.target.lowerToBottom(next);
      }
      this.imagery = next;
      this.key = key;
    }
    this.imagery.show = true;
    this.imagery.alpha = state.opacity;
    if (!this.grids.has(key) && !this.pending.has(key)) {
      this.pending.add(key);
      loadTemperatureGrid(this.base, variant)
        .then((grid) => this.grids.set(key, grid))
        .catch((error) => console.warn(`Temperature values for ${key} did not load`, error))
        .finally(() => this.pending.delete(key));
    }
  }

  get kind(): TemperatureKind {
    return this.state?.kind ?? 't_min';
  }

  /** Reading under the cursor for the shown bin and kind, or null. */
  reading(lon: number, lat: number): TemperatureReading | null {
    const state = this.state;
    if (!state?.enabled) return null;
    const grid = this.grids.get(`${state.bin}:${state.kind}`);
    return grid ? temperatureAt(grid, lon, lat) : null;
  }

  destroy(): void {
    if (this.imagery) this.target.remove(this.imagery, true);
    this.imagery = null;
  }
}
