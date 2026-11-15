// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { Scene } from 'cesium';
import {
  decodeFrame,
  DustLayer,
  type DustGrid,
  type DustPalette,
  type DustYear,
  frameIndex,
  paletteColor,
  parseRgba,
  renderRgba,
} from './dustLayer';

const year: DustYear = {
  my: 34,
  url: 'MY34.bin',
  frames: 669,
  sols: [
    { sol: 1, ls: 0.24, earth_date: '2017-05-05' },
    { sol: 2, ls: 0.75, earth_date: '2017-05-06' },
    { sol: 3, ls: 1.26, earth_date: '2017-05-07' },
  ],
};

describe('frameIndex', () => {
  it('maps the first sol to frame 0', () => {
    expect(frameIndex(year, 1)).toBe(0);
  });

  it('maps a sol to its offset from the first sol', () => {
    expect(frameIndex(year, 360)).toBe(359);
    expect(frameIndex(year, 425)).toBe(424);
    expect(frameIndex(year, 669)).toBe(668);
  });

  it('clamps below the first sol and above the last frame', () => {
    expect(frameIndex(year, 0)).toBe(0);
    expect(frameIndex(year, -5)).toBe(0);
    expect(frameIndex(year, 1000)).toBe(668);
  });
});

describe('decodeFrame', () => {
  // 2x2 grid, scale 0.03, nodata 255. Two frames packed [frame][lat][lon].
  const grid: DustGrid = {
    west: -180,
    north: 90,
    res_lon: 180,
    res_lat: 90,
    width: 2,
    height: 2,
    scale: 0.03,
    offset: 0,
    nodata: 255,
  };
  const bytes = new Uint8Array([
    0, 10, 20, 255, // frame 0
    100, 50, 255, 1, // frame 1
  ]);

  it('applies scale and offset per cell', () => {
    const f0 = decodeFrame(bytes, grid, 0);
    expect(f0.length).toBe(4);
    expect(f0[0]).toBeCloseTo(0, 6);
    expect(f0[1]).toBeCloseTo(0.3, 6);
    expect(f0[2]).toBeCloseTo(0.6, 6);
    expect(Number.isNaN(f0[3])).toBe(true);
  });

  it('reads the requested frame from the packed buffer', () => {
    const f1 = decodeFrame(bytes, grid, 1);
    expect(f1[0]).toBeCloseTo(3, 6);
    expect(f1[1]).toBeCloseTo(1.5, 6);
    expect(Number.isNaN(f1[2])).toBe(true);
    expect(f1[3]).toBeCloseTo(0.03, 6);
  });

  it('honours a non-zero offset', () => {
    const shifted: DustGrid = { ...grid, offset: 1 };
    expect(decodeFrame(bytes, shifted, 0)[0]).toBeCloseTo(1, 6);
  });
});

describe('parseRgba', () => {
  it('reads an 8-digit hex with alpha', () => {
    expect(parseRgba('#d2905400')).toEqual([210, 144, 84, 0]);
    expect(parseRgba('#580d05ff')).toEqual([88, 13, 5, 255]);
  });

  it('defaults alpha to opaque for a 6-digit hex', () => {
    expect(parseRgba('#c67832')).toEqual([198, 120, 50, 255]);
  });
});

describe('paletteColor', () => {
  const palette: DustPalette = {
    stops: [
      [0.0, '#d2905400'],
      [0.5, '#d99b5044'],
      [1.0, '#c6783288'],
    ],
  };

  it('is fully transparent for no data', () => {
    expect(paletteColor(palette, NaN)).toEqual([0, 0, 0, 0]);
  });

  it('clamps to the first stop below the range', () => {
    expect(paletteColor(palette, -1)).toEqual([210, 144, 84, 0]);
  });

  it('clamps to the last stop above the range', () => {
    expect(paletteColor(palette, 5)).toEqual([198, 120, 50, 136]);
  });

  it('returns the exact colour at a stop', () => {
    expect(paletteColor(palette, 0.5)).toEqual([217, 155, 80, 68]);
  });

  it('interpolates the alpha at the midpoint between two stops', () => {
    // halfway from 0.0 (alpha 0x00=0) to 0.5 (alpha 0x44=68) -> 34.
    expect(paletteColor(palette, 0.25)[3]).toBe(34);
  });
});

describe('renderRgba', () => {
  const grid: DustGrid = {
    west: -180,
    north: 90,
    res_lon: 180,
    res_lat: 180,
    width: 2,
    height: 1,
    scale: 1,
    offset: 0,
    nodata: 255,
  };
  const palette: DustPalette = {
    stops: [
      [0.0, '#00000000'],
      [1.0, '#ffffffff'],
    ],
  };

  it('writes RGBA bytes per cell in row order', () => {
    const out = renderRgba(new Float32Array([0, 1]), grid, palette);
    expect(out.length).toBe(8);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 255, 255, 255]);
  });
});

describe('DustLayer.destroy', () => {
  it('does nothing once the viewer has already destroyed the scene', () => {
    // Explore's cleanup destroys the viewer before the clock's cleanup destroys the dust layer.
    // A destroyed Cesium scene has no primitives collection any more.
    const destroyedScene = { isDestroyed: () => true, primitives: undefined } as unknown as Scene;
    const layer = new DustLayer(destroyedScene);
    (layer as unknown as { primitive: object | null }).primitive = {};
    expect(() => layer.destroy()).not.toThrow();
    expect((layer as unknown as { primitive: object | null }).primitive).toBeNull();
  });
});
