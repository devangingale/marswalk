// Written with AI assistance, directed and reviewed by the team.
import { ImageryLayer, ImageryLayerCollection, ImageryProvider } from 'cesium';
import { resolveSiteAssetUrl } from '../config';
import type { LayerState, SiteData, SiteLayer } from '../types';
import { createPMTilesImagery } from './pmtilesImagery';
import { offlineImagerySet } from './offline/imagerySet';
import { imageryLayerRank, orderImageryLayer } from './layerOrder';
import { markMapLoadMilestone } from './loadMilestones';
import { readNaturalTint } from './naturalTintPreference';

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
  private readonly onTileReady?: () => void;
  private readonly layers = new Map<string, ImageryLayer>();
  private site: SiteData | null = null;
  private states: Record<string, LayerState> = {};
  private generation = 0;
  private basemap: ImageryLayer | null = null;
  private naturalTint = readNaturalTint();
  private tintGeneration = 0;

  constructor(target: ImageryLayerCollection, onTileReady?: () => void) {
    this.target = target;
    this.onTileReady = onTileReady ? () => { markMapLoadMilestone('imagery'); onTileReady(); } : undefined;
  }

  async setSite(site: SiteData, mode: 'ion' | 'offline' = 'ion'): Promise<void> {
    this.clear();
    this.site = site;
    const generation = ++this.generation;
    const imagerySet = offlineImagerySet(mode, site);
    const { add } = syncImageryLayers(this.layers, imagerySet.layers, this.states);
    if (imagerySet.basemap) {
      try {
        const provider = await createPMTilesImagery(
          resolveSiteAssetUrl(site.id, imagerySet.basemap.url),
          imagerySet.basemap.source,
          false,
          this.onTileReady,
        );
        if (generation !== this.generation) return;
        this.basemap = new ImageryLayer(provider);
        this.target.add(this.basemap);
        orderImageryLayer(this.target, this.basemap, imageryLayerRank('offline-basemap'));
      } catch (error) {
        console.warn(`Site basemap did not load`, error);
      }
    }
    const created = await Promise.all(
      add.map(async (id) => {
        const layer = site.layers.find((l) => l.id === id)!;
        try {
          let tint = id === 'image' && this.naturalTint;
          let provider: ImageryProvider;
          do {
            provider = await createPMTilesImagery(
              resolveSiteAssetUrl(site.id, layer.url),
              layer.source || undefined,
              tint,
              this.onTileReady,
            );
            if (id !== 'image' || tint === this.naturalTint) break;
            tint = this.naturalTint;
          } while (true);
          return provider;
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
      const initialView = viewFor(this.site!.layers.find((layer) => layer.id === id)!, this.states);
      const imagery = new ImageryLayer(provider, initialView);
      this.target.add(imagery);
      this.layers.set(id, imagery);
      const siteLayerOrder = this.site?.layers.findIndex((layer) => layer.id === id) ?? 0;
      const rank = id === 'image'
        ? imageryLayerRank('site-orbital')
        : imageryLayerRank('site-data', siteLayerOrder, id);
      orderImageryLayer(this.target, imagery, rank);
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

  /** Rebuild only the HiRISE orbital provider so Cesium requests its tiles again. */
  async setNaturalTint(enabled: boolean): Promise<void> {
    if (this.naturalTint === enabled) return;
    this.naturalTint = enabled;
    const generation = ++this.tintGeneration;
    const site = this.site;
    const current = this.layers.get('image');
    const source = site?.layers.find((layer) => layer.id === 'image');
    if (!site || !current || !source) return;
    const show = current.show;
    const alpha = current.alpha;
    try {
      const provider = await createPMTilesImagery(
        resolveSiteAssetUrl(site.id, source.url),
        source.source || undefined,
        enabled,
      );
      if (generation !== this.tintGeneration || this.site !== site) return;
      const replacement = new ImageryLayer(provider, { show, alpha });
      this.target.remove(current, true);
      this.layers.set('image', replacement);
      this.target.add(replacement);
      orderImageryLayer(this.target, replacement, imageryLayerRank('site-orbital'));
    } catch (error) {
      console.warn('Orbital image layer did not reload', error);
    }
  }

  clear(): void {
    this.generation++;
    this.tintGeneration++;
    for (const imagery of this.layers.values()) this.target.remove(imagery, true);
    this.layers.clear();
    if (this.basemap) this.target.remove(this.basemap, true);
    this.basemap = null;
    this.site = null;
  }
}
