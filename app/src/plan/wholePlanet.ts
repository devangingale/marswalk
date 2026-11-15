// Written with AI assistance, directed and reviewed by the team.
// Whole-planet layers for the Plan tab: the same manifest and grids Explore uses, plus the
// value of each shown layer at the site, since a planet-scale grid is one flat colour there.

import { useCallback, useEffect, useState } from 'react';
import { GLOBE_BASE } from '../config';
import {
  formatGlobalValue,
  globeAssetUrl,
  groupLabel,
  legendSteps,
  readValue,
  type GlobeLayer,
  type GlobeManifest,
  type ValuesGrid,
  type ValuesSpec,
} from '../globe/layerManifest';
import { loadTemperatureGrid, loadTemperatureManifest } from '../globe/temperature/temperatureLayer';
import { formatCelsius, seasonBin, temperatureAt, type TemperatureKind, type TemperatureManifest } from '../globe/temperature/temperatureManifest';
import { marsSolarLongitude } from '../lib/sun';
import type { LayerState } from '../types';

/** Data overlays start at the --map-overlay-opacity token value, as in Explore. */
const OVERLAY_OPACITY = 0.7;
const MARS_RADIUS_KM = 3389.5;

export interface CavePoint { id: string; lon: number; lat: number }
export interface TemperatureSetting { enabled: boolean; opacity: number; kind: TemperatureKind }

/** Value text without the group name, such as 312 µGy/day. */
export function siteValueText(layer: GlobeLayer, value: number): string {
  const text = formatGlobalValue(layer, value);
  const prefix = `${groupLabel(layer)} `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/** Great-circle distance on Mars, in km. */
export function marsDistanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseRgba(css: string): [number, number, number, number] {
  const [r, g, b, a] = css.match(/[\d.]+/g)!.map(Number);
  return [r, g, b, (a ?? 1) * 255];
}

/**
 * Value read back from a tile colour, for layers shipped without a value grid: the closest
 * colour on the legend ramp. Returns null below the ramp (transparent pixel).
 */
export function valueFromColour(layer: GlobeLayer, rgba: [number, number, number, number], samples = 256): number | null {
  if (rgba[3] < 12) return null;
  const { stops, min, max } = layer.legend;
  const ramp = legendSteps(stops, min, max, samples).map(parseRgba);
  let best = -1;
  let bestD = Infinity;
  ramp.forEach(([r, g, b, a], i) => {
    if (a < 12) return;
    const d = (r - rgba[0]) ** 2 + (g - rgba[1]) ** 2 + (b - rgba[2]) ** 2 + (a - rgba[3]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best < 0 ? null : min + ((max - min) * best) / (samples - 1);
}

/** Lowest legend value with a visible colour: what a transparent pixel is below. */
function firstVisibleValue(layer: GlobeLayer, samples = 256): number {
  const { stops, min, max } = layer.legend;
  const index = legendSteps(stops, min, max, samples).findIndex((c) => parseRgba(c)[3] >= 12);
  return min + ((max - min) * Math.max(0, index)) / (samples - 1);
}

async function loadGrid(spec: ValuesSpec): Promise<ValuesGrid> {
  const url = globeAssetUrl(GLOBE_BASE, spec.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const { url: _url, ...header } = spec;
  return { ...header, data: new Uint16Array(await response.arrayBuffer()) };
}

/** Pixel of the deepest tile under a point, on the geographic scheme (2 by 1 tiles at level 0). */
async function tilePixel(layer: GlobeLayer, lon: number, lat: number): Promise<[number, number, number, number]> {
  const z = layer.max_level;
  const size = 180 / 2 ** z;
  const x = Math.floor((lon + 180) / size);
  const y = Math.floor((90 - lat) / size);
  const url = globeAssetUrl(GLOBE_BASE, layer.tiles.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const image = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const px = Math.min(image.width - 1, Math.floor((((lon + 180) - x * size) / size) * image.width));
  const py = Math.min(image.height - 1, Math.floor((((90 - lat) - y * size) / size) * image.height));
  const [r, g, b, a] = context.getImageData(px, py, 1, 1).data;
  return [r, g, b, a];
}

async function valueAtSite(layer: GlobeLayer, lon: number, lat: number): Promise<string> {
  if (layer.values) {
    const value = readValue(await loadGrid(layer.values), lon, lat);
    return value === null ? 'no data' : siteValueText(layer, value);
  }
  const value = valueFromColour(layer, await tilePixel(layer, lon, lat));
  if (value === null) return `below ${siteValueText(layer, firstVisibleValue(layer))}`;
  return `about ${siteValueText(layer, value)}`;
}

/** Everything the Plan tab needs for the whole-planet groups, read once per site. */
export function useWholePlanet(site: { lon: number; lat: number }) {
  const [layers, setLayers] = useState<GlobeLayer[]>([]);
  const [states, setStates] = useState<Record<string, LayerState>>({});
  const [temperatureManifest, setTemperatureManifest] = useState<TemperatureManifest | null>(null);
  const [temperature, setTemperature] = useState<TemperatureSetting>({ enabled: false, opacity: 1, kind: 't_min' });
  const [caves, setCaves] = useState<CavePoint[]>([]);
  const [cavesOn, setCavesOn] = useState(false);
  const [siteValues, setSiteValues] = useState<Record<string, string>>({});
  const [temperatureAtSite, setTemperatureAtSite] = useState<string | undefined>();
  const bin = seasonBin(marsSolarLongitude(Date.now()));

  useEffect(() => {
    let active = true;
    fetch(globeAssetUrl(GLOBE_BASE, 'layers.json'))
      .then((r) => (r.ok ? (r.json() as Promise<GlobeManifest>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((manifest) => {
        if (!active) return;
        setLayers(manifest.layers);
        setStates(Object.fromEntries(manifest.layers.map((l) => [l.id, { enabled: false, opacity: OVERLAY_OPACITY }])));
      })
      .catch((error) => console.warn('Globe layer manifest did not load', error));
    loadTemperatureManifest(GLOBE_BASE)
      .then((manifest) => { if (active) setTemperatureManifest(manifest); })
      .catch((error) => console.warn('Temperature manifest did not load', error));
    fetch(globeAssetUrl(GLOBE_BASE, 'caves.geojson'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { features: { geometry: { coordinates: [number, number] }; properties: { id: string } }[] }) => {
        if (active) setCaves(data.features.map((f) => ({ id: f.properties.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
      })
      .catch((error) => console.warn('Cave candidates did not load', error));
    return () => { active = false; };
  }, []);

  // Values at the site for every layer, read once per site; shown only while the layer is on.
  useEffect(() => {
    let active = true;
    setSiteValues({});
    for (const layer of layers) {
      valueAtSite(layer, site.lon, site.lat)
        .then((text) => { if (active) setSiteValues((prev) => ({ ...prev, [layer.id]: text })); })
        .catch((error) => console.warn(`Value at site for ${layer.id} did not load`, error));
    }
    return () => { active = false; };
  }, [layers, site.lon, site.lat]);

  useEffect(() => {
    let active = true;
    setTemperatureAtSite(undefined);
    const variant = temperatureManifest?.season_bins[bin]?.[temperature.kind];
    if (!variant || !temperature.enabled) return () => { active = false; };
    loadTemperatureGrid(GLOBE_BASE, variant)
      .then((grid) => {
        if (!active) return;
        const reading = temperatureAt(grid, site.lon, site.lat);
        setTemperatureAtSite(reading ? `${formatCelsius(reading.celsius)} °C` : 'too few observations');
      })
      .catch((error) => console.warn('Temperature at site did not load', error));
    return () => { active = false; };
  }, [temperatureManifest, bin, temperature.kind, temperature.enabled, site.lon, site.lat]);

  const nearestCaveKm = caves.length ? Math.min(...caves.map((c) => marsDistanceKm(site, c))) : null;
  const cavesAtSite = nearestCaveKm === null ? undefined
    : nearestCaveKm < 1 ? `nearest candidate ${Math.round(nearestCaveKm * 1000)} m away`
      : `nearest candidate ${Math.round(nearestCaveKm).toLocaleString('en-GB')} km away`;

  const toggle = useCallback((id: string) => setStates((prev) => prev[id] ? { ...prev, [id]: { ...prev[id], enabled: !prev[id].enabled } } : prev), []);
  const setOpacity = useCallback((id: string, opacity: number) => setStates((prev) => prev[id] ? { ...prev, [id]: { ...prev[id], opacity } } : prev), []);

  return {
    layers, states, toggle, setOpacity,
    temperatureManifest, temperature, setTemperature, temperatureAtSite, bin,
    caves, cavesOn, setCavesOn, cavesAtSite,
    siteValues,
  };
}
