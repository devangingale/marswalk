// Written with AI assistance, directed and reviewed by the team.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_LEVEL,
  TemperatureGrid,
  TemperatureManifest,
  binLabel,
  decodeCounts,
  decodeValues,
  formatCelsius,
  formatCoverage,
  formatLocalHours,
  legendRamp,
  legendTicks,
  maxLevel,
  readoutLines,
  seasonBin,
  temperatureAt,
} from './temperatureManifest';

describe('seasonBin', () => {
  it('maps each 30 degree span of Ls to its bin', () => {
    expect(seasonBin(0)).toBe(0);
    expect(seasonBin(29.999)).toBe(0);
    expect(seasonBin(30)).toBe(1);
    expect(seasonBin(90)).toBe(3);
    expect(seasonBin(119.5)).toBe(3);
    expect(seasonBin(359.99)).toBe(11);
  });

  it('wraps full turns and negative angles', () => {
    expect(seasonBin(360)).toBe(0);
    expect(seasonBin(395)).toBe(1);
    expect(seasonBin(-10)).toBe(11);
  });
});

describe('labels', () => {
  it('names the bin by its Ls range', () => {
    expect(binLabel({ ls_start: 90, ls_end: 120 })).toBe('Ls 90–120');
  });

  it('rounds degrees to whole numbers with a typographic minus and no negative zero', () => {
    expect(formatCelsius(-156.97300720214844)).toBe('−157');
    expect(formatCelsius(17.434999465942383)).toBe('17');
    expect(formatCelsius(-98.8370049794515)).toBe('−99');
    expect(formatCelsius(-0.4)).toBe('0');
    expect(formatCelsius(0.5)).toBe('1');
  });

  it('gives coverage as a whole percentage and local time as hours', () => {
    expect(formatCoverage({ fraction: 0.7377777777777778 })).toBe('74 % of cells observed');
    expect(formatLocalHours([0, 4])).toBe('00–04 h');
    expect(formatLocalHours([12, 16])).toBe('12–16 h');
  });

  it('writes the hover readout with the observation count', () => {
    expect(readoutLines('t_min', { celsius: -82.2, observations: 14 })).toEqual(['Night low −82 °C', '14 observations']);
    expect(readoutLines('t_max', { celsius: -3.6, observations: 1 })).toEqual(['Afternoon high −4 °C', '1 observation']);
    expect(readoutLines('t_max', { celsius: 5, observations: 1204 })).toEqual(['Afternoon high 5 °C', '1,204 observations']);
  });
});

describe('legend', () => {
  const legend: TemperatureManifest['legend'] = {
    min: -156.97300720214844,
    max: 17.434999465942383,
    units: 'deg C',
    stops: [
      [-156.97300720214844, '#344a6696'],
      [-98.8370049794515, '#647c9196'],
      [-40.70100275675456, '#c2a07996'],
      [17.434999465942383, '#ee873a96'],
    ],
  };

  it('places a rounded tick at each stop', () => {
    const ticks = legendTicks(legend);
    expect(ticks.map((t) => t.label)).toEqual(['−157', '−99', '−41', '17']);
    expect(ticks[0].at).toBe(0);
    expect(ticks[1].at).toBeCloseTo(1 / 3, 6);
    expect(ticks[3].at).toBe(1);
  });

  it('builds the ramp from the stops at their values', () => {
    expect(legendRamp(legend)).toBe(
      'linear-gradient(to right, #344a6696 0%, #647c9196 33.33%, #c2a07996 66.67%, #ee873a96 100%)',
    );
  });
});

describe('maxLevel', () => {
  it('uses the manifest level and defaults to 4 when absent', () => {
    const variant = { tiles: '', values: {} as never, coverage: {} as never };
    expect(maxLevel({ ...variant, max_level: 3 })).toBe(3);
    expect(maxLevel(variant)).toBe(DEFAULT_MAX_LEVEL);
    expect(DEFAULT_MAX_LEVEL).toBe(4);
  });
});

// 4 x 2 cells of 90 degrees: row 0 is north, column 0 starts at 180 W. Raw 1000 -> -50 degrees C.
function grid(raw: number[], counts: number[]): TemperatureGrid {
  return {
    values: {
      width: 4,
      height: 2,
      west: -180,
      north: 90,
      res_deg: 90,
      scale: 0.1,
      offset: -150,
      nodata: 65535,
      data: Uint16Array.from(raw),
    },
    counts: Uint32Array.from(counts),
    minObservations: 3,
  };
}

describe('temperatureAt', () => {
  const g = grid([1000, 1100, 1200, 1300, 1400, 65535, 1600, 1700], [5, 3, 2, 9, 4, 0, 7, 12]);

  it('decodes scale and offset with the cell count', () => {
    expect(temperatureAt(g, -170, 10)).toEqual({ celsius: -50, observations: 5 });
    expect(temperatureAt(g, -45, 80)).toEqual({ celsius: -40, observations: 3 });
    expect(temperatureAt(g, 100, -30)).toEqual({ celsius: 20, observations: 12 });
  });

  it('gives no reading on nodata or below the minimum count', () => {
    expect(temperatureAt(g, -60, -30)).toBeNull();
    expect(temperatureAt(g, 30, 30)).toBeNull();
  });

  it('wraps across the antimeridian', () => {
    expect(temperatureAt(g, 180, 10)).toEqual({ celsius: -50, observations: 5 });
    expect(temperatureAt(g, 190, 10)).toEqual({ celsius: -50, observations: 5 });
    expect(temperatureAt(g, -190, 10)).toEqual({ celsius: -20, observations: 9 });
    expect(temperatureAt(g, 179.9, -10)).toEqual({ celsius: 20, observations: 12 });
  });

  it('gives no reading off the poles', () => {
    expect(temperatureAt(g, 0, 91)).toBeNull();
    expect(temperatureAt(g, 0, -90.5)).toBeNull();
  });
});

describe('decoding', () => {
  it('reads little and big endian counts and little endian values', () => {
    const bytes = new Uint8Array([1, 0, 0, 0, 0, 1, 0, 0]).buffer;
    expect([...decodeCounts(bytes, { width: 2, height: 1, byte_order: 'little' })]).toEqual([1, 256]);
    expect([...decodeCounts(bytes, { width: 2, height: 1, byte_order: 'big' })]).toEqual([16777216, 65536]);
    expect([...decodeValues(new Uint8Array([0xff, 0xff, 0x10, 0x00]).buffer, 2, 1)]).toEqual([65535, 16]);
  });

  it('reads the sample bundle: coldest Ls 0–30 night low matches the manifest extreme', () => {
    const dir = resolve(__dirname, '../../../public/sample/globe');
    const manifest = JSON.parse(readFileSync(resolve(dir, 'temperature.json'), 'utf8')) as TemperatureManifest;
    expect(manifest.season_bins).toHaveLength(12);
    const variant = manifest.season_bins[0].t_min;
    const buf = (p: string) => {
      const b = readFileSync(resolve(dir, p));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    const { url, counts, min_observations_per_cell, ...header } = variant.values;
    const sample: TemperatureGrid = {
      values: { ...header, data: decodeValues(buf(url), header.width, header.height) },
      counts: decodeCounts(buf(counts.url), counts),
      minObservations: min_observations_per_cell,
    };
    const observed = Array.from(sample.counts).filter((c) => c >= min_observations_per_cell).length;
    expect(observed).toBe(variant.coverage.observed_cells);
    const reading = temperatureAt(sample, 3, -81);
    expect(reading?.celsius).toBeCloseTo(-141.062, 2);
    expect(formatCelsius(reading!.celsius)).toBe('−141');
  });
});
