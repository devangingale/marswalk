import { describe, expect, it } from 'vitest';
import { createGrid } from '../lib/grid';
import type { GridHeader } from '../lib/grid';
import { isInsideSite } from './planPick';

const origin = { lon0: 137.36045619776752, lat0: -4.824994257912251, lat_c: -4.791253048196021 };
const header: GridHeader = {
  width: 4000, height: 4000, cell_x_m: 1, cell_y_m: 1,
  elev: { file: 'elev.bin', dtype: 'uint16', scale_m: 1, offset_m: 0, nodata: 65535 },
  cost: { file: 'cost.bin', dtype: 'uint8', impassable: 255 },
};
const grid = createGrid(header, new Uint16Array(16_000_000), new Uint8Array(16_000_000), origin);

describe('isInsideSite', () => {
  it('accepts the Gale rover drop-off', () => {
    expect(isInsideSite(grid, 137.39419740748374, -4.791253048196021)).toBe(true);
  });

  it('rejects a point 3 km west of the grid', () => {
    const point = grid.localMetresToLonLat(-3000, 2000);
    expect(isInsideSite(grid, point.lon, point.lat)).toBe(false);
  });

  it('includes the exact north-east corner cell', () => {
    const point = grid.localMetresToLonLat(grid.width_m, grid.height_m);
    expect(isInsideSite(grid, point.lon, point.lat)).toBe(true);
  });
});
