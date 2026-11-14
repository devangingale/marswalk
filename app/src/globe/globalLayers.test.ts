// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import {
  GlobeLayer,
  ValuesGrid,
  formatGlobalValue,
  globeAssetUrl,
  groupGlobeLayers,
  legendSteps,
  readValue,
} from './globalLayers';

// 4 x 2 cells of 90 degrees: row 0 is north (0..90 N), column 0 starts at 180 W.
function grid(raw: number[]): ValuesGrid {
  return {
    width: 4,
    height: 2,
    west: -180,
    north: 90,
    res_deg: 90,
    scale: 0.5,
    offset: 100,
    nodata: 65535,
    data: Uint16Array.from(raw),
  };
}

const RAW = [0, 1, 2, 3, 10, 20, 65535, 40];

describe('readValue', () => {
  it('decodes raw * scale + offset at each cell', () => {
    const g = grid(RAW);
    expect(readValue(g, -135, 45)).toBe(100);
    expect(readValue(g, -45, 45)).toBe(100.5);
    expect(readValue(g, 45, 45)).toBe(101);
    expect(readValue(g, 135, 45)).toBe(101.5);
    expect(readValue(g, -135, -45)).toBe(105);
    expect(readValue(g, -45, -45)).toBe(110);
    expect(readValue(g, 135, -45)).toBe(120);
  });

  it('returns null for nodata', () => {
    expect(readValue(grid(RAW), 45, -45)).toBeNull();
  });

  it('puts cell edges in the cell to the east and south', () => {
    const g = grid(RAW);
    expect(readValue(g, -180, 90)).toBe(100);
    expect(readValue(g, 90, 0)).toBe(120);
  });

  it('wraps longitudes outside -180..180', () => {
    const g = grid(RAW);
    expect(readValue(g, 225, 45)).toBe(100);
    expect(readValue(g, 180, 45)).toBe(100);
    expect(readValue(g, -225, 45)).toBe(101.5);
  });

  it('returns null outside the grid latitudes', () => {
    const g = { ...grid(RAW), height: 1, data: Uint16Array.from(RAW.slice(0, 4)) };
    expect(readValue(g, 0, -10)).toBeNull();
    expect(readValue({ ...g, north: 60 }, 0, 61)).toBeNull();
  });
});

describe('legendSteps', () => {
  it('samples the stops evenly from min to max', () => {
    expect(
      legendSteps(
        [
          [0, '#00000000'],
          [10, '#ff8000ff'],
        ],
        0,
        10,
        3,
      ),
    ).toEqual(['rgba(0, 0, 0, 0)', 'rgba(128, 64, 0, 0.5)', 'rgba(255, 128, 0, 1)']);
  });

  it('holds the end colours outside the stops and reads six-digit colours as opaque', () => {
    expect(
      legendSteps(
        [
          [2, '#102030'],
          [4, '#305070'],
        ],
        0,
        6,
        4,
      ),
    ).toEqual(['rgba(16, 32, 48, 1)', 'rgba(16, 32, 48, 1)', 'rgba(48, 80, 112, 1)', 'rgba(48, 80, 112, 1)']);
  });
});

function layer(over: Partial<GlobeLayer>): GlobeLayer {
  return {
    id: 'x',
    title: 'X',
    group: 'dust',
    units: '',
    description: '',
    tiles: 'layers/x/{z}/{x}/{y}.png',
    tiling: 'geographic',
    min_level: 0,
    max_level: 1,
    rectangle: [-180, -60, 180, 60],
    legend: { stops: [], min: 0, max: 1, min_label: '0', max_label: '1', units: '' },
    source: { dataset: 'x', citation: 'c', licence: 'l' },
    ...over,
  };
}

describe('formatGlobalValue', () => {
  it('labels radiation by group, rounded to whole units for a 72-unit range', () => {
    const dose = layer({
      group: 'radiation',
      legend: { stops: [], min: 261.01, max: 332.72, min_label: '261', max_label: '333', units: 'µGy/day' },
    });
    expect(formatGlobalValue(dose, 312.4)).toBe('Radiation 312 µGy/day');
  });

  it('keeps two decimals for dust opacity', () => {
    const dust = layer({
      group: 'dust',
      legend: { stops: [], min: 0.2199, max: 0.6011, min_label: '0.22', max_label: '0.6', units: 'τIR' },
    });
    expect(formatGlobalValue(dust, 0.35417)).toBe('Dust 0.35 τIR');
  });

  it('uses a real minus sign and the title for an unknown group', () => {
    const odd = layer({
      group: 'other',
      title: 'Crustal field',
      legend: { stops: [], min: -1, max: 1, min_label: '-1', max_label: '1', units: 'nT' },
    });
    expect(formatGlobalValue(odd, -0.44)).toBe('Crustal field −0.4 nT');
  });
});

describe('groupGlobeLayers', () => {
  it('groups in manifest order with readable group names', () => {
    const groups = groupGlobeLayers([
      layer({ id: 'a', group: 'ice' }),
      layer({ id: 'b', group: 'radiation' }),
      layer({ id: 'c', group: 'ice' }),
      layer({ id: 'd', group: 'thermal' }),
    ]);
    expect(groups.map((g) => [g.label, g.layers.map((l) => l.id)])).toEqual([
      ['Water ice', ['a', 'c']],
      ['Radiation', ['b']],
      ['Thermal inertia', ['d']],
    ]);
  });
});

describe('globeAssetUrl', () => {
  it('joins relative paths onto the base and keeps absolute ones', () => {
    expect(globeAssetUrl('/sample/globe/', 'layers/a/{z}/{x}/{y}.png')).toBe('/sample/globe/layers/a/{z}/{x}/{y}.png');
    expect(globeAssetUrl('https://r2.example/globe', 'caves.geojson')).toBe('https://r2.example/globe/caves.geojson');
    expect(globeAssetUrl('/sample/globe', '/other/x.bin')).toBe('/other/x.bin');
  });
});
