// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import {
  createGrid,
  degToRad,
  radToDeg,
  lonlatToLocalMetres,
  localMetresToLonLat,
  localMetresToRowCol,
  rowColToLocalMetres,
  GridOrigin,
  GridHeader,
  MARS_R,
} from './grid';

describe('grid coordinate conversions (Contracts Section 3)', () => {
  const origin: GridOrigin = {
    lon0: 137.3628,
    lat0: -4.825,
    lat_c: -4.7913,
  };

  it('origin converts to (0, 0) in local metres', () => {
    const { x_m, y_m } = lonlatToLocalMetres(origin.lon0, origin.lat0, origin);
    expect(x_m).toBeCloseTo(0, 5);
    expect(y_m).toBeCloseTo(0, 5);
  });

  it('localMetresToLonLat inverses lonlatToLocalMetres', () => {
    const testLon = 137.39;
    const testLat = -4.78;

    const { x_m, y_m } = lonlatToLocalMetres(testLon, testLat, origin);
    const { lon, lat } = localMetresToLonLat(x_m, y_m, origin);

    expect(lon).toBeCloseTo(testLon, 6);
    expect(lat).toBeCloseTo(testLat, 6);
  });

  it('correctly calculates known north distance using Mars radius R = 3396190 m', () => {
    // 0.01 deg north delta: y_m = R * radians(0.01)
    const deltaLat = 0.01;
    const expectedY = MARS_R * degToRad(deltaLat);
    const { y_m } = lonlatToLocalMetres(origin.lon0, origin.lat0 + deltaLat, origin);
    expect(y_m).toBeCloseTo(expectedY, 3);
  });

  it('correctly maps local metres to row/col for row-major grid with row 0 = north', () => {
    const width = 100;
    const height = 100;
    const cell_x_m = 2.0;
    const cell_y_m = 2.0;
    const height_m = height * cell_y_m; // 200 m

    // NW corner: x_m ~ 1.0 (col 0), y_m ~ 199.0 (row 0)
    const nw = localMetresToRowCol(1.0, 199.0, height_m, cell_x_m, cell_y_m);
    expect(nw.col).toBe(0);
    expect(nw.row).toBe(0);

    // SE corner: x_m ~ 199.0 (col 99), y_m ~ 1.0 (row 99)
    const se = localMetresToRowCol(199.0, 1.0, height_m, cell_x_m, cell_y_m);
    expect(se.col).toBe(99);
    expect(se.row).toBe(99);

    // Center cell (col 50, row 50) local metres matches rowColToLocalMetres
    const centerPos = rowColToLocalMetres(50, 50, height_m, cell_x_m, cell_y_m);
    expect(centerPos.x_m).toBeCloseTo((50 + 0.5) * cell_x_m, 4);
    expect(centerPos.y_m).toBeCloseTo(height_m - (50 + 0.5) * cell_y_m, 4);
  });
});

describe('RouteGrid decoding and accessors', () => {
  const origin: GridOrigin = { lon0: 137.0, lat0: -4.0, lat_c: -4.0 };
  const header: GridHeader = {
    width: 3,
    height: 3,
    cell_x_m: 2.0,
    cell_y_m: 2.0,
    elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 0.1, offset_m: -4000.0, nodata: 65535 },
    cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255, multiplier: '1 + value / 50' },
    origin,
  };

  const elevData = new Uint16Array([
    100, 200, 65535, // row 0
    300, 400, 500,   // row 1
    0,   50,  600,   // row 2
  ]);

  const costData = new Uint8Array([
    0,   50,  255,   // row 0: (0, 2) is impassable
    25,  100, 10,    // row 1
    0,   0,   255,   // row 2: (2, 2) is impassable
  ]);

  const grid = createGrid(header, elevData, costData);

  it('decodes elevation correctly with scale and offset', () => {
    // 100 * 0.1 + (-4000) = -3990.0
    expect(grid.getElevation(0, 0)).toBeCloseTo(-3990.0, 4);
    // 200 * 0.1 + (-4000) = -3980.0
    expect(grid.getElevation(0, 1)).toBeCloseTo(-3980.0, 4);
    // nodata 65535 -> NaN
    expect(Number.isNaN(grid.getElevation(0, 2))).toBe(true);
  });

  it('decodes cost multiplier and passability', () => {
    // cost 0 -> multiplier 1.0
    expect(grid.getCostMultiplier(0, 0)).toBeCloseTo(1.0, 4);
    expect(grid.isPassable(0, 0)).toBe(true);

    // cost 50 -> 1 + 50/50 = 2.0
    expect(grid.getCostMultiplier(0, 1)).toBeCloseTo(2.0, 4);
    expect(grid.isPassable(0, 1)).toBe(true);

    // cost 255 -> impassable
    expect(grid.getCostMultiplier(0, 2)).toBe(Infinity);
    expect(grid.isPassable(0, 2)).toBe(false);

    // out of bounds -> impassable
    expect(grid.isPassable(-1, 0)).toBe(false);
    expect(grid.isPassable(5, 5)).toBe(false);
  });
});
