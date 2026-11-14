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

/** Value grid for hover readouts: uint16, row 0 at the north edge, column 0 at the west edge. */
export interface ValuesSpec {
  url: string;
  width: number;
  height: number;
  west: number;
  north: number;
  res_deg: number;
  scale: number;
  offset: number;
  nodata: number;
}

export interface ValuesGrid extends Omit<ValuesSpec, 'url'> {
  data: Uint16Array;
}

export interface GlobeLegend {
  stops: [number, string][];
  min: number;
  max: number;
  min_label: string;
  max_label: string;
  units: string;
  palette?: string;
  palette_label?: string;
}

export interface GlobeLayer {
  id: string;
  title: string;
  group: string;
  units: string;
  description: string;
  tiles: string;
  tiling: 'geographic';
  min_level: number;
  max_level: number;
  rectangle: [number, number, number, number];
  values?: ValuesSpec;
  legend: GlobeLegend;
  source: { dataset: string; citation: string; licence: string; licence_note?: string };
}

export interface GlobeManifest {
  version: number;
  layers: GlobeLayer[];
}

const GROUP_LABELS: Record<string, string> = {
  ice: 'Water ice',
  radiation: 'Radiation',
  dust: 'Dust',
  thermal: 'Thermal inertia',
  minerals: 'Minerals',
  score: 'Site score',
  caves: 'Caves',
  terrain: 'Terrain',
  temperature: 'Temperature',
};

export function globeAssetUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith('/')) return path;
  return `${base.replace(/\/+$/, '')}/${path}`;
}

export function groupLabel(layer: GlobeLayer): string {
  return GROUP_LABELS[layer.group] ?? layer.title;
}

export function groupGlobeLayers(layers: GlobeLayer[]): { group: string; label: string; layers: GlobeLayer[] }[] {
  const groups: { group: string; label: string; layers: GlobeLayer[] }[] = [];
  for (const layer of layers) {
    let entry = groups.find((g) => g.group === layer.group);
    if (!entry) {
      entry = { group: layer.group, label: groupLabel(layer), layers: [] };
      groups.push(entry);
    }
    entry.layers.push(layer);
  }
  return groups;
}

/** Decoded value at a point, or null outside the grid or on nodata. */
export function readValue(grid: ValuesGrid, lon: number, lat: number): number | null {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const col = Math.floor((wrapped - grid.west) / grid.res_deg);
  const row = Math.floor((grid.north - lat) / grid.res_deg);
  if (row < 0 || row >= grid.height || col < 0 || col >= grid.width) return null;
  const raw = grid.data[row * grid.width + col];
  if (raw === grid.nodata) return null;
  return raw * grid.scale + grid.offset;
}

function parseHex(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const channel = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4), h.length >= 8 ? channel(6) : 255];
}

/** n colours sampled evenly from min to max along the legend stops, for a stepped legend bar. */
export function legendSteps(stops: [number, string][], min: number, max: number, n: number): string[] {
  const colours = stops.map(([v, c]) => [v, parseHex(c)] as const);
  return Array.from({ length: n }, (_, i) => {
    const v = n === 1 ? min : min + ((max - min) * i) / (n - 1);
    let rgba = colours[colours.length - 1][1];
    if (v <= colours[0][0]) rgba = colours[0][1];
    else {
      for (let k = 1; k < colours.length; k++) {
        const [v1, c1] = colours[k];
        if (v <= v1) {
          const [v0, c0] = colours[k - 1];
          const t = v1 === v0 ? 1 : (v - v0) / (v1 - v0);
          rgba = c0.map((c, j) => c + (c1[j] - c) * t) as unknown as typeof rgba;
          break;
        }
      }
    }
    const [r, g, b, a] = rgba;
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number((a / 255).toFixed(3))})`;
  });
}

/** Hover text such as Radiation 312 µGy/day, rounded to suit the legend range. */
export function formatGlobalValue(layer: GlobeLayer, value: number): string {
  const range = Math.abs(layer.legend.max - layer.legend.min);
  const decimals = range > 0 ? Math.max(0, 1 - Math.floor(Math.log10(range))) : 0;
  const text = Math.abs(value).toFixed(decimals);
  const sign = value < 0 && Number(text) !== 0 ? '−' : '';
  const units = layer.legend.units || layer.units;
  return `${groupLabel(layer)} ${sign}${text}${units ? ` ${units}` : ''}`;
}

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
 * with value grids fetched the first time a layer is shown.
 */
export class GlobeGlobalLayers {
  private readonly imagery = new Map<string, ImageryLayer>();
  private readonly grids = new Map<string, ValuesGrid>();
  private readonly pending = new Set<string>();

  constructor(
    private readonly target: ImageryLayerCollection,
    private readonly base: string,
    readonly layers: GlobeLayer[],
  ) {
    for (const layer of [...layers].reverse()) {
      const imagery = new ImageryLayer(createGlobalImagery(base, layer), { show: false });
      target.add(imagery);
      target.lowerToBottom(imagery);
      this.imagery.set(layer.id, imagery);
    }
  }

  apply(states: Record<string, GlobalLayerState>): void {
    for (const layer of this.layers) {
      const imagery = this.imagery.get(layer.id)!;
      const state = states[layer.id];
      imagery.show = !!state?.enabled;
      imagery.alpha = state?.opacity ?? 1;
      if (state?.enabled && layer.values && !this.grids.has(layer.id) && !this.pending.has(layer.id)) {
        this.pending.add(layer.id);
        loadValuesGrid(this.base, layer.values)
          .then((grid) => this.grids.set(layer.id, grid))
          .catch((error) => console.warn(`Values for ${layer.id} did not load`, error))
          .finally(() => this.pending.delete(layer.id));
      }
    }
  }

  /** Readouts for each shown layer that has a value grid, in manifest order. */
  readouts(lon: number, lat: number): string[] {
    return this.layers.flatMap((layer) => {
      const grid = this.grids.get(layer.id);
      if (!grid || !this.imagery.get(layer.id)!.show) return [];
      const value = readValue(grid, lon, lat);
      return value === null ? [] : [formatGlobalValue(layer, value)];
    });
  }

  destroy(): void {
    for (const imagery of this.imagery.values()) this.target.remove(imagery, true);
    this.imagery.clear();
  }
}
