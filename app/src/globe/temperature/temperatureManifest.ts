// Written with AI assistance, directed and reviewed by the team.
// Global surface temperature manifest (MRO MCS, 12 season bins of 30 degrees Ls) and pure helpers.

import type { ValuesGrid, ValuesSpec } from '../layerManifest';

export type TemperatureKind = 't_min' | 't_max';

export const TEMPERATURE_KINDS: TemperatureKind[] = ['t_min', 't_max'];

export const KIND_LABELS: Record<TemperatureKind, string> = {
  t_min: 'Night low',
  t_max: 'Afternoon high',
};

/** Tiles above this level are not in the bundle; the full set stops at 4 and omits the field. */
export const DEFAULT_MAX_LEVEL = 4;

export interface CountsSpec {
  url: string;
  width: number;
  height: number;
  res_deg: number;
  dtype: 'uint32';
  byte_order: 'little' | 'big';
  units: string;
  nodata: number;
}

export interface TemperatureValuesSpec extends ValuesSpec {
  counts: CountsSpec;
  min_observations_per_cell: number;
}

export interface TemperatureCoverage {
  fraction: number;
  observed_cells: number;
  grid_cells: number;
  samples: number;
  min_observations_per_cell: number;
  local_time_hours: [number, number];
}

export interface TemperatureVariant {
  tiles: string;
  values: TemperatureValuesSpec;
  coverage: TemperatureCoverage;
  max_level?: number;
}

export interface SeasonBin {
  ls_start: number;
  ls_end: number;
  default_resolution_deg: number;
  t_min: TemperatureVariant;
  t_max: TemperatureVariant;
}

export interface TemperatureManifest {
  version: number;
  season_bins: SeasonBin[];
  legend: {
    min: number;
    max: number;
    units: string;
    stops: [number, string][];
  };
  source: {
    dataset: string;
    citation: string;
    licence: string;
    licence_note?: string;
  };
}

/** Temperature grid with its observation counts, for the hover readout. */
export interface TemperatureGrid {
  values: ValuesGrid;
  counts: Uint32Array;
  minObservations: number;
}

export interface TemperatureReading {
  celsius: number;
  observations: number;
}

/** Season bin index 0..11 for a solar longitude in degrees, any turn. */
export function seasonBin(ls: number): number {
  const wrapped = ((ls % 360) + 360) % 360;
  return Math.min(11, Math.floor(wrapped / 30));
}

export function maxLevel(variant: TemperatureVariant): number {
  return variant.max_level ?? DEFAULT_MAX_LEVEL;
}

/** Ls range label such as Ls 90–120. */
export function binLabel(bin: Pick<SeasonBin, 'ls_start' | 'ls_end'>): string {
  return `Ls ${bin.ls_start}–${bin.ls_end}`;
}

/**
 * Reading at a point: null on nodata or where the cell has fewer observations than the minimum.
 * Longitudes wrap, so 180 E and 180 W read the same west-edge column.
 */
export function temperatureAt(grid: TemperatureGrid, lon: number, lat: number): TemperatureReading | null {
  const v = grid.values;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const col = Math.floor((wrapped - v.west) / v.res_deg);
  const row = Math.floor((v.north - lat) / v.res_deg);
  if (row < 0 || row >= v.height || col < 0 || col >= v.width) return null;
  const raw = v.data[row * v.width + col];
  if (raw === v.nodata) return null;
  const observations = grid.counts[row * v.width + col] ?? 0;
  if (observations < grid.minObservations) return null;
  return { celsius: raw * v.scale + v.offset, observations };
}

function signed(n: number): string {
  return `${n < 0 ? '−' : ''}${Math.abs(n)}`;
}

/** Legend and readout figure: whole degrees, typographic minus, never −0. */
export function formatCelsius(value: number): string {
  const rounded = Math.round(value);
  return signed(rounded === 0 ? 0 : rounded);
}

/** Hover lines, such as Night low −82 °C and 14 observations. */
export function readoutLines(kind: TemperatureKind, reading: TemperatureReading): string[] {
  const n = reading.observations;
  return [
    `${KIND_LABELS[kind]} ${formatCelsius(reading.celsius)} °C`,
    `${n.toLocaleString('en-GB')} observation${n === 1 ? '' : 's'}`,
  ];
}

/** Coverage as 74 % of cells observed. */
export function formatCoverage(coverage: Pick<TemperatureCoverage, 'fraction'>): string {
  return `${Math.round(coverage.fraction * 100)} % of cells observed`;
}

/** Local time window such as 00–04 h. */
export function formatLocalHours([from, to]: [number, number]): string {
  const hh = (h: number) => String(Math.round(h)).padStart(2, '0');
  return `${hh(from)}–${hh(to)} h`;
}

/** Legend tick at each manifest stop: position 0..1 along the ramp and its label. */
export function legendTicks(legend: TemperatureManifest['legend']): { at: number; label: string }[] {
  const span = legend.max - legend.min;
  return legend.stops.map(([value]) => ({
    at: span > 0 ? (value - legend.min) / span : 0,
    label: formatCelsius(value),
  }));
}

/** CSS ramp from the manifest stops, placed at their values. */
export function legendRamp(legend: TemperatureManifest['legend']): string {
  const span = legend.max - legend.min;
  const parts = legend.stops.map(([value, hex]) => {
    const pct = span > 0 ? ((value - legend.min) / span) * 100 : 0;
    return `${hex} ${Number(pct.toFixed(2))}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Decode a uint32 counts grid honouring its byte order. */
export function decodeCounts(buffer: ArrayBuffer, spec: Pick<CountsSpec, 'width' | 'height' | 'byte_order'>): Uint32Array {
  const view = new DataView(buffer);
  const n = spec.width * spec.height;
  const out = new Uint32Array(n);
  const little = spec.byte_order !== 'big';
  for (let i = 0; i < n && i * 4 + 4 <= buffer.byteLength; i++) out[i] = view.getUint32(i * 4, little);
  return out;
}

/** Decode a uint16 values grid (little-endian, as the bundle writes it). */
export function decodeValues(buffer: ArrayBuffer, width: number, height: number): Uint16Array {
  const view = new DataView(buffer);
  const n = width * height;
  const out = new Uint16Array(n);
  for (let i = 0; i < n && i * 2 + 2 <= buffer.byteLength; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}
