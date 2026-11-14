// Written with AI assistance, directed and reviewed by the team.
import { ImageryLayer, ImageryLayerCollection } from 'cesium';
import { resolveSiteAssetUrl } from '../config';
import type { LayerState, SiteData, SiteLayer } from '../types';
import { createPMTilesImagery } from './pmtilesImagery';

export interface ImageryLayerView {
  show: boolean;
  alpha: number;
}

export interface ImageryLayerSync {
  add: string[];
  remove: string[];
  update: ({ id: string } & ImageryLayerView)[];
}

function viewFor(layer: SiteLayer, states: Record<string, LayerState>): ImageryLayerView {
  const state = states[layer.id];
  return state ? { show: state.enabled, alpha: state.opacity } : { show: layer.default_on, alpha: 1 };
}

/** Works out which site imagery layers to add, remove and restyle. Point layers are never imagery. */
export function syncImageryLayers(
  current: ReadonlyMap<string, ImageryLayerView>,
  layers: SiteLayer[],
  states: Record<string, LayerState>,
): ImageryLayerSync {
  const rasters = layers.filter((l) => l.type === 'raster');
  const wanted = new Set(rasters.map((l) => l.id));
  const add = rasters.filter((l) => !current.has(l.id)).map((l) => l.id);
  const remove = [...current.keys()].filter((id) => !wanted.has(id));
  const update = rasters.flatMap((l) => {
    const next = viewFor(l, states);
    const prev = current.get(l.id);
    return prev && prev.show === next.show && prev.alpha === next.alpha ? [] : [{ id: l.id, ...next }];
  });
  return { add, remove, update };
}

/**
 * Site PMTiles layers draped on the Cesium Mars tileset (or the globe when offline),
 * stacked in layer panel order with the first layer at the bottom.
 */
export class GlobeImagery {
  private readonly target: ImageryLayerCollection;
  private readonly layers = new Map<string, ImageryLayer>();
  private site: SiteData | null = null;
  private states: Record<string, LayerState> = {};
  private generation = 0;

  constructor(target: ImageryLayerCollection) {
    this.target = target;
  }

  async setSite(site: SiteData): Promise<void> {
    this.clear();
    this.site = site;
    const generation = ++this.generation;
    const { add } = syncImageryLayers(this.layers, site.layers, this.states);
    const created = await Promise.all(
      add.map(async (id) => {
        const layer = site.layers.find((l) => l.id === id)!;
        try {
          return await createPMTilesImagery(resolveSiteAssetUrl(site.id, layer.url), layer.source || undefined);
        } catch (error) {
          console.warn(`Site layer ${id} did not load`, error);
          return null;
        }
      }),
    );
    if (generation !== this.generation) return;
    add.forEach((id, i) => {
      const provider = created[i];
      if (!provider) return;
      const imagery = new ImageryLayer(provider, { show: false });
      this.target.add(imagery);
      this.layers.set(id, imagery);
    });
    this.apply(this.states, true);
  }

  apply(states: Record<string, LayerState>, force = false): void {
    this.states = states;
    if (!this.site) return;
    const current = new Map<string, ImageryLayerView>();
    if (!force) for (const [id, l] of this.layers) current.set(id, { show: l.show, alpha: l.alpha });
    for (const { id, show, alpha } of syncImageryLayers(current, this.site.layers, states).update) {
      const imagery = this.layers.get(id);
      if (!imagery) continue;
      imagery.show = show;
      imagery.alpha = alpha;
    }
  }

  clear(): void {
    this.generation++;
    for (const imagery of this.layers.values()) this.target.remove(imagery, true);
    this.layers.clear();
    this.site = null;
  }
}
