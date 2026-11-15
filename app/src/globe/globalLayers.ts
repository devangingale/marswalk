// Written with AI assistance, directed and reviewed by the team.
import {
  Credit,
  Ellipsoid,
  GeographicTilingScheme,
  ImageryLayer,
  ImageryLayerCollection,
  Rectangle,
  UrlTemplateImageryProvider,
} from 'cesium';
import {
  GlobeLayer,
  GlobeManifest,
  ValuesGrid,
  ValuesSpec,
  formatGlobalValue,
  globeAssetUrl,
  readValue,
} from './layerManifest';
import { imageryLayerRank, orderImageryLayer } from './layerOrder';

export * from './layerManifest';

export async function loadGlobeManifest(base: string): Promise<GlobeManifest> {
  const url = globeAssetUrl(base, 'layers.json');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return (await response.json()) as GlobeManifest;
}

export async function loadValuesGrid(base: string, spec: ValuesSpec): Promise<ValuesGrid> {
  const url = globeAssetUrl(base, spec.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const { url: _url, ...header } = spec;
  return { ...header, data: new Uint16Array(await response.arrayBuffer()) };
}

export function createGlobalImagery(base: string, layer: GlobeLayer): UrlTemplateImageryProvider {
  const [west, south, east, north] = layer.rectangle;
  return new UrlTemplateImageryProvider({
    url: globeAssetUrl(base, layer.tiles),
    tilingScheme: new GeographicTilingScheme({ ellipsoid: Ellipsoid.MARS }),
    minimumLevel: layer.min_level,
    maximumLevel: layer.max_level,
    rectangle: Rectangle.fromDegrees(west, south, east, north),
    credit: new Credit(layer.source.citation),
  });
}

export interface GlobalLayerState {
  enabled: boolean;
  opacity: number;
}

/**
 * Global science layers on the tileset, kept below the site layers in manifest order,
 * with value grids fetched the first time a layer is shown. A layer is attached to the
 * tileset only while shown: each attached layer costs the tileset shader a vertex
 * attribute, and the full manifest has more layers than many GPUs allow.
 */
export class GlobeGlobalLayers {
  private readonly imagery = new Map<string, ImageryLayer>();
  private readonly grids = new Map<string, ValuesGrid>();
  private readonly loads = new Map<string, Promise<ValuesGrid>>();

  constructor(
    private readonly target: ImageryLayerCollection,
    private readonly base: string,
    readonly layers: GlobeLayer[],
  ) {
    for (const layer of layers) this.imagery.set(layer.id, new ImageryLayer(createGlobalImagery(base, layer)));
  }

  apply(states: Record<string, GlobalLayerState>): void {
    for (const [order, layer] of this.layers.entries()) {
      const imagery = this.imagery.get(layer.id)!;
      const state = states[layer.id];
      const attached = this.target.contains(imagery);
      if (state?.enabled && !attached) {
        this.target.add(imagery);
        orderImageryLayer(this.target, imagery, imageryLayerRank('whole-planet', order));
      } else if (!state?.enabled && attached) {
        this.target.remove(imagery, false);
      }
      imagery.alpha = state?.opacity ?? 1;
      if (state?.enabled && layer.values) this.values(layer.id).catch((error) => console.warn(`Values for ${layer.id} did not load`, error));
    }
  }

  /** A layer's value grid, fetched once and shared; rejects for a layer without one. */
  values(id: string): Promise<ValuesGrid> {
    const loaded = this.loads.get(id);
    if (loaded) return loaded;
    const spec = this.layers.find((l) => l.id === id)?.values;
    if (!spec) return Promise.reject(new Error(`No value grid for ${id}`));
    const load = loadValuesGrid(this.base, spec).then((grid) => {
      this.grids.set(id, grid);
      return grid;
    });
    // A failed load can be retried the next time the layer is shown.
    load.catch(() => this.loads.delete(id));
    this.loads.set(id, load);
    return load;
  }

  /** Readouts for each shown layer that has a value grid, in manifest order. */
  readouts(lon: number, lat: number): string[] {
    return this.layers.flatMap((layer) => {
      const grid = this.grids.get(layer.id);
      if (!grid || !this.target.contains(this.imagery.get(layer.id)!)) return [];
      const value = readValue(grid, lon, lat);
      return value === null ? [] : [formatGlobalValue(layer, value)];
    });
  }

  destroy(): void {
    for (const imagery of this.imagery.values()) {
      if (this.target.contains(imagery)) this.target.remove(imagery, true);
      else imagery.destroy();
    }
    this.imagery.clear();
  }
}
